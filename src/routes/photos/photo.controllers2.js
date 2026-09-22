import { Prisma } from '../../config/db.js';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import exifr from 'exifr';
import { v4 as uuidv4 } from 'uuid';
import csv from 'csv-parser';
import { Readable } from 'stream';

// Import utilities
import {
  serializeBigInt,
  bufferToString,
  parseToNumber,
  getOrientationScientific
} from '../../utils/helpers.js';

import {
  uploadImageWithThumbnail,
  deleteFromS3,
  getPublicUrl,
  generateS3Key
} from '../../utils/s3.js';

import {
  getImageMetadata,
  extractExifFromBuffer,
  createThumbnail,
  convertImageFormat,
  extractDominantColor
} from '../../utils/image-processor.js';

import { generateFileResponse } from '../../middleware/upload.js';

// Helper function for consistent response
const successResponse = (message, data = null, meta = null) => ({
  status: 'success',
  message,
  ...(data && { data }),
  ...(meta && { meta })
});

const errorResponse = (message, error = null, code = null) => ({
  status: 'error',
  message,
  ...(code && { code }),
  ...(error && process.env.NODE_ENV === 'development' && { error: error.message })
});

// ==================== PUBLIC PHOTO CONTROLLERS ====================
 
export const createPhoto = async (req, res) => {
  console.log("=== old: api/admin-photos/upload-full  === New : api/photos/create ===");

  try {
    // Check if req.body exists (it might be undefined due to multipart/form-data)
    let bodyData = req.body;
    const userId = req.user?.id;

    // Debug logging
    console.log('Request body type:', typeof req.body);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('Files received:', req.files?.length || 0);
    console.log('File received:', req.file ? 'Yes' : 'No');

    // Handle multipart form data
    // When using multipart/form-data, req.body contains text fields
    // req.file contains single file, req.files contains multiple files
    const files = [];

    // Check for single file upload
    if (req.file) {
      files.push(req.file);
    }

    // Check for multiple files upload
    if (req.files && Array.isArray(req.files)) {
      files.push(...req.files);
    }

    // Check for field-specific multiple files (e.g., req.files['photos'])
    if (req.files && typeof req.files === 'object') {
      Object.values(req.files).forEach(fileArray => {
        if (Array.isArray(fileArray)) {
          files.push(...fileArray);
        } else {
          files.push(fileArray);
        }
      });
    }

    console.log('Total files to process:', files.length);

    // If body is a plain object (from multer), use it directly
    if (typeof bodyData === 'object' && bodyData !== null) {
      // Body is already parsed by multer
    } else if (typeof bodyData === 'string') {
      // Try to parse JSON string
      try {
        bodyData = JSON.parse(bodyData);
      } catch (parseError) {
        console.error('Error parsing JSON body:', parseError);
        return res.status(400).json(
          errorResponse('Invalid JSON format in request body')
        );
      }
    } else {
      bodyData = {};
    }

    // Extract data from body
    const {
      photo_title,
      description,
      category_id,
      sub_category_id,
      country_id,
      state_id,
      city_id,
      source_name,
      price,
      photography_time,
      event_name,
      photo_credit_id,
      credit,
      tag_ids = [],
      photo_tags
    } = bodyData;

    console.log('Extracted photo_title:', photo_title);
    console.log('Extracted category_id:', category_id);

    // Validate required fields
    if (!photo_title || !category_id) {
      return res.status(400).json(
        errorResponse('Photo title and category are required')
      );
    }

    // Validate files
    if (files.length === 0) {
      return res.status(400).json(
        errorResponse('At least one image file is required')
      );
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentDate.getDate()).padStart(2, '0');

    // Process uploaded files to S3
    const uploadedFiles = [];

    for (const file of files) {
      try {
        console.log(`Processing file: ${file.originalname}, size: ${file.size} bytes`);

        // Use your existing S3 utility to upload with thumbnail
        const uploadResult = await uploadImageWithThumbnail(
          file.buffer, // File buffer from multer
          file.originalname, // Original filename
          file.mimetype, // Content type
          {
            thumbnailWidth: 400,
            thumbnailHeight: 400,
            prefix: 'photos', // Store in photos directory
            isPublic: true // Make files publicly accessible
          }
        );

        console.log('Upload result:', uploadResult);

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(file.buffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data if available
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(file.buffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        // Extract dominant color
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(file.buffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        uploadedFiles.push({
          storage: 's3',
          url: uploadResult.mainUrl, // Main image URL
          thumbnailUrl: uploadResult.thumbnailUrl, // Thumbnail URL
          mainKey: uploadResult.mainKey, // S3 key for main image
          thumbnailKey: uploadResult.thumbnailKey, // S3 key for thumbnail
          filename: uploadResult.fileName,
          originalname: uploadResult.originalFileName,
          size: file.size,
          mimetype: file.mimetype,
          metadata: {
            ...metadata,
            exif: exifData,
            dominantColor: dominantColor
          }
        });

      } catch (uploadError) {
        console.error(`Error uploading file ${file.originalname}:`, uploadError);
        throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
      }
    }

    // Use transaction to ensure data consistency
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Create photo record
      const photo = await tx.pam_photos.create({
        data: {
          photo_title: String(photo_title),
          event_name: event_name ? String(event_name) : '',
          description: description ? String(description) : '',
          photo_tags: photo_tags ? String(photo_tags) : '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
          country_id: country_id ? parseInt(country_id) : null,
          state_id: state_id ? parseInt(state_id) : null,
          city_id: city_id ? parseInt(city_id) : null,
          author_id: parseInt(userId),
          media_type: 'photo',
          source_name: source_name ? String(source_name) : '',
          credit: photo_credit_id ? parseInt(photo_credit_id) : 0,
          other_credit: credit ? String(credit) : 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time ? new Date(photography_time) : new Date(),
          enter_by: parseInt(userId),
          updated_by: parseInt(userId),
          is_active: 1,
          is_trash: 0,
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      const photoId = Number(photo.photo_id);
      console.log('Created photo ID:', photoId);

      // 2. Process uploaded files
      const fileRecords = [];

      for (const file of uploadedFiles) {
        const orientation = file.metadata.width && file.metadata.height
          ? getOrientationScientific(file.metadata.width, file.metadata.height)
          : null;

        const fileRecord = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: path.extname(file.originalname).replace('.', ''),
            type: path.extname(file.originalname).replace('.', ''),
            dir_path: file.url, // Main S3 URL

            // dir_path: `testing/${year}/${month}/${date}`,
            thumbnail_path: file.thumbnailUrl, // Thumbnail S3 URL
            file_size: String(file.size),
            reference: '',
            source: 'User Upload',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: file.metadata.width || null,
            Height: file.metadata.height || null,
            orientation: orientation,
            raw_name: path.parse(file.originalname).name,
            Image_Name: file.filename,
            original_image_name: file.originalname,
            isMigrat: 0,
            s3_key: file.mainKey, // Store S3 key for future reference
            s3_thumbnail_key: file.thumbnailKey, // Store thumbnail S3 key
            metadata: file.metadata.exif ? JSON.stringify(file.metadata.exif) : null,
            dominant_color: file.metadata.dominantColor
          }
        });

        fileRecords.push(fileRecord);
      }

      // 3. Process tags
      let tagsInserted = 0;
      if (tag_ids.length > 0 || photo_tags) {
        const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : tag_ids.split(',');

        // Process photo_tags string
        if (photo_tags) {
          const tagsFromString = photo_tags.split(',').map(tag => tag.trim());
          for (const tagName of tagsFromString) {
            // Find or create tag
            let tag = await tx.pam_tags.findFirst({
              where: { photo_tag: tagName }
            });

            if (!tag) {
              const slug = tagName.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');
              tag = await tx.pam_tags.create({
                data: {
                  photo_tag: tagName,
                  photo_slug: slug
                }
              });
            }
            tagIdsArray.push(tag.tag_id.toString());
          }
        }

        // Remove duplicates
        const uniqueTagIds = [...new Set(tagIdsArray.filter(id => id && id.toString().trim()))];

        if (uniqueTagIds.length > 0) {
          // Create tag associations
          const tagPromises = uniqueTagIds.map(tagId =>
            tx.pam_photo_tags.create({
              data: {
                photo_id: photoId,
                tag_id: parseInt(tagId)
              }
            })
          );

          await Promise.all(tagPromises);
          tagsInserted = uniqueTagIds.length;
        }
      }

      return {
        photo,
        fileRecords,
        tagsInserted
      };
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'user',
        activity_type: 'create',
        module: 'photos',
        action: 'photo_create',
        message: `Created new photo: "${photo_title}" with ${uploadedFiles.length} images`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        created_at: new Date()
      }
    });

    return res.status(201).json(
      successResponse('Photo created successfully', {
        photo: {
          id: result.photo.photo_id,
          title: result.photo.photo_title,
          encoded_id: Buffer.from(Number(result.photo.photo_id).toString()).toString('base64')
        },
        files: {
          count: result.fileRecords.length,
          items: result.fileRecords.map(f => ({
            id: f.file_id,
            name: f.Image_Name,
            url: f.dir_path,
            thumbnail_url: f.thumbnail_path,
            s3_key: f.s3_key
          }))
        },
        tags: result.tagsInserted
      })
    );
  } catch (error) {
    console.error('Create photo error details:', error);
    console.error('Error stack:', error.stack);

    // Cleanup: If S3 upload succeeded but database failed, delete uploaded files
    if (uploadedFiles && uploadedFiles.length > 0) {
      console.log('Attempting to cleanup S3 files due to error...');
      for (const file of uploadedFiles) {
        try {
          if (file.mainKey) await deleteFromS3(file.mainKey);
          if (file.thumbnailKey) await deleteFromS3(file.thumbnailKey);
        } catch (cleanupError) {
          console.error('Error during S3 cleanup:', cleanupError);
        }
      }
    }

    return res.status(500).json(
      errorResponse('Failed to create photo', error.message)
    );
  }
};

