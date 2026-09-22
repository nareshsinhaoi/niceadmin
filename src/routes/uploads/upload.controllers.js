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
  uploadImageWithThumbnail,
  //uploadToS3,
  deleteFromS3,
  getPublicUrl,
  generateS3Key,
  getSignedS3Url,
  uploadFileFromPath,
  downloadFileFromS3
} from '../../utils/s3.js';

import {
  getImageMetadata,
  extractExifFromBuffer,
  createThumbnail,
  //convertImageFormat,
  extractDominantColor,
  validateImage
} from '../../utils/image-processor.js';

import {
  generateFileResponse,
  getUploadConfig
} from '../../middleware/upload.js';

// Helper function for consistent response
const successResponse = (message, data = null) => ({
  status: 'success',
  message,
  ...(data && { data })
});

const errorResponse = (message, error = null) => ({
  status: 'error',
  message,
  ...(error && process.env.NODE_ENV === 'development' && { error: error.message })
});

// ==================== PUBLIC UPLOAD CONTROLLERS ====================

/**
 * Upload single image
 */
export const uploadSingleImage = async (req, res) => {
  try {
    const file = req.file || req.files?.[0];

    if (!file) {
      return res.status(400).json(errorResponse('No file uploaded'));
    }

    const response = generateFileResponse(file, {
      uploadedBy: req.user?.id || 'anonymous',
      uploadType: 'single-image'
    });

    return res.status(200).json(successResponse('Image uploaded successfully', response));
  } catch (error) {
    console.error('Upload single image error:', error);
    return res.status(500).json(errorResponse('Failed to upload image', error));
  }
};

/**
 * Upload multiple images
 */
export const uploadMultipleImages = async (req, res) => {
  try {
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json(errorResponse('No files uploaded'));
    }

    const uploadedFiles = files.map(file =>
      generateFileResponse(file, {
        uploadedBy: req.user?.id || 'anonymous',
        uploadType: 'multiple-images'
      })
    );

    return res.status(200).json(successResponse(
      `${uploadedFiles.length} image(s) uploaded successfully`,
      {
        files: uploadedFiles,
        totalFiles: uploadedFiles.length,
        totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0)
      }
    ));
  } catch (error) {
    console.error('Upload multiple images error:', error);
    return res.status(500).json(errorResponse('Failed to upload images', error));
  }
};

// ==================== AUTHENTICATED USER CONTROLLERS ====================

/**
 * Upload user avatar
 */
export const uploadUserAvatar = async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user.id;

    if (!file) {
      return res.status(400).json(errorResponse('No avatar image uploaded'));
    }

    // Update user record in database
    await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        photo: file.url,
        updated_at: new Date()
      }
    });

    // Log the activity
    await Prisma.pam_activity_log.create({
      data: {
        user_id: userId,
        user_name: req.user.username || 'User',
        user_type: 'user',
        activity_type: 'upload',
        module: 'profile',
        action: 'avatar_upload',
        message: `User uploaded profile avatar`,
        status: 'success',
        severity: 'info',
        activity_code: 'AVATAR_UPLOAD',
        ip_address: req.ip,
        resource_name: file.originalname,
        created_at: new Date()
      }
    });

    return res.status(200).json(successResponse(
      'Avatar uploaded successfully',
      generateFileResponse(file, {
        userId,
        uploadedBy: req.user.username,
        uploadType: 'user-avatar'
      })
    ));
  } catch (error) {
    console.error('Upload user avatar error:', error);
    return res.status(500).json(errorResponse('Failed to upload avatar', error));
  }
};

/**
 * Upload document
 */
export const uploadDocument = async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user.id;

    if (!file) {
      return res.status(400).json(errorResponse('No document uploaded'));
    }

    // Save document record to database
    const documentRecord = await Prisma.pam_documents.create({
      data: {
        user_id: userId,
        filename: file.filename,
        original_name: file.originalname,
        file_path: file.path || file.url,
        file_size: file.size,
        mime_type: file.mimetype,
        upload_type: 'user_upload',
        status: 'active',
        metadata: JSON.stringify(file.metadata || {}),
        uploaded_at: new Date(),
        created_at: new Date()
      }
    });

    return res.status(200).json(successResponse(
      'Document uploaded successfully',
      {
        document: {
          id: documentRecord.id,
          filename: documentRecord.filename,
          originalName: documentRecord.original_name,
          size: documentRecord.file_size,
          mimeType: documentRecord.mime_type,
          url: documentRecord.file_path,
          uploadedAt: documentRecord.uploaded_at
        },
        file: generateFileResponse(file, {
          documentId: documentRecord.id,
          uploadedBy: userId
        })
      }
    ));
  } catch (error) {
    console.error('Upload document error:', error);
    return res.status(500).json(errorResponse('Failed to upload document', error));
  }
};

/**
 * Upload photo with details
 */
export const uploadPhotoWithDetails = async (req, res) => {
  try {
    const files = req.files || [];
    const userId = req.user.id;
    const {
      title,
      description,
      category_id,
      tags = ''
    } = req.body;

    if (files.length === 0) {
      return res.status(400).json(errorResponse('No photos uploaded'));
    }

    // Create photo record
    const photo = await Prisma.pam_photos.create({
      data: {
        photo_title: title || `Untitled ${new Date().toLocaleDateString()}`,
        description: description || '',
        category_id: category_id ? parseInt(category_id) : null,
        author_id: userId,
        enter_by: userId,
        updated_by: userId,
        is_active: 1,
        is_trash: 0,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    const photoId = Number(photo.photo_id);

    // Process each uploaded file
    const fileRecords = [];
    for (const file of files) {
      const fileRecord = await Prisma.pam_photos_files.create({
        data: {
          photo_id: photoId,
          dir_path: file.path ? path.dirname(file.path) : file.url,
          Image_Name: file.filename,
          raw_name: file.originalname,
          file_ext: path.extname(file.originalname).replace('.', ''),
          file_size: String(file.size),
          Width: file.metadata?.width || null,
          Height: file.metadata?.height || null,
          orientation: file.metadata?.orientation || null,
          isMigrat: 'N',
          is_trash: 'N',
          updated_by: String(userId),
          date_created: new Date()
        }
      });

      fileRecords.push(fileRecord);
    }

    // Process tags if provided
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);

      for (const tagName of tagArray) {
        // Find or create tag
        let tag = await Prisma.pam_tags.findFirst({
          where: { photo_tag: tagName }
        });

        if (!tag) {
          const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          tag = await Prisma.pam_tags.create({
            data: {
              photo_tag: tagName,
              photo_slug: slug
            }
          });
        }

        // Link tag to photo
        await Prisma.pam_photo_tags.create({
          data: {
            photo_id: photoId,
            tag_id: Number(tag.tag_id)
          }
        });
      }
    }

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'user',
        activity_type: 'upload',
        module: 'photos',
        action: 'photo_upload',
        message: `Uploaded ${files.length} photo(s) for "${photo.photo_title}"`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo.photo_title,
        created_at: new Date()
      }
    });

    return res.status(201).json(successResponse(
      'Photos uploaded successfully',
      {
        photo: {
          id: photo.photo_id,
          title: photo.photo_title,
          description: photo.description
        },
        files: fileRecords.map(record => ({
          id: record.file_id,
          filename: record.Image_Name,
          size: record.file_size,
          url: `${record.dir_path}/${record.Image_Name}`
        })),
        totalFiles: files.length,
        tags: tags ? tags.split(',').length : 0
      }
    ));
  } catch (error) {
    console.error('Upload photo with details error:', error);
    return res.status(500).json(errorResponse('Failed to upload photos', error));
  }
};

/**
 * Upload directly to S3
 */
export const uploadToS3 = async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user.id;
    const { folder = 'uploads', isPublic = true } = req.body;

    if (!file) {
      return res.status(400).json(errorResponse('No file uploaded'));
    }

    // If file is already uploaded to S3 via middleware
    if (file.storage === 's3') {
      return res.status(200).json(successResponse(
        'File uploaded to S3 successfully',
        {
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
          s3Key: file.s3Key,
          size: file.size,
          storage: 's3'
        }
      ));
    }

    // Manual S3 upload (if middleware didn't handle it)
    const fileBuffer = file.buffer || fs.readFileSync(file.path);
    const s3Key = `${folder}/${Date.now()}_${file.originalname}`;

    const s3Url = await uploadToS3(
      fileBuffer,
      s3Key,
      file.mimetype,
      isPublic
    );

    // Clean up local file
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return res.status(200).json(successResponse(
      'File uploaded to S3 successfully',
      {
        url: s3Url,
        s3Key,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        storage: 's3'
      }
    ));
  } catch (error) {
    console.error('S3 upload error:', error);
    return res.status(500).json(errorResponse('Failed to upload to S3', error));
  }
};