export const createPhoto2222 = async (req, res) => {

  console.log("=== old: api/admin-photos/upload-full  === New : api/photos/create ===");

  try {
    //const userId = req.userId || 1;
    const userId = req.user.id;
    const files = req.files || [];
    const uploadedFiles = req.uploadedFiles || [];

    const {
      photo_title,
      description,
      category_id,
      sub_category_id,
      country_id,
      state_id,
      city_id,
      source_name,
      price,
      photography_time,
      event_name,
      photo_credit_id,
      credit,
      tag_ids = [],
      photo_tags
    } = req.body;

    // Validate required fields
    if (!photo_title || !category_id) {
      return res.status(400).json(
        errorResponse('Photo title and category are required')
      );
    }

    // Validate files
    if (files.length === 0 && uploadedFiles.length === 0) {
      return res.status(400).json(
        errorResponse('At least one image file is required')
      );
    }

    // Use transaction to ensure data consistency
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Create photo record
      const photo = await tx.pam_photos.create({
        data: {
          photo_title,
          event_name: event_name || '',
          description: description || '',
          photo_tags: photo_tags || '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
          country_id: country_id ? parseInt(country_id) : null,
          state_id: state_id ? parseInt(state_id) : null,
          city_id: city_id ? parseInt(city_id) : null,
          author_id: userId,
          media_type: 'photo',
          source_name: source_name || '',
          credit: photo_credit_id ? parseInt(photo_credit_id) : 0,
          other_credit: 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time ? new Date(photography_time) : new Date(),
          enter_by: userId,
          updated_by: userId,
          is_active: 1,
          is_trash: 0,
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      const photoId = Number(photo.photo_id);

      // 2. Process uploaded files
      const fileRecords = [];
      const allFiles = uploadedFiles.length > 0 ? uploadedFiles : files;

      for (const file of allFiles) {
        // Determine if it's from S3 or local
        const isS3 = file.storage === 's3';
        const dir_path = isS3 ? file.url : file.path;
        const file_size = file.size;

        // Get image metadata if available
        const metadata = file.metadata || {};
        const width = metadata.width || null;
        const height = metadata.height || null;
        const orientation = metadata.orientation ||
          getOrientationScientific(width, height);

        const fileRecord = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: path.extname(file.originalname || file.filename).replace('.', ''),
            type: path.extname(file.originalname || file.filename).replace('.', ''),
            dir_path: dir_path,
            file_size: String(file_size),
            reference: '',
            source: 'User Upload',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: width,
            Height: height,
            orientation: orientation,
            raw_name: path.parse(file.originalname || file.filename).name || '',
            Image_Name: file.filename,
            original_image_name: file.originalname || file.filename,
            isMigrat: 0
          }
        });

        fileRecords.push(fileRecord);
      }

      // 3. Process tags
      let tagsInserted = 0;
      if (tag_ids.length > 0 || photo_tags) {
        const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : tag_ids.split(',');

        // Process photo_tags string
        if (photo_tags) {
          const tagsFromString = photo_tags.split(',').map(tag => tag.trim());
          for (const tagName of tagsFromString) {
            // Find or create tag
            let tag = await tx.pam_tags.findFirst({
              where: { photo_tag: tagName }
            });

            if (!tag) {
              const slug = tagName.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');
              tag = await tx.pam_tags.create({
                data: {
                  photo_tag: tagName,
                  photo_slug: slug
                }
              });
            }
            tagIdsArray.push(tag.tag_id.toString());
          }
        }

        // Remove duplicates
        const uniqueTagIds = [...new Set(tagIdsArray.filter(id => id))];

        if (uniqueTagIds.length > 0) {
          await tx.pam_photo_tags.createMany({
            data: uniqueTagIds.map(tagId => ({
              photo_id: photoId,
              tag_id: parseInt(tagId)
            }))
          });
          tagsInserted = uniqueTagIds.length;
        }
      }

      return {
        photo,
        fileRecords,
        tagsInserted
      };
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'user',
        activity_type: 'create',
        module: 'photos',
        action: 'photo_create',
        message: `Created new photo: "${photo_title}"`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        created_at: new Date()
      }
    });

    return res.status(201).json(
      successResponse('Photo created successfully', {
        photo: {
          id: result.photo.photo_id,
          title: result.photo.photo_title,
          encoded_id: Buffer.from(Number(result.photo.photo_id).toString()).toString('base64')
        },
        files: {
          count: result.fileRecords.length,
          items: result.fileRecords.map(f => ({
            id: f.file_id,
            name: f.Image_Name
          }))
        },
        tags: result.tagsInserted
      })
    );
  } catch (error) {
    console.error('Create photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to create photo', error)
    );
  }
};
 


// ==================== EXPORT ALL CONTROLLERS ====================

export default {
  // Photo listing and viewing
  getAllPhotos,
  getPhotoDetails: getPhotoById,
  getPhotoFiles,
  getPhotoById,
  getPhotoByEncodedId,

  // Filtering and searching
  filterPhotos,
  searchPhotos,
  getPhotosByCategory,
  getPhotosBySubcategory: getPhotosByCategory, // Alias for now
  getPhotosByTag: async () => { }, // Implement as needed
  getPhotosByAuthor: getPhotosByCategory, // Alias for now
  getPhotosByLocation: async () => { }, // Implement as needed

  // User photos
  getMyPhotos,
  getUserPhotos: getMyPhotos, // Alias for now
  getUserUploadStats,

  // Photo management
  createPhoto,
  updatePhoto,
  deletePhoto,
  togglePhotoStatus,
  restorePhoto: async () => { }, // Implement as needed
  permanentlyDeletePhoto: async () => { }, // Implement as needed

  // Photo files management
  addPhotoFiles,
  removePhotoFile: async () => { }, // Implement as needed
  updatePhotoFile: async () => { }, // Implement as needed
  getPhotoFileDetails: async () => { }, // Implement as needed

  // Tags and metadata
  // addPhotoTags: async () => { }, // Implement as needed
  removePhotoTag: async () => { }, // Implement as needed
  getPhotoTags: async () => { }, // Implement as needed
  updatePhotoMetadata: async () => { }, // Implement as needed

  // Admin functions
  adminGetAllPhotos,
  // adminUpdatePhotoDetails: updatePhoto, // Use same for now
  adminBulkUpdatePhotos: async () => { }, // Implement as needed
  adminBulkDeletePhotos: async () => { }, // Implement as needed
  adminExportPhotos: async () => { }, // Implement as needed

  // Statistics and analytics
  getPhotoStatistics,
  getPopularPhotos,
  getRecentPhotos: getPopularPhotos, // Alias for now
  getPhotoTrends: async () => { }, // Implement as needed

  // Photo downloads and interactions
  recordPhotoView: async () => { }, // Implement as needed
  recordPhotoDownload: async () => { }, // Implement as needed
  getPhotoInteractions: async () => { }, // Implement as needed

  // Utility functions
  validatePhotoSlug: async () => { }, // Implement as needed
  generatePhotoSlug: async () => { }, // Implement as needed
  duplicatePhoto: async () => { }, // Implement as needed
  mergePhotos: async () => { } // Implement as needed
};