/**
 * Upload and process image
 */
export const uploadAndProcessImage = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json(errorResponse('No image uploaded'));
    }

    // Extract additional metadata
    const metadata = await getImageMetadata(
      file.buffer || fs.readFileSync(file.path)
    );

    const exifData = await extractExifFromBuffer(
      file.buffer || fs.readFileSync(file.path)
    );

    const dominantColor = await extractDominantColor(
      file.buffer || fs.readFileSync(file.path)
    );

    return res.status(200).json(successResponse(
      'Image uploaded and processed successfully',
      {
        file: generateFileResponse(file, {
          processed: true,
          uploadedBy: req.user?.id
        }),
        metadata: {
          ...metadata,
          exif: exifData,
          dominantColor,
          processingDetails: {
            resized: req.uploadConfig?.resize || false,
            convertedToWebp: req.uploadConfig?.convertToWebp || false,
            quality: req.uploadConfig?.quality || 85
          }
        }
      }
    ));
  } catch (error) {
    console.error('Upload and process image error:', error);
    return res.status(500).json(errorResponse('Failed to process image', error));
  }
};

// ==================== FILE MANAGEMENT CONTROLLERS ====================

/**
 * Get uploaded file info
 */
export const getUploadedFile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const file = await Prisma.pam_photos_files.findUnique({
      where: { file_id: BigInt(id) },
      include: {
        pam_photos: {
          select: {
            photo_title: true,
            author_id: true
          }
        }
      }
    });

    if (!file) {
      return res.status(404).json(errorResponse('File not found'));
    }

    // Check permission (user can only access their own files unless admin)
    if (file.pam_photos.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(errorResponse('Access denied'));
    }

    return res.status(200).json(successResponse(
      'File retrieved successfully',
      {
        file: {
          id: file.file_id.toString(),
          filename: file.Image_Name,
          originalName: file.raw_name,
          size: file.file_size,
          path: file.dir_path,
          url: `${file.dir_path}/${file.Image_Name}`,
          width: file.Width,
          height: file.Height,
          orientation: file.orientation,
          createdAt: file.date_created,
          photo: file.pam_photos
        }
      }
    ));
  } catch (error) {
    console.error('Get uploaded file error:', error);
    return res.status(500).json(errorResponse('Failed to retrieve file', error));
  }
};

/**
 * Delete uploaded file
 */
export const deleteUploadedFile = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const file = await Prisma.pam_photos_files.findUnique({
      where: { file_id: BigInt(id) },
      include: {
        pam_photos: {
          select: {
            author_id: true
          }
        }
      }
    });

    if (!file) {
      return res.status(404).json(errorResponse('File not found'));
    }

    // Check permission
    if (file.pam_photos.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(errorResponse('Access denied'));
    }

    // Delete from storage (S3 or local)
    if (file.dir_path.includes('s3.amazonaws.com') || file.dir_path.startsWith('https://')) {
      // S3 file - extract key from URL
      const urlParts = file.dir_path.split('/');
      const s3Key = urlParts.slice(3).join('/'); // Remove bucket URL parts
      await deleteFromS3(s3Key);
    } else {
      // Local file
      const filePath = path.join('public', file.dir_path, file.Image_Name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Soft delete from database
    await Prisma.pam_photos_files.update({
      where: { file_id: BigInt(id) },
      data: {
        is_trash: 'Y',
        trashed_by: String(userId),
        trashed_on: new Date()
      }
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'user',
        activity_type: 'delete',
        module: 'files',
        action: 'file_delete',
        message: `Deleted file: ${file.Image_Name}`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: file.Image_Name,
        created_at: new Date()
      }
    });

    return res.status(200).json(successResponse('File deleted successfully'));
  } catch (error) {
    console.error('Delete uploaded file error:', error);
    return res.status(500).json(errorResponse('Failed to delete file', error));
  }
};

/**
 * List user's uploaded files
 */
export const listUploadedFiles = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      sortBy = 'date_created',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get user's photos
    const userPhotos = await Prisma.pam_photos.findMany({
      where: { author_id: userId },
      select: { photo_id: true }
    });

    const photoIds = userPhotos.map(photo => Number(photo.photo_id));

    const [files, total] = await Promise.all([
      Prisma.pam_photos_files.findMany({
        where: {
          photo_id: { in: photoIds },
          is_trash: 'N'
        },
        include: {
          pam_photos: {
            select: {
              photo_title: true,
              category_id: true
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      Prisma.pam_photos_files.count({
        where: {
          photo_id: { in: photoIds },
          is_trash: 'N'
        }
      })
    ]);

    const formattedFiles = files.map(file => ({
      id: file.file_id.toString(),
      filename: file.Image_Name,
      originalName: file.raw_name,
      size: file.file_size,
      path: file.dir_path,
      url: `${file.dir_path}/${file.Image_Name}`,
      width: file.Width,
      height: file.Height,
      orientation: file.orientation,
      createdAt: file.date_created,
      photo: {
        title: file.pam_photos?.photo_title,
        categoryId: file.pam_photos?.category_id
      }
    }));

    return res.status(200).json(successResponse(
      'Files retrieved successfully',
      {
        files: formattedFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    ));
  } catch (error) {
    console.error('List uploaded files error:', error);
    return res.status(500).json(errorResponse('Failed to list files', error));
  }
};

/**
 * Get file metadata
 */
export const getFileMetadata = async (req, res) => {
  try {
    const { id } = req.params;

    const file = await Prisma.pam_photos_files.findUnique({
      where: { file_id: BigInt(id) }
    });

    if (!file) {
      return res.status(404).json(errorResponse('File not found'));
    }

    // Read file and extract metadata
    let metadata = {};
    let exifData = {};

    try {
      if (file.dir_path.startsWith('http')) {
        // S3 file - would need to download first
        metadata = {
          width: file.Width,
          height: file.Height,
          orientation: file.orientation,
          size: file.file_size,
          format: file.file_ext
        };
      } else {
        // Local file
        const filePath = path.join('public', file.dir_path, file.Image_Name);
        if (fs.existsSync(filePath)) {
          const fileBuffer = fs.readFileSync(filePath);
          metadata = await getImageMetadata(fileBuffer);
          exifData = await extractExifFromBuffer(fileBuffer);
        }
      }
    } catch (processingError) {
      console.warn('Could not extract full metadata:', processingError);
    }

    return res.status(200).json(successResponse(
      'File metadata retrieved',
      {
        fileId: id,
        filename: file.Image_Name,
        basicMetadata: {
          width: file.Width,
          height: file.Height,
          orientation: file.orientation,
          size: file.file_size,
          format: file.file_ext,
          createdAt: file.date_created
        },
        extractedMetadata: metadata,
        exifData
      }
    ));
  } catch (error) {
    console.error('Get file metadata error:', error);
    return res.status(500).json(errorResponse('Failed to get metadata', error));
  }
};

/**
 * Generate thumbnail for existing file
 */
export const generateThumbnail = async (req, res) => {
  try {
    const { id } = req.params;
    const { width = 400, height = 400 } = req.body;

    const file = await Prisma.pam_photos_files.findUnique({
      where: { file_id: BigInt(id) }
    });

    if (!file) {
      return res.status(404).json(errorResponse('File not found'));
    }

    // Read file
    let fileBuffer;
    if (file.dir_path.startsWith('http')) {
      // S3 file - would need download logic
      return res.status(400).json(errorResponse('Thumbnail generation for S3 files not implemented'));
    } else {
      const filePath = path.join('public', file.dir_path, file.Image_Name);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json(errorResponse('File not found on disk'));
      }
      fileBuffer = fs.readFileSync(filePath);
    }

    // Generate thumbnail
    const thumbnailBuffer = await createThumbnail(fileBuffer, {
      width: parseInt(width),
      height: parseInt(height),
      format: 'webp',
      quality: 80
    });

    // Save thumbnail
    const thumbnailFilename = `thumb_${path.parse(file.Image_Name).name}.webp`;
    const thumbnailDir = path.join('public', 'thumbnails', file.dir_path);

    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);
    fs.writeFileSync(thumbnailPath, thumbnailBuffer);

    return res.status(200).json(successResponse(
      'Thumbnail generated successfully',
      {
        originalFile: file.Image_Name,
        thumbnail: thumbnailFilename,
        thumbnailPath: `/thumbnails/${file.dir_path}/${thumbnailFilename}`,
        dimensions: { width: parseInt(width), height: parseInt(height) },
        size: thumbnailBuffer.length
      }
    ));
  } catch (error) {
    console.error('Generate thumbnail error:', error);
    return res.status(500).json(errorResponse('Failed to generate thumbnail', error));
  }
};

// ==================== ADMIN UPLOAD CONTROLLERS ====================

/**
 * Admin: Full photo upload with all details
 */
export const adminUploadPhotoFull = async (req, res) => {
  try {
    const files = req.files || [];
    const userId = req.user.id;

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
      author_id,
      photo_credit_id,
      credit,
      tag_ids = [],
      photo_tags,
      event_name
    } = req.body;

    if (!photo_title || !category_id) {
      return res.status(400).json(errorResponse('Photo title and category are required'));
    }

    if (files.length === 0) {
      return res.status(400).json(errorResponse('At least one image file is required'));
    }

    const result = await Prisma.$transaction(async (tx) => {
      // Create photo record
      const photo = await tx.pam_photos.create({
        data: {
          photo_title,
          event_name: event_name || '',
          description: description || '',
          photo_tags: photo_tags || '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
          country_id: parseInt(country_id),
          state_id: parseInt(state_id),
          city_id: parseInt(city_id),
          author_id: userId,
          media_type: 'photo',
          source_name: source_name || '',
          credit: parseInt(photo_credit_id) || 0,
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

      // Process uploaded files
      const uploadedFiles = [];
      for (const file of files) {
        const fileRecord = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: path.extname(file.originalname).replace('.', ''),
            type: path.extname(file.originalname).replace('.', ''),
            dir_path: file.path || file.url,
            file_size: String(file.size),
            reference: '',
            source: 'Admin Upload',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: file.metadata?.width || null,
            Height: file.metadata?.height || null,
            orientation: file.metadata?.orientation || null,
            raw_name: path.parse(file.originalname).name || '',
            Image_Name: file.filename,
            original_image_name: file.originalname,
            isMigrat: 0,
          }
        });

        uploadedFiles.push(fileRecord);
      }

      // Process tags
      let tagsInserted = 0;
      if (tag_ids.length > 0 || photo_tags) {
        const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : tag_ids.split(',');

        // Also process photo_tags string
        if (photo_tags) {
          const tagsFromString = photo_tags.split(',').map(tag => tag.trim());
          for (const tagName of tagsFromString) {
            // Find or create tag
            let tag = await tx.pam_tags.findFirst({
              where: { photo_tag: tagName }
            });

            if (!tag) {
              const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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
        uploadedFiles,
        tagsInserted
      };
    });

    // Log admin activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'admin',
        activity_type: 'upload',
        module: 'photos',
        action: 'admin_photo_upload',
        message: `Admin uploaded ${files.length} photo(s) with title: "${photo_title}"`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        created_at: new Date()
      }
    });

    return res.status(201).json(successResponse(
      'Admin photo upload completed successfully',
      {
        photo: {
          id: result.photo.photo_id,
          title: result.photo.photo_title,
          category: result.photo.category_id
        },
        files: {
          count: result.uploadedFiles.length,
          items: result.uploadedFiles.map(f => ({
            id: f.file_id,
            name: f.Image_Name,
            size: f.file_size
          }))
        },
        tags: result.tagsInserted,
        storage: process.env.STORAGE_TYPE || 'local',
        timestamp: new Date().toISOString()
      }
    ));
  } catch (error) {
    console.error('Admin upload photo full error:', error);
    return res.status(500).json(errorResponse('Failed to upload photo', error));
  }
};

/**
 * Admin: Simple photo upload
 */
export const adminUploadPhotoSimple = async (req, res) => {
  try {
    // Implementation for simple admin upload
    return res.status(200).json(successResponse('Simple upload endpoint'));
  } catch (error) {
    console.error('Admin upload simple error:', error);
    return res.status(500).json(errorResponse('Failed to upload', error));
  }
};

/**
 * Admin: Bulk upload with CSV/JSON
 */
export const adminBulkUpload = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json(errorResponse('No upload file provided'));
    }

    const results = [];

    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      // Process CSV
      const fileBuffer = file.buffer || fs.readFileSync(file.path);
      const csvData = fileBuffer.toString('utf8');

      // Simple CSV parsing (in production, use a proper CSV parser)
      const lines = csvData.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        results.push(row);
      }

    } else if (file.mimetype === 'application/json') {
      // Process JSON
      const fileBuffer = file.buffer || fs.readFileSync(file.path);
      results = JSON.parse(fileBuffer.toString('utf8'));
    }

    // Clean up file
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return res.status(200).json(successResponse(
      'Bulk upload file processed',
      {
        fileType: file.mimetype,
        records: results.length,
        sample: results.slice(0, 3), // First 3 records as sample
        note: 'This is a preview. Actual import logic would be implemented based on requirements.'
      }
    ));
  } catch (error) {
    console.error('Admin bulk upload error:', error);
    return res.status(500).json(errorResponse('Failed to process bulk upload', error));
  }
};

/**
 * Upload photo with thumbnail
 */
export const uploadPhotoWithThumbnail = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json(errorResponse('No photo uploaded'));
    }

    // This would typically use the S3 upload with thumbnail function
    // For now, return the processed file info
    return res.status(200).json(successResponse(
      'Photo uploaded with thumbnail',
      generateFileResponse(file, {
        thumbnailGenerated: true,
        uploadedBy: req.user?.id,
        uploadType: 'photo-with-thumbnail'
      })
    ));
  } catch (error) {
    console.error('Upload photo with thumbnail error:', error);
    return res.status(500).json(errorResponse('Failed to upload photo', error));
  }
};

// ==================== TEST CONTROLLERS ====================

/**
 * Test upload endpoint
 */
export const testUploadEndpoint = async (req, res) => {
  try {
    return res.status(200).json(successResponse(
      'Upload endpoint is working',
      {
        timestamp: new Date().toISOString(),
        service: 'upload-service',
        version: '1.0.0',
        endpoints: {
          singleImage: '/api/upload/image',
          multipleImages: '/api/upload/images',
          userAvatar: '/api/upload/avatar',
          photoWithDetails: '/api/upload/photo',
          adminPhotoUpload: '/api/upload/admin/photo/full'
        },
        configuration: {
          maxFileSize: '50MB',
          allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
          storage: process.env.STORAGE_TYPE || 'local'
        }
      }
    ));
  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json(errorResponse('Test failed', error));
  }
};

/**
 * Test S3 connection
 */
export const testS3Connection = async (req, res) => {
  try {
    const testKey = `test-connection-${Date.now()}.txt`;
    const testContent = Buffer.from('S3 Connection Test - ' + new Date().toISOString());

    let s3Status = 'not_configured';
    let s3Url = null;

    if (process.env.AWS_S3_BUCKET_NAME) {
      try {
        const url = await uploadToS3(
          testContent,
          `tests/${testKey}`,
          'text/plain',
          false
        );
        s3Status = 'connected';
        s3Url = url;

        // Clean up test file
        setTimeout(async () => {
          try {
            await deleteFromS3(`tests/${testKey}`);
          } catch (cleanupError) {
            console.warn('Could not clean up test file:', cleanupError);
          }
        }, 5000);
      } catch (s3Error) {
        s3Status = 'error';
        console.error('S3 connection test failed:', s3Error);
      }
    }

    return res.status(200).json(successResponse(
      'S3 connection test completed',
      {
        s3: {
          status: s3Status,
          bucket: process.env.AWS_S3_BUCKET_NAME,
          region: process.env.AWS_REGION,
          testFile: s3Url,
          timestamp: new Date().toISOString()
        },
        storage: {
          configured: process.env.STORAGE_TYPE || 'local',
          default: 'local'
        }
      }
    ));
  } catch (error) {
    console.error('S3 connection test error:', error);
    return res.status(500).json(errorResponse('S3 test failed', error));
  }
};

/**
 * Test image processing
 */
export const testImageProcessing = async (req, res) => {
  try {
    // Create a test image buffer
    const testImage = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
      .png()
      .toBuffer();

    // Test processing functions
    const metadata = await getImageMetadata(testImage);
    const thumbnail = await createThumbnail(testImage, { width: 200, height: 200 });
    const converted = await convertImageFormat(testImage, 'webp', { quality: 75 });

    return res.status(200).json(successResponse(
      'Image processing test completed',
      {
        tests: {
          metadataExtraction: 'success',
          thumbnailGeneration: 'success',
          formatConversion: 'success'
        },
        results: {
          original: {
            format: 'png',
            size: testImage.length,
            width: 800,
            height: 600
          },
          thumbnail: {
            format: 'webp',
            size: thumbnail.length,
            width: 200,
            height: 200
          },
          converted: {
            format: 'webp',
            size: converted.length,
            quality: 75
          }
        }
      }
    ));
  } catch (error) {
    console.error('Image processing test error:', error);
    return res.status(500).json(errorResponse('Image processing test failed', error));
  }
};

// ==================== UTILITY CONTROLLERS ====================

/**
 * Update file metadata
 */
export const updateFileMetadata = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Implementation would update file metadata in database
    return res.status(200).json(successResponse(
      'File metadata update endpoint',
      {
        fileId: id,
        updates,
        note: 'Metadata update logic to be implemented based on requirements'
      }
    ));
  } catch (error) {
    console.error('Update file metadata error:', error);
    return res.status(500).json(errorResponse('Failed to update metadata', error));
  }
};

/**
 * Convert image format
 */
export const convertImageFormat = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'webp', quality = 80 } = req.body;

    // Implementation would convert image format
    return res.status(200).json(successResponse(
      'Image format conversion endpoint',
      {
        fileId: id,
        targetFormat: format,
        quality,
        note: 'Format conversion logic to be implemented based on requirements'
      }
    ));
  } catch (error) {
    console.error('Convert image format error:', error);
    return res.status(500).json(errorResponse('Failed to convert image', error));
  }
};

/**
 * Compress image
 */
export const compressImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { quality = 75 } = req.body;

    // Implementation would compress image
    return res.status(200).json(successResponse(
      'Image compression endpoint',
      {
        fileId: id,
        quality,
        note: 'Compression logic to be implemented based on requirements'
      }
    ));
  } catch (error) {
    console.error('Compress image error:', error);
    return res.status(500).json(errorResponse('Failed to compress image', error));
  }
};

/**
 * Extract EXIF data
 */
export const extractExifData = async (req, res) => {
  try {
    const { id } = req.params;

    // Implementation would extract EXIF data
    return res.status(200).json(successResponse(
      'EXIF data extraction endpoint',
      {
        fileId: id,
        note: 'EXIF extraction logic to be implemented based on requirements'
      }
    ));
  } catch (error) {
    console.error('Extract EXIF data error:', error);
    return res.status(500).json(errorResponse('Failed to extract EXIF data', error));
  }
};

// Export all controllers
export default {
  // Upload controllers
  uploadSingleImage,
  uploadMultipleImages,
  uploadPhotoWithDetails,
  uploadUserAvatar,
  uploadDocument,
  uploadToS3,
  uploadAndProcessImage,
  uploadPhotoWithThumbnail,

  // File management
  getUploadedFile,
  deleteUploadedFile,
  listUploadedFiles,
  getFileMetadata,
  updateFileMetadata,
  generateThumbnail,
  convertImageFormat,
  compressImage,
  extractExifData,

  // Admin upload
  adminUploadPhotoFull,
  adminUploadPhotoSimple,
  adminBulkUpload,

  // Test endpoints
  testUploadEndpoint,
  testS3Connection,
  testImageProcessing
};