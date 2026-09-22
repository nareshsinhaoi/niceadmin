import { Prisma } from '../../config/db.js';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import exifr from 'exifr';
import { v4 as uuidv4 } from 'uuid';
import csv from 'csv-parser';
import { Readable } from 'stream';
import JSZip from 'jszip';


// Import utilities
import {
  serializeBigInt,
  bufferToString,
  parseToNumber,
  getOrientationScientific,
  convertBigIntToString
} from '../../utils/helpers.js';

import {
  uploadImageWithThumbnail,
  deleteFromS3,
  getPublicUrl,
  generateS3Key,
  uploadToS3,
  uploadToS3Direct
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

/**
 * Get all photos with pagination
 */
export const getAllPhotos = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build where clause for active, non-trash photos
    const where = {
      is_active: 1,
      is_trash: 0
    };

    // Optional category filter
    if (req.query.category_id) {
      where.category_id = parseInt(req.query.category_id);
    }

    // Optional author filter
    if (req.query.author_id) {
      where.author_id = parseInt(req.query.author_id);
    }

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos with pagination
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy: {
        photo_id: 'desc'
      },
      skip,
      take: limit,
      include: {
        category: {
          select: {
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true
          }
        }
      }
    });

    // Process each photo to get file count and first file
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get file count
        const fileCount = await Prisma.pam_photos_files.count({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          },
          orderBy: {
            file_id: 'asc'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          author_id: photo.author_id,
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          price: photo.price,
          photography_time: photo.photography_time,
          created_at: photo.created_at,
          num_files: fileCount,
          thumbnail: firstFile ? {
            file_id: firstFile.file_id,
            filename: firstFile.Image_Name,
            path: firstFile.dir_path,
            url: `${firstFile.dir_path}/${firstFile.Image_Name}`
          } : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: results,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit),
          hasNext: page * limit < totalRecords,
          hasPrevious: page > 1
        }
      })
    );
  } catch (error) {
    console.error('Get all photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos', error)
    );
  }
};

/**
 * Get photo by ID
 */
export const getPhotoById = async (req, res) => {
  console.log("=== getPhotoById ===");

  try {
    const { id } = req.params;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    const photo = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: BigInt(photoId)
      },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true
          }
        },
        sub_category: {
          select: {
            sub_category_id: true,
            name: true,
            slug: true
          }
        },
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        },
        state: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        city: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true,
            email: true,
            photo: true
          }
        },
        // credit_info: {
        //   select: {
        //     id: true,
        //     firstname: true,
        //     lastname: true,
        //     email: true
        //   }
        // }
      }
    });

    if (!photo) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check if photo is active and not trashed (unless admin)
    if (photo.is_active !== 1 || photo.is_trash !== 0) {
      // Check if user is admin
      const isAdmin = req.user?.role === 'admin';
      if (!isAdmin) {
        return res.status(404).json(
          errorResponse('Photo not found')
        );
      }
    }

    // Get all files for this photo
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        photo_id: photoId,
        is_trash: 'N'
      },
      orderBy: {
        file_id: 'asc'
      }
    });

    // Get tags for this photo
    const tags = await Prisma.pam_photo_tags.findMany({
      where: {
        photo_id: photoId
      },
      include: {
        tag: {
          select: {
            tag_id: true,
            photo_tag: true,
            photo_slug: true
          }
        }
      }
    });

    // Get view count
    // const viewCount = await Prisma.pam_photo_views.count({
    //   where: {
    //     photo_id: photoId
    //   }
    // });

    // // Get download count
    // const downloadCount = await Prisma.pam_photo_downloads.count({
    //   where: {
    //     photo_id: photoId
    //   }
    // });

    const photoData = serializeBigInt({
      ...photo,
      photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
      files: files.map(file => ({
        ...file,
        url: `${file.dir_path}/${file.Image_Name}`,
        thumbnail_url: file.dir_path.includes('400')
          ? `${file.dir_path}/${file.Image_Name}`
          : `${file.dir_path.replace('/uploads/', '/uploads/400/')}/${file.Image_Name}`
      })),
      tags: tags.map(t => t.tag),
      statistics: {
        views: 0, // viewCount,
        downloads: 0, // downloadCount,
        files_count: files.length
      },
      permissions: {
        can_edit: req.user?.id === photo.author_id || req.user?.role === 'admin',
        can_delete: req.user?.id === photo.author_id || req.user?.role === 'admin'
      }
    });

    return res.status(200).json(
      successResponse('Photo retrieved successfully', photoData)
    );
  } catch (error) {
    console.error('Get photo by ID error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo', error)
    );
  }
};

/**
 * Get photo files
 */

export const getPhotoFiles = async (req, res) => {
  console.log("--- @@getPhotoFiles@@ ---")
  try {
    const { id } = req.params;
    const photoId = parseInt(id);
    const { page = 1, limit = 50 } = req.query;

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get photo with all details including tags using include
    const photoWithDetails = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      include: {
        category: {
          select: {
            name: true,
            slug: true
          }
        },
        sub_category: {
          select: {
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            username: true
          }
        },
        tags: {
          include: {
            tag: {
              select: {
                tag_id: true,
                photo_tag: true,
                photo_slug: true
              }
            }
          }
        }
      }
    });

    if (!photoWithDetails) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check permissions
    const isOwner = req.user?.id === photoWithDetails.author_id;
    const isAdmin = req.user?.role === 'admin';
    const isPublic = photoWithDetails.is_active === 1 && photoWithDetails.is_trash === 0;

    if (!isPublic && !isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('Access denied')
      );
    }

    // Get files with pagination
    const [files, total] = await Promise.all([
      Prisma.pam_photos_files.findMany({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        },
        orderBy: {
          file_id: 'asc'
        },
        skip,
        take: parseInt(limit)
      }),
      Prisma.pam_photos_files.count({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        }
      })
    ]);

    // Format tags from the photo - convert BigInt to string
    const formattedTags = photoWithDetails.tags.map(pt => ({
      tag_id: pt.tag.tag_id ? pt.tag.tag_id.toString() : null,
      name: pt.tag.photo_tag,
      slug: pt.tag.photo_slug
    }));


    // console.log("FILES: ", files);

    // Format files - convert all BigInt to string
    const formattedFiles = files.map(file => ({
      file_id: file.file_id ? file.file_id.toString() : null,
      photo_id: file.photo_id ? file.photo_id.toString() : null,
      file_ext: file.file_ext,
      type: file.type,

      photo_title: file.photo_title,
      photo_caption: file.photo_caption, // Will be empty string if not found
      photo_copyright: file.photo_copyright,
      downloads: file.downloads,

      dir_path: file.dir_path,
      file_size: file.file_size,
      reference: file.reference,
      source: file.source,
      date_created: file.date_created,
      enter_by: file.enter_by,
      entered_on: file.entered_on,
      updated_by: file.updated_by,
      updated_on: file.updated_on,
      is_trash: file.is_trash,
      trashed_by: file.trashed_by,
      trashed_on: file.trashed_on,
      Width: file.Width,
      Height: file.Height,
      orientation: file.orientation,
      raw_name: file.raw_name,
      Image_Name: file.Image_Name,
      original_image_name: file.original_image_name,
      isMigrat: file.isMigrat,
      migratedFilePath: file.migratedFilePath,
      migratedFileName: file.migratedFileName,
      is_cover: file.is_cover,
      dominant_color: file.dominant_color,
      url: `${file.dir_path}/${file.Image_Name}`,
      thumbnail_url: file.dir_path.includes('400')
        ? `${file.dir_path}/${file.Image_Name}`
        : `${file.dir_path.replace('/uploads/', '/uploads/400/')}/${file.Image_Name}`,
      metadata: {
        width: file.Width,
        height: file.Height,
        orientation: file.orientation,
        size: file.file_size,
        format: file.file_ext
      }
    }));

    // Format photo data - convert all BigInt to string
    const formattedPhoto = {
      photo_id: photoWithDetails.photo_id ? photoWithDetails.photo_id.toString() : null,
      photo_title: photoWithDetails.photo_title,
      source_name : photoWithDetails.source_name,
      credit: photoWithDetails.credit,
      description: photoWithDetails.description,
      event_name: photoWithDetails.event_name,
      category_id: photoWithDetails.category_id ? photoWithDetails.category_id.toString() : null,
      category_name: photoWithDetails.category?.name,
      category_slug: photoWithDetails.category?.slug,
      sub_category_id: photoWithDetails.sub_category_id ? photoWithDetails.sub_category_id.toString() : null,
      sub_category_name: photoWithDetails.sub_category?.name,
      sub_category_slug: photoWithDetails.sub_category?.slug,
      price: photoWithDetails.price,
      photography_time: photoWithDetails.photography_time,
      author_id: photoWithDetails.author_id ? photoWithDetails.author_id.toString() : null,
      author_name: photoWithDetails.user 
        ? `${photoWithDetails.user.firstname} ${photoWithDetails.user.lastname}`
        : null,
      tags: formattedTags,
      is_active: photoWithDetails.is_active,
      is_trash: photoWithDetails.is_trash,
      // Add any other fields you need
    };

    return res.status(200).json(
      successResponse('Photo files retrieved successfully', {
        photo: formattedPhoto,
        files: formattedFiles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      })
    );
  } catch (error) {
    console.error('Get photo files error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo files', error)
    );
  }
};

export const getPhotoFiles22222222222 = async (req, res) => {
  console.log("--- getPhotoFiles ---")
  try {
    const { id } = req.params;
    const photoId = parseInt(id);
    const { page = 1, limit = 50 } = req.query;

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check if photo exists and is accessible
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      select: { is_active: true, is_trash: true, author_id: true }
    });

    if (!photo) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check permissions
    const isOwner = req.user?.id === photo.author_id;
    const isAdmin = req.user?.role === 'admin';
    const isPublic = photo.is_active === 1 && photo.is_trash === 0;

    if (!isPublic && !isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('Access denied')
      );
    }

    // Get files with pagination
    const [files, total] = await Promise.all([
      Prisma.pam_photos_files.findMany({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        },
        orderBy: {
          file_id: 'asc'
        },
        skip,
        take: parseInt(limit)
      }),
      Prisma.pam_photos_files.count({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        }
      })
    ]);

    const formattedFiles = files.map(file => ({
      ...file,
      file_id: file.file_id.toString(),
      url: `${file.dir_path}/${file.Image_Name}`,
      thumbnail_url: file.dir_path.includes('400')
        ? `${file.dir_path}/${file.Image_Name}`
        : `${file.dir_path.replace('/uploads/', '/uploads/400/')}/${file.Image_Name}`,
      metadata: {
        width: file.Width,
        height: file.Height,
        orientation: file.orientation,
        size: file.file_size,
        format: file.file_ext
      }
    }));

    return res.status(200).json(
      successResponse('Photo files retrieved successfully', {
        files: serializeBigInt(formattedFiles),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      })
    );
  } catch (error) {
    console.error('Get photo files error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo files', error)
    );
  }
};

/**
 * Get photo by encoded ID (legacy support)
 */
export const getPhotoByEncodedId = async (req, res) => {
  try {
    const { photo_id } = req.params;

    // Decode photo_id from base64
    let decodedId;
    try {
      decodedId = Buffer.from(photo_id, 'base64').toString('utf-8');
    } catch {
      return res.status(400).json(
        errorResponse('Invalid encoded photo ID')
      );
    }

    const photoId = parseInt(decodedId);
    if (!photoId || isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Get photo details
    const photo = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: BigInt(photoId)
      }
    });

    if (!photo) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check if photo is active and not trashed
    if (photo.is_active !== 1 || photo.is_trash !== 0) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Get all files for this photo
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        photo_id: photoId,
        is_trash: 'N'
      },
      orderBy: {
        file_id: 'asc'
      },
      select: {
        file_id: true,
        dir_path: true,
        Image_Name: true,
        raw_name: true,
        file_ext: true,
        Width: true,
        Height: true,
        file_size: true,
        isMigrat: true,
        migratedFilePath: true,
        migratedFileName: true
      }
    });

    const response = serializeBigInt({
      photo: {
        photo_id: photo.photo_id,
        photo_id_enc: photo_id,
        photo_title: photo.photo_title,
        description: photo.description,
        event_name: photo.event_name,
        photography_time: photo.photography_time,
        price: photo.price,
        author_id: photo.author_id,
        category_id: photo.category_id
      },
      total_files: files.length,
      files
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error('Get photo by encoded ID error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo details', error)
    );
  }
};

/**
 * Filter photos
*/
function toTitleCase(str) {
  return str.toLowerCase().split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

export const filterPhotos_V1 = async (req, res) => {
  console.log("---I am here in filterPhotos---");
  //console.log("Filter Data: ", JSON.stringify(req.query))

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const {
      search,
      cat: category,
      subcat: subCategory,
      tags,
      orientation,
      location,
      contentType,
      dateRange,
      date_from,  // New parameter for custom start date
      date_to,    // New parameter for custom end date
      country_id,
      state_id,
      city_id,
      min_price,
      max_price,
      sort_by = 'photo_id',
      sort_order = 'desc'
    } = req.query;
    // console.log("Tags: ", tags);
    // Helper function to safely format date
    const safeFormatDate = (dateValue) => {
      if (!dateValue) return null;
      try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-GB');
      } catch (error) {
        console.error('Error formatting date:', dateValue, error);
        return null;
      }
    };

    // Helper function to calculate orientation
    const getOrientationScientific = (width, height, tolerance = 0.05) => {
      if (!width || !height) return null;
      const ratio = width / height;
      if (ratio > 1 + tolerance) return "horizontal";
      if (ratio < 1 - tolerance) return "vertical";
      return "square";
    };

    // Build where clause
    const where = {
      is_active: 1,
      is_trash: 0
    };

    // METHOD : 1 

    // Search filter
    // if (search) {
    //   where.OR = [
    //     { photo_title: { contains: search } },
    //     { description: { contains: search  } },
    //     { event_name: { contains: search  } },
    //     { photo_tags: { contains: search  } }
    //   ];
    // }

    // METHOD : 2 

    // if (search) {
    //   const searchTerm = search.trim();
    //   const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0); 
    //   console.log('searchWords: ', searchWords);

    //   where.OR = searchWords.map(word => ({
    //     OR: [
    //       { photo_title: { contains: word } },
    //       { description: { contains: word} },
    //       { event_name: { contains: word} },
    //       { photo_tags: { contains: word} }
    //     ]
    //   }));
    //   console.log('Search where clause:', JSON.stringify(where.OR, null, 2));
    // }

    /*
    // METHOD : 3 WORKING
    if (search) {
      const searchTerm = search.trim();

      // Convert search term to lowercase for consistent matching
      const lowerSearchTerm = searchTerm.toLowerCase();

      // Also create an uppercase version for broader matching
      // const upperSearchTerm = searchTerm.toUpperCase();
      const TitleCaseTerm = toTitleCase(searchTerm);

      // Create multiple case variations for matching
      where.OR = [
        // Original case
        { photo_title: { contains: searchTerm } },
        { description: { contains: searchTerm } },
        { event_name: { contains: searchTerm } },
        { photo_tags: { contains: searchTerm } },

        // Lowercase
        { photo_title: { contains: lowerSearchTerm } },
        { description: { contains: lowerSearchTerm } },
        { event_name: { contains: lowerSearchTerm } },
        { photo_tags: { contains: lowerSearchTerm } },

        // Lowercase
        { photo_title: { contains: TitleCaseTerm } },
        { description: { contains: TitleCaseTerm } },
        { event_name: { contains: TitleCaseTerm } },
        { photo_tags: { contains: TitleCaseTerm } }
      ];
      //console.log('Search where clause:', JSON.stringify(where.OR, null, 2)); 
    }
    */


    // METHOD : 3 - Two-step search (Best performance)
    // if (search) {
    //   const searchTerm = search.trim();

    //   // Step 1: Search for photo IDs in files table that match
    //   const matchingFilePhotoIds = await Prisma.pam_photos_files.findMany({
    //     where: {
    //       OR: [
    //         { photo_title: { contains: searchTerm, mode: 'insensitive' } },
    //         { photo_caption: { contains: searchTerm, mode: 'insensitive' } }
    //       ]
    //     },
    //     select: {
    //       photo_id: true
    //     },
    //     distinct: ['photo_id']
    //   });

    //   const photoIdsFromFiles = matchingFilePhotoIds.map(f => f.photo_id);

    //   // Step 2: Build search conditions for photo table
    //   const photoSearchConditions = [
    //     { photo_title: { contains: searchTerm, mode: 'insensitive' } },
    //     { description: { contains: searchTerm, mode: 'insensitive' } },
    //     { event_name: { contains: searchTerm, mode: 'insensitive' } },
    //     { photo_tags: { contains: searchTerm, mode: 'insensitive' } }
    //   ];

    //   // Step 3: Add photo IDs from file search if any
    //   if (photoIdsFromFiles.length > 0) {
    //     photoSearchConditions.push({
    //       photo_id: { in: photoIdsFromFiles }
    //     });
    //   }

    //   where.OR = photoSearchConditions;

    //   console.log('🔍 Two-Step Search:');
    //   console.log('📝 Found photo IDs from files:', photoIdsFromFiles.length);
    //   console.log('📝 Search where clause:', JSON.stringify(where.OR, null, 2));
    // }

    // METHOD : 3 - Raw SQL with UNION
    if (search) {
      const searchTerm = search.trim();

      // This is a fallback to handle the search with raw SQL
      // Build a raw SQL query that's more efficient
      const photoIdsFromSearch = await Prisma.$queryRaw`
    SELECT DISTINCT p.photo_id 
    FROM pam_photos p
    LEFT JOIN pam_photos_files pf ON p.photo_id = pf.photo_id
    WHERE 
      p.photo_title LIKE ${`%${searchTerm}%`} OR
      p.description LIKE ${`%${searchTerm}%`} OR
      p.event_name LIKE ${`%${searchTerm}%`} OR
      p.photo_tags LIKE ${`%${searchTerm}%`} OR
      pf.photo_title LIKE ${`%${searchTerm}%`} OR
      pf.photo_caption LIKE ${`%${searchTerm}%`}
  `;
      const photoIds = photoIdsFromSearch.map(row => row.photo_id);
      if (photoIds.length > 0) {
        where.photo_id = { in: photoIds };
      } else {
        // If no results, force empty result
        where.photo_id = { in: [] };
      }
      // console.log('🔍 Raw SQL Search found photo IDs:', photoIds.length);
    }



    // Tag filter - Filter by tags using the relation
    if (tags) {
      // Split tags by comma and trim whitespace
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

      if (tagArray.length > 0) {
        // Use AND condition for multiple tags (photo must have ALL specified tags)
        where.AND = tagArray.map(tag => ({
          tags: {
            some: {
              tag: {
                photo_tag: {
                  contains: tag
                }
              }
            }
          }
        }));

        // Alternative: Use OR condition (photo has ANY of the specified tags)
        // Uncomment below and comment above for OR condition
        /*
        where.tags = {
          some: {
            tag: {
              photo_tag: {
                in: tagArray
              }
            }
          }
        };
        */
      }
    }

    // Category filter
    if (category) {
      where.category_id = parseInt(category);
    }

    // Subcategory filter
    if (subCategory) {
      where.sub_category_id = parseInt(subCategory);
    }

    // Location filters
    if (country_id) {
      where.country_id = parseInt(country_id);
    }
    if (state_id) {
      where.state_id = parseInt(state_id);
    }
    if (city_id) {
      where.city_id = parseInt(city_id);
    }

    // Price filters
    if (min_price || max_price) {
      where.price = {};
      if (min_price) {
        where.price.gte = parseFloat(min_price);
      }
      if (max_price) {
        where.price.lte = parseFloat(max_price);
      }
    }

    // Date range filter - Handle both preset ranges and custom dates
    if (date_from || date_to) {
      // Custom date range takes precedence
      where.photography_time = {};

      if (date_from) {
        const fromDate = new Date(date_from);
        if (!isNaN(fromDate.getTime())) {
          fromDate.setHours(0, 0, 0, 0); // Start of the day
          where.photography_time.gte = fromDate;
        } else {
          console.error('Invalid date_from value:', date_from);
        }
      }

      if (date_to) {
        const toDate = new Date(date_to);
        if (!isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999); // End of the day
          where.photography_time.lte = toDate;
        } else {
          console.error('Invalid date_to value:', date_to);
        }
      }
    } else if (dateRange && dateRange !== 'anytime') {
      // Preset date ranges
      const currentDate = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case '24h':
          startDate.setHours(currentDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(currentDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(currentDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(currentDate.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(currentDate.getFullYear() - 1);
          break;
      }

      where.photography_time = {
        gte: startDate
      };
    }

    // 🔧 FIX: When sorting by photography_time, add a condition to exclude null values
    // Use gte with a very old date instead of 'not: null'
    if (sort_by === 'photography_time') {
      if (!where.photography_time) {
        // If no date filter exists, add condition to exclude nulls by requiring date >= year 1970
        where.photography_time = {
          gte: new Date('1970-01-01')
        };
      } else if (typeof where.photography_time === 'object') {
        // If date filter already exists, ensure we have a gte condition
        if (!where.photography_time.gte) {
          where.photography_time.gte = new Date('1970-01-01');
        }
      }
    }

    // Validate sort field
    const allowedSortFields = [
      'photo_id',
      'photo_title',
      'price',
      'photography_time',
      'entered_on',
      'updated_on',
      'category_id',
      'sub_category_id',
      'country_id',
      'state_id',
      'city_id'
    ];

    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photo_id';
    const orderBy = {
      [sortBy]: sort_order === 'asc' ? 'asc' : 'desc'
    };

    // **Strategy: Fetch in larger batches to account for orientation filtering**
    if (orientation) {
      const normalizedOrientation = orientation.toLowerCase();
      const fetchMultiplier = 5;
      const fetchLimit = limit * fetchMultiplier;

      // Get photos with basic filters
      const photos = await Prisma.pam_photos.findMany({
        where,
        orderBy,
        skip: 0,
        take: fetchLimit,
        include: {
          category: {
            select: {
              name: true,
              slug: true
            }
          },
          sub_category: {
            select: {
              name: true,
              slug: true
            }
          },
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true
            }
          },
          // Include tags in the response
          tags: {
            include: {
              tag: {
                select: {
                  tag_id: true,
                  photo_tag: true,
                  photo_slug: true
                }
              }
            }
          }
        }
      });

      // Process each photo and filter by orientation
      const resultsWithOrientation = await Promise.all(
        photos.map(async (photo) => {
          const photoId = Number(photo.photo_id);

          // Get file count
          const fileCount = await Prisma.pam_photos_files.count({
            where: {
              photo_id: photoId,
              is_trash: 'N'
            }
          });

          // Get first file (prefer cover image if available)
          const firstFile = await Prisma.pam_photos_files.findFirst({
            where: {
              photo_id: photoId,
              is_trash: 'N'
            },
            orderBy: {
              is_cover: 'desc' // This will put cover images first
            },
            select: {
              file_id: true,
              dir_path: true,
              Image_Name: true,
              Width: true,
              Height: true,
              isMigrat: true,
              migratedFilePath: true,
              migratedFileName: true,
              is_cover: true,
              dominant_color: true,

              photo_title: true,  
              photo_caption: true,  
              photo_copyright: true
            }
          });

          // Calculate orientation from Width and Height
          let calculatedOrientation = null;
          if (firstFile && firstFile.Width && firstFile.Height) {
            calculatedOrientation = getOrientationScientific(firstFile.Width, firstFile.Height);
          }

          // Extract tags
          const photoTags = photo.tags?.map(pt => ({
            tag_id: pt.tag.tag_id,
            name: pt.tag.photo_tag,
            slug: pt.tag.photo_slug
          })) || [];

          return {
            photo,
            fileCount,
            firstFile,
            calculatedOrientation,
            tags: photoTags
          };
        })
      );

      // Filter by orientation
      const filteredItems = resultsWithOrientation.filter(item =>
        item.calculatedOrientation === normalizedOrientation
      );

      // Apply pagination
      const startIndex = Math.min(skip, filteredItems.length);
      const endIndex = Math.min(skip + limit, filteredItems.length);
      const paginatedItems = filteredItems.slice(startIndex, endIndex);

      // Format results
      const results = paginatedItems.map(item => {
        const { photo, fileCount, firstFile, calculatedOrientation, tags } = item;
        const photoId = Number(photo.photo_id);

        // Construct image URL based on migration status
        let imageUrl = null;
        if (firstFile) {
          if (firstFile.isMigrat === 1 && firstFile.migratedFilePath && firstFile.migratedFileName) {
            imageUrl = `${firstFile.migratedFilePath}${firstFile.migratedFileName}`;
          } else if (firstFile.dir_path && firstFile.Image_Name) {
            imageUrl = `${firstFile.dir_path}${firstFile.Image_Name}`;
          }
        }

        // 🔧 SAFELY format photography_time
        let formattedDateTime = null;
        let photographyTimeValue = null;

        if (photo.photography_time) {
          try {
            const dateObj = new Date(photo.photography_time);
            if (!isNaN(dateObj.getTime())) {
              formattedDateTime = dateObj.toLocaleDateString('en-GB');
              photographyTimeValue = photo.photography_time;
            } else {
              console.error('Invalid photography_time for photo:', photo.photo_id, photo.photography_time);
            }
          } catch (err) {
            console.error('Error parsing photography_time for photo:', photo.photo_id, err);
          }
        }

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          category_slug: photo.category?.slug,
          sub_category_id: photo.sub_category_id,
          sub_category_name: photo.sub_category?.name,
          sub_category_slug: photo.sub_category?.slug,
          price: photo.price,
          photography_time: photographyTimeValue,
          datetime: formattedDateTime,
          author_id: photo.author_id,
          author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
          entered_on: photo.entered_on,
          updated_on: photo.updated_on,
          num_files: fileCount,
          tags: tags,
          credit: photo.credit || 0, 
          photos: firstFile ? {
            file_id: firstFile.file_id,
            Image_Name: firstFile.Image_Name,
            isMigrat: firstFile.isMigrat,
            dir_path: firstFile.dir_path,
            migratedFilePath: firstFile.migratedFilePath,
            migratedFileName: firstFile.migratedFileName,
            Width: firstFile.Width,
            Height: firstFile.Height,
            orientation: calculatedOrientation,
            is_cover: firstFile.is_cover,
            dominant_color: firstFile.dominant_color,
            url: imageUrl,

            photo_title:firstFile.photo_title|| null,  
            photo_title:firstFile.photo_caption|| null,  
            photo_title:firstFile.photo_copyright|| null
          } : null
        };
      });

      const totalWithoutOrientation = await Prisma.pam_photos.count({ where });
      const estimatedTotalWithOrientation = Math.floor(totalWithoutOrientation / 3);

      return res.status(200).json(
        serializeBigInt({
          status: 'success',
          results: results,
          pagination: {
            page,
            limit,
            totalRecords: estimatedTotalWithOrientation,
            filteredCount: results.length,
            totalPages: Math.ceil(estimatedTotalWithOrientation / limit),
            appliedFilters: {
              search: search || null,
              category: category || null,
              subCategory: subCategory || null,
              tags: tags || null,
              orientation: orientation || null,
              dateRange: dateRange || null,
              date_from: date_from || null,
              date_to: date_to || null,
              sortBy,
              sortOrder: sort_order
            }
          }
        })
      );
    }
    else {
      // NO ORIENTATION FILTER - simpler case

      // Get total count
      const totalRecords = await Prisma.pam_photos.count({
        where
      });

      // Get filtered photos
      const photos = await Prisma.pam_photos.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          category: {
            select: {
              name: true,
              slug: true
            }
          },
          sub_category: {
            select: {
              name: true,
              slug: true
            }
          },
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true
            }
          },
          // Include tags in the response
          tags: {
            include: {
              tag: {
                select: {
                  tag_id: true,
                  photo_tag: true,
                  photo_slug: true
                }
              }
            }
          }
        }
      });

      // Process each photo
      const results = await Promise.all(
        photos.map(async (photo) => {
          const photoId = Number(photo.photo_id);

          // Get file count
          const fileCount = await Prisma.pam_photos_files.count({
            where: {
              photo_id: photoId,
              is_trash: 'N'
            }
          });

          // Get first file (prefer cover image if available)
          const firstFile = await Prisma.pam_photos_files.findFirst({
            where: {
              photo_id: photoId,
              is_trash: 'N'
            },
            orderBy: {
              is_cover: 'desc' // This will put cover images first
            },
            select: {
              file_id: true,
              dir_path: true,
              Image_Name: true,
              Width: true,
              Height: true,
              isMigrat: true,
              migratedFilePath: true,
              migratedFileName: true,
              is_cover: true,
              dominant_color: true,

              photo_title  : true,
              photo_caption  : true,
              photo_copyright: true
            }
          });

          // Calculate orientation from Width and Height
          let calculatedOrientation = null;
          if (firstFile && firstFile.Width && firstFile.Height) {
            calculatedOrientation = getOrientationScientific(firstFile.Width, firstFile.Height);
          }

          // Extract tags
          const photoTags = photo.tags?.map(pt => ({
            tag_id: pt.tag.tag_id,
            name: pt.tag.photo_tag,
            slug: pt.tag.photo_slug
          })) || [];

          // Construct image URL based on migration status
          let imageUrl = null;
          if (firstFile) {
            if (firstFile.isMigrat === 1 && firstFile.migratedFilePath && firstFile.migratedFileName) {
              imageUrl = `${firstFile.migratedFilePath}${firstFile.migratedFileName}`;
            } else if (firstFile.dir_path && firstFile.Image_Name) {
              imageUrl = `${firstFile.dir_path}${firstFile.Image_Name}`;
            }
          }

          // 🔧 SAFELY format photography_time
          let formattedDateTime = null;
          let photographyTimeValue = null;

          if (photo.photography_time) {
            try {
              const dateObj = new Date(photo.photography_time);
              if (!isNaN(dateObj.getTime())) {
                formattedDateTime = dateObj.toLocaleDateString('en-GB');
                photographyTimeValue = photo.photography_time;
              } else {
                console.error('Invalid photography_time for photo:', photo.photo_id, photo.photography_time);
              }
            } catch (err) {
              console.error('Error parsing photography_time for photo:', photo.photo_id, err);
            }
          }

          return {
            photo_id: photo.photo_id,
            photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
            photo_title: photo.photo_title,
            description: photo.description,
            category_id: photo.category_id,
            category_name: photo.category?.name,
            category_slug: photo.category?.slug,
            sub_category_id: photo.sub_category_id,
            sub_category_name: photo.sub_category?.name,
            sub_category_slug: photo.sub_category?.slug,
            price: photo.price,
            photography_time: photographyTimeValue,
            datetime: formattedDateTime,
            author_id: photo.author_id,
            author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
            entered_on: photo.entered_on,
            updated_on: photo.updated_on,
            num_files: fileCount,
            tags: photoTags,
            credit: photo.credit || 0, 
            photos: firstFile ? {
              file_id: firstFile.file_id,
              Image_Name: firstFile.Image_Name,
              isMigrat: firstFile.isMigrat,
              dir_path: firstFile.dir_path,
              migratedFilePath: firstFile.migratedFilePath,
              migratedFileName: firstFile.migratedFileName,
              Width: firstFile.Width,
              Height: firstFile.Height,
              orientation: calculatedOrientation,
              is_cover: firstFile.is_cover,
              dominant_color: firstFile.dominant_color,
              url: imageUrl,

              photo_title: firstFile.photo_title,
              photo_caption: firstFile.photo_caption,
              photo_copyright: firstFile.photo_copyright || `Outlook Images`  
            } : null
          };
        })
      );

      return res.status(200).json(
        serializeBigInt({
          status: 'success',
          results: results,
          pagination: {
            page,
            limit,
            totalRecords,
            filteredCount: results.length,
            totalPages: Math.ceil(totalRecords / limit),
            appliedFilters: {
              search: search || null,
              category: category || null,
              subCategory: subCategory || null,
              tags: tags || null,
              orientation: null,
              dateRange: dateRange || null,
              date_from: date_from || null,
              date_to: date_to || null,
              sortBy,
              sortOrder: sort_order
            }
          }
        })
      );
    }
  } catch (error) {
    console.error('Filter photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to filter photos@@', error)
    );
  }
};

// Filter photos - Now fetches from pam_photos_files table
// Returns file-level data with associated photo information

export const filterPhotos = async (req, res) => {
  console.log("--- I am here in filterPhotos (NEW VERSION) ---");

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    console.log("LIMIT:", limit)
    const {
      search,
      cat: category,
      subcat: subCategory,
      tags,
      orientation,
      location,
      contentType,
      dateRange,
      date_from,
      date_to,
      country_id,
      state_id,
      city_id,
      min_price,
      max_price,
      sort_by = 'file_id',
      sort_order = 'desc'
    } = req.query;

    // Helper function to calculate orientation
    const getOrientationScientific = (width, height, tolerance = 0.05) => {
      if (!width || !height) return null;
      const ratio = width / height;
      if (ratio > 1 + tolerance) return "horizontal";
      if (ratio < 1 - tolerance) return "vertical";
      return "square";
    };

    // Build where clause for pam_photos_files
    const filesWhere = {
      is_trash: 'N'
    };

    // Build where clause for pam_photos (joined table)
    const photosWhere = {
      is_active: 1,
      is_trash: 0
    };

    // --- SEARCH FILTER ---
    if (search) {
      const searchTerm = search.trim();
      
      const photoIdsFromSearch = await Prisma.$queryRaw`
        SELECT DISTINCT pf.photo_id 
        FROM pam_photos_files pf
        LEFT JOIN pam_photos p ON pf.photo_id = p.photo_id
        WHERE 
          p.photo_title LIKE ${`%${searchTerm}%`} OR
          p.description LIKE ${`%${searchTerm}%`} OR
          p.event_name LIKE ${`%${searchTerm}%`} OR
          
          pf.photo_title LIKE ${`%${searchTerm}%`} OR
          pf.photo_caption LIKE ${`%${searchTerm}%`} OR
          pf.photo_copyright LIKE ${`%${searchTerm}%`} OR
          
          
      `;
      // 
      // p.photo_tags LIKE ${`%${searchTerm}%`} OR
      // pf.original_image_name LIKE ${`%${searchTerm}%`} OR
      // pf.Image_Name LIKE ${`%${searchTerm}%`}
      //
      const photoIds = photoIdsFromSearch.map(row => row.photo_id);
      if (photoIds.length > 0) {
        photosWhere.photo_id = { in: photoIds };
      } else {
        photosWhere.photo_id = { in: [] };
      }
    }

    // --- CATEGORY FILTER ---
    if (category) {
      photosWhere.category_id = parseInt(category);
    }

    // --- SUBCATEGORY FILTER ---
    if (subCategory) {
      photosWhere.sub_category_id = parseInt(subCategory);
    }

    // --- LOCATION FILTERS ---
    if (country_id) {
      photosWhere.country_id = parseInt(country_id);
    }
    if (state_id) {
      photosWhere.state_id = parseInt(state_id);
    }
    if (city_id) {
      photosWhere.city_id = parseInt(city_id);
    }

    // --- PRICE FILTERS ---
    if (min_price || max_price) {
      photosWhere.price = {};
      if (min_price) {
        photosWhere.price.gte = parseFloat(min_price);
      }
      if (max_price) {
        photosWhere.price.lte = parseFloat(max_price);
      }
    }

    // --- DATE RANGE FILTER ---
    if (date_from || date_to) {
      photosWhere.photography_time = {};
      if (date_from) {
        const fromDate = new Date(date_from);
        if (!isNaN(fromDate.getTime())) {
          fromDate.setHours(0, 0, 0, 0);
          photosWhere.photography_time.gte = fromDate;
        }
      }
      if (date_to) {
        const toDate = new Date(date_to);
        if (!isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          photosWhere.photography_time.lte = toDate;
        }
      }
    } else if (dateRange && dateRange !== 'anytime') {
      const currentDate = new Date();
      let startDate = new Date();
      switch (dateRange) {
        case '24h': startDate.setHours(currentDate.getHours() - 24); break;
        case '7d': startDate.setDate(currentDate.getDate() - 7); break;
        case '30d': startDate.setDate(currentDate.getDate() - 30); break;
        case '90d': startDate.setDate(currentDate.getDate() - 90); break;
        case '1y': startDate.setFullYear(currentDate.getFullYear() - 1); break;
      }
      photosWhere.photography_time = { gte: startDate };
    }

    // --- TAG FILTER ---
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      if (tagArray.length > 0) {
        photosWhere.AND = tagArray.map(tag => ({
          tags: {
            some: {
              tag: {
                photo_tag: {
                  contains: tag
                }
              }
            }
          }
        }));
      }
    }

    // --- GET TOTAL COUNT (BEFORE ORIENTATION FILTER) ---
    // Get total count of files matching the filters
    const totalRecords = await Prisma.pam_photos_files.count({
      where: {
        ...filesWhere,
        photo: photosWhere
      }
    });

    console.log(`📊 Total records matching filters: ${totalRecords}`);

    // --- DETERMINE SORT ORDER ---
    const orderByClause = {};
    const validSortFields = ['file_id', 'photo_id', 'file_size', 'Width', 'Height', 'entered_on', 'updated_on', 'Image_Name'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'file_id';
    orderByClause[sortField] = sort_order === 'asc' ? 'asc' : 'desc';

    // --- FETCH FILES WITH PHOTO DATA ---
    // If orientation filter is applied, fetch more records
    const fetchLimit = orientation ? limit * 5 : limit;
    const fetchSkip = orientation ? 0 : skip;

    const files = await Prisma.pam_photos_files.findMany({
      where: {
        ...filesWhere,
        photo: photosWhere
      },
      orderBy: orderByClause,
      skip: fetchSkip,
      take: fetchLimit,
      include: {
        photo: {
          include: {
            category: {
              select: { name: true, slug: true }
            }
            // ,
            // sub_category: {
            //   select: { name: true, slug: true }
            // }
            // ,
            // user: {
            //   select: {
            //     id: true,
            //     firstname: true,
            //     lastname: true
            //   }
            // }
            // ,
            // tags: {
            //   include: {
            //     tag: {
            //       select: {
            //         tag_id: true,
            //         photo_tag: true,
            //         photo_slug: true
            //       }
            //     }
            //   }
            // }

          }
        }
      }
    });
    //
    // photo_title      
    // photo_caption
    // photo_copyright
    // 
    console.log(`📡 Fetched ${files.length} files for page ${page}`); 
    console.log(`🔑 File IDs in this batch:`, files.map(f => f.file_id).join(', '));
    console.log(`📋 First 5 file_ids:`, files.slice(0, 5).map(f => ({ file_id: f.file_id, photo_id: f.photo_id, Image_Name: f.Image_Name })));

    // Filter by orientation if needed
    let filteredFiles = files;
    let totalRecordsAfterOrientation = totalRecords;

    if (orientation) {
      const normalizedOrientation = orientation.toLowerCase();
      filteredFiles = files.filter(file => {
        const calcOrientation = getOrientationScientific(file.Width, file.Height);
        return calcOrientation === normalizedOrientation;
      });
      
      // Apply pagination after orientation filter
      const startIndex = Math.min(skip, filteredFiles.length);
      const endIndex = Math.min(skip + limit, filteredFiles.length);
      filteredFiles = filteredFiles.slice(startIndex, endIndex);

      // Estimate total records after orientation filter
      // We can't get exact count without scanning all records, but we can estimate
      // Based on the proportion of files matching orientation in the fetched set
      const orientationRatio = files.length > 0 ? filteredFiles.length / files.length : 0;
      totalRecordsAfterOrientation = Math.floor(totalRecords * orientationRatio);
      
      console.log(`🔄 Orientation filter applied: ${normalizedOrientation}`);
      console.log(`📊 Estimated total after orientation: ${totalRecordsAfterOrientation}`);
    }

    // --- FORMAT RESULTS ---
    const results = await Promise.all(
      filteredFiles.map(async (file) => {
        const photo = file.photo;
        const photoId = Number(photo.photo_id);
        const fileId = Number(file.file_id);

        // Get file count for this photo
        // const fileCount = await Prisma.pam_photos_files.count({
        //   where: {
        //     photo_id: photoId,
        //     is_trash: 'N'
        //   }
        // });

        // Calculate orientation
        const calculatedOrientation = getOrientationScientific(file.Width, file.Height);

        // Extract tags
        // const photoTags = photo.tags?.map(pt => ({
        //   tag_id: pt.tag.tag_id,
        //   name: pt.tag.photo_tag,
        //   slug: pt.tag.photo_slug
        // })) || [];

        // Construct image URL
        let imageUrl = null;
        if (file.isMigrat === 1 && file.migratedFilePath && file.migratedFileName) {
          imageUrl = `${file.migratedFilePath}${file.migratedFileName}`;
        } else if (file.dir_path && file.Image_Name) {
          imageUrl = `${file.dir_path}${file.Image_Name}`;
        }

        // Format photography time
        let formattedDateTime = null;
        let photographyTimeValue = null;
        if (photo.photography_time) {
          try {
            const dateObj = new Date(photo.photography_time);
            if (!isNaN(dateObj.getTime())) {
              formattedDateTime = dateObj.toLocaleDateString('en-GB');
              photographyTimeValue = photo.photography_time;
            }
          } catch (err) {
            console.error('Error parsing photography_time:', err);
          }
        }

        return {
          // File-level data
          file_id: file.file_id,
          file_id_enc: Buffer.from(fileId.toString()).toString('base64'),
          Image_Name: file.Image_Name,
          original_image_name: file.original_image_name,

          file_ext: file.file_ext,
          file_size: file.file_size,
          Width: file.Width,
          Height: file.Height,
          orientation: calculatedOrientation,
          dir_path: file.dir_path,
          
                photo_title_file: file.photo_title,
                photo_caption: file.photo_caption,
                photo_copyright: file.photo_copyright,

          dominant_color: file.dominant_color,
          is_cover: file.is_cover,
          is_migrated: file.isMigrat === 1,
          url: imageUrl,
          downloads: file.downloads,
          
          // Photo-level data (from pam_photos)
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          main_photo_title: photo.photo_title,
          description: photo.description,
          event_name: photo.event_name,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          category_slug: photo.category?.slug,
          sub_category_id: photo.sub_category_id,
          sub_category_name: photo.sub_category?.name,
          sub_category_slug: photo.sub_category?.slug,
          price: photo.price,
          photography_time: photographyTimeValue,
          datetime: formattedDateTime,
          author_id: photo.author_id,
          author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
          entered_on: photo.entered_on,
          updated_on: photo.updated_on,
          //num_files: fileCount,
          //tags: photoTags,
          credit: photo.credit || 0
        };
      })
    );

    // --- RESPONSE ---
    // Calculate total pages based on total records (after orientation filter if applied)
    const finalTotalRecords = orientation ? totalRecordsAfterOrientation : totalRecords;
    const totalPages = Math.ceil(finalTotalRecords / limit) || 1;

    console.log(`📊 Final response: ${results.length} results, ${finalTotalRecords} total records, ${totalPages} total pages`);

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        results: results,
        pagination: {
          page,
          limit,
          totalRecords: finalTotalRecords,
          filteredCount: results.length,
          totalPages: totalPages,
          appliedFilters: {
            search: search || null,
            category: category || null,
            subCategory: subCategory || null,
            tags: tags || null,
            orientation: orientation || null,
            dateRange: dateRange || null,
            date_from: date_from || null,
            date_to: date_to || null,
            sortBy: sort_by,
            sortOrder: sort_order
          }
        }
      })
    );

  } catch (error) {
    console.error('Filter photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to filter photos', error)
    );
  }
};
// Search photos

export const searchPhotos = async (req, res) => {
  console.log("I AM IN SEARCH PHOTO");

  try {
    const { q: query, limit = 20 } = req.query;

    if (!query || query.trim() === '') {
      return res.status(400).json(
        errorResponse('Search query is required')
      );
    }

    const searchTerm = query.trim();

    // Search in photos table
    const photos = await Prisma.pam_photos.findMany({
      where: {
        is_active: 1,
        is_trash: 0,
        OR: [
          { photo_title: { contains: searchTerm } },
          { description: { contains: searchTerm } },
          { event_name: { contains: searchTerm } },
          { photo_tags: { contains: searchTerm } }
        ]
      },
      take: parseInt(limit),
      orderBy: {
        photo_id: 'desc'
      },
      include: {
        category: {
          select: {
            name: true
          }
        },
        author: {
          select: {
            username: true,
            firstname: true,
            lastname: true
          }
        }
      }
    });

    // Process results
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          },
          select: {
            Image_Name: true,
            dir_path: true
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description?.substring(0, 100) + (photo.description?.length > 100 ? '...' : ''),
          category_name: photo.category?.name,
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    return res.status(200).json(
      successResponse('Search completed', {
        query: searchTerm,
        results,
        count: results.length
      })
    );
  } catch (error) {
    console.error('Search photos error:', error);
    return res.status(500).json(
      errorResponse('Search failed', error)
    );
  }
};

// ==================== USER PHOTO CONTROLLERS ====================

/**
 * Get user's own photos
 */
export const getMyPhotos = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [totalRecords, photos] = await Promise.all([
      Prisma.pam_photos.count({
        where: {
          author_id: userId,
          is_trash: 0
        }
      }),
      Prisma.pam_photos.findMany({
        where: {
          author_id: userId,
          is_trash: 0
        },
        orderBy: {
          photo_id: 'desc'
        },
        skip,
        take: limit,
        include: {
          category: {
            select: {
              name: true
            }
          }
        }
      })
    ]);

    // Process each photo
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get file count
        const fileCount = await Prisma.pam_photos_files.count({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        // Get first file
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          },
          select: {
            file_id: true,
            Image_Name: true,
            dir_path: true,
            file_size: true,
            Width: true,
            Height: true,
            isMigrat: true
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          is_active: photo.is_active,
          created_at: photo.created_at,
          updated_at: photo.updated_at,
          file_count: fileCount,
          download: photo.download,
          first_file: firstFile ? {
            file_id: firstFile.file_id,
            filename: firstFile.Image_Name,
            path: firstFile.dir_path,
            size: firstFile.file_size,
            isMigrat: firstFile.isMigrat,
            dimensions: {
              width: firstFile.Width,
              height: firstFile.Height
            },
            url: `${firstFile.dir_path}/${firstFile.Image_Name}`
          } : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: results,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Get my photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch your photos', error)
    );
  }
};

/**
 * Get user upload statistics
 */
export const getUserUploadStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const [
      totalPhotos,
      activePhotos,
      totalFiles,
      totalViews,
      totalDownloads,
      photosByCategory,
      recentUploads
    ] = await Promise.all([
      // Total photos
      Prisma.pam_photos.count({
        where: { author_id: userId, is_trash: 0 }
      }),
      // Active photos
      Prisma.pam_photos.count({
        where: { author_id: userId, is_active: 1, is_trash: 0 }
      }),
      // Total files
      Prisma.pam_photos_files.count({
        where: {
          pam_photos: {
            author_id: userId,
            is_trash: 0
          },
          is_trash: 'N'
        }
      }),
      // Total views
      Prisma.pam_photo_views.count({
        where: {
          pam_photos: {
            author_id: userId
          }
        }
      }),
      // Total downloads
      Prisma.pam_photo_downloads.count({
        where: {
          pam_photos: {
            author_id: userId
          }
        }
      }),
      // Photos by category
      Prisma.pam_photos.groupBy({
        by: ['category_id'],
        where: { author_id: userId, is_trash: 0 },
        _count: { category_id: true },
        orderBy: { _count: { category_id: 'desc' } },
        take: 5
      }),
      // Recent uploads (last 30 days)
      Prisma.pam_photos.count({
        where: {
          author_id: userId,
          is_trash: 0,
          created_at: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        }
      })
    ]);

    // Get category names
    const categoriesWithNames = await Promise.all(
      photosByCategory.map(async (cat) => {
        const category = await Prisma.pam_category.findUnique({
          where: { category_id: cat.category_id },
          select: { name: true }
        });
        return {
          category_id: cat.category_id,
          category_name: category?.name || 'Unknown',
          count: cat._count.category_id
        };
      })
    );

    return res.status(200).json(
      successResponse('User statistics retrieved', {
        overview: {
          total_photos: totalPhotos,
          active_photos: activePhotos,
          total_files: totalFiles,
          total_views: totalViews,
          total_downloads: totalDownloads,
          recent_uploads_30d: recentUploads
        },
        distribution: {
          by_category: categoriesWithNames
        },
        storage: {
          estimated_size: totalFiles * 5, // Assuming average 5MB per file
          photos_per_month: Math.round(recentUploads / 30 * 30) // Projection
        }
      })
    );
  } catch (error) {
    console.error('Get user upload stats error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch user statistics', error)
    );
  }
};

/**
 * Create new photo
 */

export const createPhoto = async (req, res) => {
  console.log("=== old: api/admin-photos/upload-full  === New : api/photos/create ===");

  try {
    // Handle files from multer
    const files = [];

    // Check for single file upload
    if (req.file) {
      files.push(req.file);
      // console.log('Added file from req.file:', req.file.originalname);
    }

    if (req.files) {
      // console.log('req.files type:', typeof req.files);

      if (Array.isArray(req.files)) {
        // If it's an array, add all files
        // console.log('req.files is array, length:', req.files.length);
        req.files.forEach((file, index) => {
          // console.log(`File ${index} from req.files array:`, file.originalname);
          // Check if this file is already in the array (to avoid duplicates)
          if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
            files.push(file);
          }
        });
      } else if (typeof req.files === 'object') {
        // If it's an object (field-based), iterate through values
        // console.log('req.files is object, keys:', Object.keys(req.files));
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            fileArray.forEach(file => {
              // console.log('File from req.files object (array):', file.originalname);
              if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
                files.push(file);
              }
            });
          } else {
            // console.log('File from req.files object (single):', fileArray.originalname);
            if (!files.some(f => f.fieldname === fileArray.fieldname && f.originalname === fileArray.originalname)) {
              files.push(fileArray);
            }
          }
        });
      }
    }

    // console.log('Total unique files to process:', files.length);

    // DEBUG: Log all files
    console.log('=== DEBUG: All files ===');
    files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      });
    });
    // console.log('========================');
    // Parse body data
    const bodyData = req.body || {};

    // Extract user ID
    let userId;
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.admin?.admin_id;
      console.log('Extracted userId:', userId);
    }

    userId = parseInt(userId);
    // console.log('Parsed userId:', userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        error: 'User ID is required and must be a valid number',
        debug: { user: req.user }
      });
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

    // console.log('Extracted photo_title:', photo_title);
    // console.log('Extracted category_id:', category_id);

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
          sub_category_id: sub_category_id && sub_category_id !== '0' ? parseInt(sub_category_id) : 0,
          country_id: country_id && country_id !== '0' ? parseInt(country_id) : 0,
          state_id: state_id && state_id !== '0' ? parseInt(state_id) : 0,
          city_id: city_id && city_id !== '0' ? parseInt(city_id) : 0,
          author_id: userId,

          media_type: 'photo',
          source_name: source_name ? String(source_name) : '',
          credit: photo_credit_id ? parseInt(photo_credit_id) : 0,
          other_credit: credit ? String(credit) : 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time ? new Date(photography_time) : new Date(),
          enter_by: userId,
          updated_by: userId,
          is_active: 1,
          is_trash: 0,
          entered_on: new Date(),
          updated_on: new Date()
        }
      });

      const photoId = Number(photo.photo_id);
      // console.log('Created photo ID:', photoId);

      // 2. Process each uploaded file - CREATE ONE RECORD PER FILE
      const fileRecords = [];

      for (const file of files) {
        // console.log(`Processing file: ${file.originalname}`);

        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = path.extname(file.originalname);
        const fileName = `${timestamp}_${randomString}${fileExtension}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Read file buffer
        const fileBuffer = file.buffer;

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(fileBuffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(fileBuffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        // Extract dominant color
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(fileBuffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const orientation = getOrientationScientific(width, height);

        // Generate S3 keys
        const mainFileKey = `uploads/testing/${year}/${month}/${date}/${fileName}`;
        const thumbnailKey = `uploads/testing/400/${year}/${month}/${date}/${fileName}`;

        // console.log('Main S3 Key:', mainFileKey);
        // console.log('Thumbnail S3 Key:', thumbnailKey);

        try {
          // Upload main image to S3
          const mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
          console.log(`Main image uploaded to S3: ${mainFileUrl}`);

          // Create and upload thumbnail
          const thumbnailBuffer = await sharp(fileBuffer)
            .resize({
              width: 400,
              height: 400,
              fit: 'inside',
              withoutEnlargement: true
            })
            .toBuffer();

          const thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
          console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

          // Create ONE database record for this file (includes both main and thumbnail info)
          const fileRecord = await tx.pam_photos_files.create({
            data: {
              photo_id: photoId,
              file_ext: ext,
              type: ext,
              dir_path: `testing/${year}/${month}/${date}`,
              file_size: String(file.size),
              reference: '',
              source: 'Outlook Images',
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
              raw_name: baseFileName,
              Image_Name: fileName,
              original_image_name: originalName,
              isMigrat: 0,
              // s3_key: mainFileKey, // Main image S3 key
              // s3_thumbnail_key: thumbnailKey, // Thumbnail S3 key
              // metadata: exifData ? JSON.stringify(exifData) : null,
              dominant_color: dominantColor
              // s3_url: mainFileUrl, // Main image URL
              // s3_thumbnail_url: thumbnailUrl // Thumbnail URL
            }
          });

          fileRecords.push(fileRecord);

        } catch (uploadError) {
          console.error(`Error uploading file ${file.originalname}:`, uploadError);
          throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
        }
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
        message: `Created new photo: "${photo_title}" with ${files.length} images`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        created_at: new Date(),
        activity_code: 'Create Photo A001'
      }
    });

    return res.status(201).json(convertBigIntToString(
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
            original_name: f.original_image_name,
            s3_url: f.s3_url,
            s3_thumbnail_url: f.s3_thumbnail_url,
            s3_key: f.s3_key,
            s3_thumbnail_key: f.s3_thumbnail_key,
            width: f.Width,
            height: f.Height,
            orientation: f.orientation,
            dominant_color: f.dominant_color
          }))
        },
        tags: result.tagsInserted,
        storage: {
          type: 'aws_s3',
          bucket: process.env.AWS_S3_BUCKET_NAME || 'oli-photoassets',
          region: process.env.AWS_REGION || 'us-east-1',
          main_directory: `uploads/testing/${year}/${month}/${date}`,
          thumbnail_directory: `uploads/testing/400/${year}/${month}/${date}`
        }
      })
    ));

  } catch (error) {
    console.error('Create photo error details:', error);
    console.error('Error stack:', error.stack);

    // Note: Since S3 upload is now inside transaction, we don't need separate cleanup
    // The transaction will rollback on error

    return res.status(500).json(
      errorResponse('Failed to create photo', error.message)
    );
  }
};


export const editPhotoAnySide = async (req, res) => {
  console.log("I AM IN editPhotoAnySide");

  console.log("=== Editing Photo (Admin/User) ===");
  console.log("Request body keys:", Object.keys(req.body));
  console.log("Files count:", req.files?.length || 0);
  //const { id } = req.params;
  console.log("#########################################################################");

  // DEBUG: Log what multer received
  // console.log('req.files:', req.files);
  // console.log('req.file:', req.file);
  // console.log('req.body:', req.body);
  // console.log('Content-Type:', req.headers['content-type']);
  // return;

  try {
    // Handle files from multer
    const files = [];

    // Check for single file upload
    if (req.file) {
      files.push(req.file);
    }

    // Check for multiple files upload
    if (req.files) {
      if (Array.isArray(req.files)) {
        req.files.forEach((file) => {
          if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
            files.push(file);
          }
        });
      } else if (typeof req.files === 'object') {
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            fileArray.forEach(file => {
              if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
                files.push(file);
              }
            });
          } else {
            if (!files.some(f => f.fieldname === fileArray.fieldname && f.originalname === fileArray.originalname)) {
              files.push(fileArray);
            }
          }
        });
      }
    }

    console.log('Total files to process:', files.length);

    // Parse body data
    const bodyData = req.body || {};

    // Extract user ID
    let userId;
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.admin?.admin_id;
      console.log('Extracted userId:', userId);
    }

    userId = parseInt(userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        error: 'User ID is required and must be a valid number',
        debug: { user: req.user }
      });
    }

    // Extract data from body
    const {
      photo_id,
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
      other_credit,
      tag_ids = [],
      photo_tags,
      max_download,
      download,
      media_type,
      is_active,
      existing_files = [], // Array of file IDs to keep (for deletion tracking)
      cover_image_id // New cover image file ID
    } = bodyData;

    console.log('Editing photo ID:', photo_id);
    console.log('Photo title:', photo_title);

    // Validate required fields
    if (!photo_id || !photo_title || !category_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo ID, title, and category are required'
      });
    }

    const photoId = parseInt(photo_id);

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: photoId,
        is_trash: 0
      },
      include: {
        pam_photos_files: {
          where: { is_trash: 'N' }
        }
      }
    });

    if (!existingPhoto) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found or has been deleted'
      });
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');

    // Parse existing files to keep (those not deleted)
    let filesToKeep = [];
    if (existing_files) {
      if (typeof existing_files === 'string') {
        filesToKeep = existing_files.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      } else if (Array.isArray(existing_files)) {
        filesToKeep = existing_files.map(id => parseInt(id)).filter(id => !isNaN(id));
      }
    }

    // If no filesToKeep specified, keep all existing files
    if (filesToKeep.length === 0) {
      filesToKeep = existingPhoto.pam_photos_files.map(f => f.file_id);
    }

    // Use transaction to ensure data consistency
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Update photo record
      const updatedPhoto = await tx.pam_photos.update({
        where: { photo_id: photoId },
        data: {
          photo_title: String(photo_title),
          event_name: event_name ? String(event_name) : existingPhoto.event_name || '',
          description: description ? String(description) : existingPhoto.description || '',
          photo_tags: photo_tags ? String(photo_tags) : existingPhoto.photo_tags || '',

          category_id: parseInt(category_id),
          sub_category_id: sub_category_id && sub_category_id !== '0' ? parseInt(sub_category_id) : 0,
          country_id: country_id && country_id !== '0' ? parseInt(country_id) : 0,
          state_id: state_id && state_id !== '0' ? parseInt(state_id) : 0,
          city_id: city_id && city_id !== '0' ? parseInt(city_id) : 0,

          source_name: source_name ? String(source_name) : existingPhoto.source_name || '',
          credit: photo_credit_id ? parseInt(photo_credit_id) : existingPhoto.credit || 0,
          other_credit: other_credit ? String(other_credit) : existingPhoto.other_credit || 'nk',
          price: price ? parseFloat(price) : existingPhoto.price || 0,
          photography_time: photography_time ? new Date(photography_time) : existingPhoto.photography_time,
          max_download: max_download ? parseInt(max_download) : existingPhoto.max_download || 0,
          download: download ? parseInt(download) : existingPhoto.download || 0,
          media_type: media_type ? String(media_type) : existingPhoto.media_type || 'photo',

          is_active: is_active !== undefined ? parseInt(is_active) : existingPhoto.is_active,
          updated_by: userId,
          updated_on: new Date()
        }
      });

      console.log('Updated photo ID:', updatedPhoto.photo_id);

      // 2. Mark files for deletion (those not in filesToKeep)
      const filesToDelete = existingPhoto.pam_photos_files
        .filter(f => !filesToKeep.includes(f.file_id))
        .map(f => f.file_id);

      if (filesToDelete.length > 0) {
        console.log('Marking files for deletion:', filesToDelete);

        // Soft delete files
        await tx.pam_photos_files.updateMany({
          where: {
            file_id: { in: filesToDelete }
          },
          data: {
            is_trash: 'Y',
            trashed_by: String(userId),
            trashed_on: new Date()
          }
        });

        // Note: You might want to also delete from S3, but that's optional
        // You could do that in a separate cleanup job
      }

      // 3. Process new uploaded files (if any)
      const newFileRecords = [];

      for (const file of files) {
        console.log(`Processing new file: ${file.originalname}`);

        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = path.extname(file.originalname);
        const fileName = `${timestamp}_${randomString}${fileExtension}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Read file buffer
        const fileBuffer = file.buffer;

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(fileBuffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(fileBuffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        // Extract dominant color
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(fileBuffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const orientation = getOrientationScientific(width, height);

        // Generate S3 keys
        const mainFileKey = `uploads/testing/${year}/${month}/${day}/${fileName}`;
        const thumbnailKey = `uploads/testing/400/${year}/${month}/${day}/${fileName}`;

        try {
          // Upload main image to S3
          const mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
          console.log(`Main image uploaded to S3: ${mainFileUrl}`);

          // Create and upload thumbnail
          const thumbnailBuffer = await sharp(fileBuffer)
            .resize({
              width: 400,
              height: 400,
              fit: 'inside',
              withoutEnlargement: true
            })
            .toBuffer();

          const thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
          console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

          // Create database record for new file
          const fileRecord = await tx.pam_photos_files.create({
            data: {
              photo_id: photoId,
              file_ext: ext,
              type: ext,
              dir_path: `testing/${year}/${month}/${day}`,
              file_size: String(file.size),
              reference: '',
              source: 'Outlook Images',
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
              raw_name: baseFileName,
              Image_Name: fileName,
              original_image_name: originalName,
              isMigrat: 0,
              dominant_color: dominantColor
            }
          });

          newFileRecords.push(fileRecord);

        } catch (uploadError) {
          console.error(`Error uploading file ${file.originalname}:`, uploadError);
          throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
        }
      }

      // 4. Set cover image if specified
      if (cover_image_id) {
        const coverFileId = parseInt(cover_image_id);

        // Check if the cover file exists (either existing or new)
        const coverExists = [...existingPhoto.pam_photos_files, ...newFileRecords]
          .some(f => f.file_id === coverFileId);

        if (coverExists) {
          // You might have a separate table or field for cover image
          // For now, we'll just update a custom field or you can handle it separately
          console.log('Setting cover image to:', coverFileId);

          // If you have a cover_image_id field in pam_photos, update it
          // await tx.pam_photos.update({
          //   where: { photo_id: photoId },
          //   data: { cover_image_id: coverFileId }
          // });
        }
      }

      // 5. Process tags
      let tagsInserted = 0;
      let tagsRemoved = 0;

      if (tag_ids.length > 0 || photo_tags) {
        // First, remove existing tags (optional - depends on your logic)
        await tx.pam_photo_tags.deleteMany({
          where: { photo_id: photoId }
        });

        const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : (tag_ids ? tag_ids.split(',') : []);

        // Process photo_tags string
        if (photo_tags) {
          const tagsFromString = photo_tags.split(',').map(tag => tag.trim());
          for (const tagName of tagsFromString) {
            if (!tagName) continue;

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

            if (tag) {
              tagIdsArray.push(tag.tag_id.toString());
            }
          }
        }

        // Remove duplicates and empty values
        const uniqueTagIds = [...new Set(tagIdsArray.filter(id => id && id.toString().trim()))];

        if (uniqueTagIds.length > 0) {
          // Create new tag associations
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

      // Get updated files list
      const updatedFiles = await tx.pam_photos_files.findMany({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        }
      });

      return {
        photo: updatedPhoto,
        existingFilesKept: filesToKeep.length,
        filesDeleted: filesToDelete.length,
        newFiles: newFileRecords.length,
        newFileRecords,
        updatedFiles,
        tagsInserted
      };
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username || 'Unknown',
        user_type: 'user',
        activity_type: 'update',
        module: 'photos',
        action: 'photo_edit',
        message: `Updated photo: "${photo_title}" (ID: ${photoId}) - Added ${result.newFiles} new images, Kept ${result.existingFilesKept} existing images, Deleted ${result.filesDeleted} images`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        resource_id: photoId.toString(),
        created_at: new Date(),
        activity_code: 'Edit Photo A002'
      }
    });

    // Prepare response
    const response = {
      status: 'success',
      message: 'Photo updated successfully',
      data: {
        photo: {
          id: result.photo.photo_id,
          title: result.photo.photo_title,
          is_active: result.photo.is_active === 1
        },
        files: {
          total: result.updatedFiles.length,
          existing_kept: result.existingFilesKept,
          deleted: result.filesDeleted,
          new_added: result.newFiles,
          items: result.updatedFiles.map(f => ({
            id: f.file_id,
            name: f.Image_Name,
            original_name: f.original_image_name,
            width: f.Width,
            height: f.Height,
            orientation: f.orientation,
            url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/${f.dir_path}/${f.Image_Name}`,
            thumbnail_url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/400/${f.dir_path}/${f.Image_Name}`,
            is_new: result.newFileRecords.some(nf => nf.file_id === f.file_id)
          }))
        },
        tags: result.tagsInserted,
        storage: {
          type: 'aws_s3',
          bucket: process.env.AWS_S3_BUCKET_NAME || 'oli-photoassets',
          region: process.env.AWS_REGION || 'us-east-1'
        }
      }
    };

    return res.status(200).json(convertBigIntToString(response));

  } catch (error) {
    console.error('Edit photo error details:', error);
    console.error('Error stack:', error.stack);

    return res.status(500).json({
      status: 'error',
      message: 'Failed to update photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



/** 
 * SAME AS ADMIN 
 * Create photo for regular users (no admin verification)
 */
export const createUserPhoto = async (req, res) => {
  console.log("=== createUserPhoto: User Photo Upload ===");

  try {
    // Handle files from multer
    const files = [];

    // Check for single file upload
    if (req.file) {
      files.push(req.file);
    }

    if (req.files) {
      if (Array.isArray(req.files)) {
        req.files.forEach((file) => {
          if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
            files.push(file);
          }
        });
      } else if (typeof req.files === 'object') {
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            fileArray.forEach(file => {
              if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
                files.push(file);
              }
            });
          } else {
            if (!files.some(f => f.fieldname === fileArray.fieldname && f.originalname === fileArray.originalname)) {
              files.push(fileArray);
            }
          }
        });
      }
    }

    console.log('=== User Upload Files ===');
    files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      });
    });

    // Parse body data
    const bodyData = req.body || {};

    // Extract user ID from token
    let userId;
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id;
      console.log('Extracted userId:', userId);
    }

    userId = parseInt(userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required and must be a valid number',
        debug: { user: req.user }
      });
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
      photo_tags,
      status = '1'
    } = bodyData;

    // Validate required fields
    // if (!photo_title || !category_id) {
    //   return res.status(400).json({
    //     status: 'error',
    //     message: 'Photo title and category are required'
    //   });
    // }

    if (!photo_title) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title is required'
      });
    }

    // Validate files
    if (files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one image file is required'
      });
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentDate.getDate()).padStart(2, '0');

    // ✅ Step 1: Process files and upload to S3 FIRST (outside transaction)
    const processedFiles = [];
    
    for (const file of files) {
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const fileExtension = path.extname(file.originalname);
      const fileName = `${timestamp}_${randomString}${fileExtension}`;
      const originalName = file.originalname;
      const ext = path.extname(originalName).replace('.', '');
      const baseFileName = path.parse(originalName).name;

      // Read file buffer
      const fileBuffer = file.buffer;

      // Get image metadata
      let metadata = {};
      try {
        metadata = await getImageMetadata(fileBuffer);
        console.log('Image metadata:', metadata);
      } catch (metaError) {
        console.warn('Could not extract image metadata:', metaError.message);
      }

      // Extract EXIF data
      let exifData = {};
      try {
        exifData = await extractExifFromBuffer(fileBuffer);
        console.log('EXIF data:', exifData);
      } catch (exifError) {
        console.warn('Could not extract EXIF data:', exifError.message);
      }
      //console.log("EXIF_DATA: ", JSON.stringify(exifData.Keywords)); return false;

      const photoCaption = exifData?.Caption ? String(exifData.Caption) : '';
      const photoTitleFromExif = exifData?.title?.value ? String(exifData.title.value) : '';
      const photoCopyright = exifData?.CopyrightNotice ? String(exifData.CopyrightNotice) : '';

      // Extract dominant color
      let dominantColor = null;
      try {
        dominantColor = await extractDominantColor(fileBuffer);
        console.log('Dominant color:', dominantColor);
      } catch (colorError) {
        console.warn('Could not extract dominant color:', colorError.message);
      }

      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const orientation = getOrientationScientific(width, height);

      // Generate S3 keys
      const mainFileKey = `uploads/testing/${year}/${month}/${date}/${fileName}`;
      const thumbnailKey = `uploads/testing/400/${year}/${month}/${date}/${fileName}`;

      // ✅ Upload to S3 (this can take time, do it outside transaction)
      let mainFileUrl, thumbnailUrl;
      try {
        // Upload main image to S3
        mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
        console.log(`Main image uploaded to S3: ${mainFileUrl}`);

        // Create and upload thumbnail
        const thumbnailBuffer = await sharp(fileBuffer)
          .resize({
            width: 400,
            height: 400,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
        console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

      } catch (uploadError) {
        console.error(`Error uploading file ${file.originalname}:`, uploadError);
        throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
      }

      // Store processed file data for database insertion
      processedFiles.push({
        fileName,
        originalName,
        ext,
        baseFileName,
        fileSize: file.size,
        width,
        height,
        orientation,
        dominantColor,
        photoCaption,
        photoTitleFromExif,
        photoCopyright,
        dirPath: `testing/${year}/${month}/${date}`,
        mainFileUrl,
        thumbnailUrl
      });
    }

    // ✅ Step 2: Create database records in a transaction (fast operations only)
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Create photo record
      const photo = await tx.pam_photos.create({
        data: {
          photo_title: String(photo_title),
          event_name: event_name ? String(event_name) : '',
          description: description ? String(description) : '',
          photo_tags: photo_tags ? String(photo_tags) : '',
          category_id:  category_id && category_id !== '0' ? parseInt(category_id) : 0, // parseInt(category_id),
          sub_category_id: sub_category_id && sub_category_id !== '0' ? parseInt(sub_category_id) : 0,
          country_id: country_id && country_id !== '0' ? parseInt(country_id) : 0,
          state_id: state_id && state_id !== '0' ? parseInt(state_id) : 0,
          city_id: city_id && city_id !== '0' ? parseInt(city_id) : 0,
          author_id: userId,
          media_type: 'photo',
          source_name: source_name ? String(source_name) : '',
          credit: photo_credit_id ? parseInt(photo_credit_id) : 0,
          other_credit: credit ? String(credit) : 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time ? new Date(photography_time) : new Date(),
          enter_by: userId,
          updated_by: userId,
          is_active: parseInt(status),
          is_trash: 0,
          entered_on: new Date(),
          updated_on: new Date()
        }
      });

      const photoId = Number(photo.photo_id);

      // 2. Create file records (using processed data from S3 uploads)
      const fileRecords = [];
      
      for (const fileData of processedFiles) {
        const fileRecord = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: fileData.ext,
            type: fileData.ext,
            
            photo_title: fileData.photoTitleFromExif,
            photo_caption: fileData.photoCaption,
            photo_copyright: fileData.photoCopyright,

            dir_path: fileData.dirPath,
            file_size: String(fileData.fileSize),
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
            Width: fileData.width,
            Height: fileData.height,
            orientation: fileData.orientation,
            raw_name: fileData.baseFileName,
            Image_Name: fileData.fileName,
            original_image_name: fileData.originalName,
            isMigrat: 0,
            dominant_color: fileData.dominantColor
          }
        });

        fileRecords.push(fileRecord);
      }

      // 3. Process tags
      let tagsInserted = 0;
      if (tag_ids.length > 0 || photo_tags) {
        const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : (tag_ids ? tag_ids.split(',') : []);

        // Process photo_tags string
        if (photo_tags) {
          const tagsFromString = photo_tags.split(',').map(tag => tag.trim());
          for (const tagName of tagsFromString) {
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

        const uniqueTagIds = [...new Set(tagIdsArray.filter(id => id && id.toString().trim()))];

        if (uniqueTagIds.length > 0) {
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
    }, {
      timeout: 30000 // Increase transaction timeout to 30 seconds
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username || req.user.email || 'User',
        user_type: 'user',
        activity_type: 'create',
        module: 'photos',
        action: 'user_photo_upload',
        message: `User uploaded new photo: "${photo_title}" with ${files.length} images`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        created_at: new Date(),
        activity_code: 'USER_UPLOAD_001'
      }
    });

    return res.status(201).json(convertBigIntToString({
      status: 'success',
      message: 'Photo uploaded successfully',
      data: {
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
            original_name: f.original_image_name,
            width: f.Width,
            height: f.Height,
            orientation: f.orientation,
            dominant_color: f.dominant_color
          }))
        },
        tags: result.tagsInserted
      }
    }));

  } catch (error) {
    console.error('User photo upload error details:', error);
    console.error('Error stack:', error.stack);

    return res.status(500).json({
      status: 'error',
      message: 'Failed to upload photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


export const createUserPhoto22222 = async (req, res) => {
  console.log("=== createUserPhoto:  User Photo Upload ===");

  try {
    // Handle files from multer (same as admin version)
    const files = [];

    // Check for single file upload
    if (req.file) {
      files.push(req.file);
    }

    if (req.files) {
      if (Array.isArray(req.files)) {
        req.files.forEach((file) => {
          if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
            files.push(file);
          }
        });
      } else if (typeof req.files === 'object') {
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            fileArray.forEach(file => {
              if (!files.some(f => f.fieldname === file.fieldname && f.originalname === file.originalname)) {
                files.push(file);
              }
            });
          } else {
            if (!files.some(f => f.fieldname === fileArray.fieldname && f.originalname === fileArray.originalname)) {
              files.push(fileArray);
            }
          }
        });
      }
    }

    console.log('=== User Upload Files ===');
    files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      });
    });

    // Parse body data
    const bodyData = req.body || {};

    // Extract user ID from token (authenticateToken already verified)
    let userId;
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id;
      console.log('Extracted userId:', userId);
    }

    userId = parseInt(userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required and must be a valid number',
        debug: { user: req.user }
      });
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
      photo_tags,
      status = '1' // Default to active
    } = bodyData;

    // Validate required fields
    // if (!photo_title || !category_id) {
    //   return res.status(400).json({
    //     status: 'error',
    //     message: 'Photo title and category are required'
    //   });
    // }

    if (!photo_title) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title is required'
      });
    }

    // Validate files
    if (files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one image file is required'
      });
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentDate.getDate()).padStart(2, '0');

    // Use transaction to ensure data consistency
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Create photo record (with user as author)
      const photo = await tx.pam_photos.create({
        data: {
          photo_title: String(photo_title),
          event_name: event_name ? String(event_name) : '',
          description: description ? String(description) : '',
          photo_tags: photo_tags ? String(photo_tags) : '',

          //category_id: parseInt(category_id),

          category_id: category_id && category_id !== '0' ? parseInt(category_id) : 0,
          sub_category_id: sub_category_id && sub_category_id !== '0' ? parseInt(sub_category_id) : 0,
          country_id: country_id && country_id !== '0' ? parseInt(country_id) : 0,
          state_id: state_id && state_id !== '0' ? parseInt(state_id) : 0,
          city_id: city_id && city_id !== '0' ? parseInt(city_id) : 0,
          author_id: userId,

          media_type: 'photo',
          source_name: source_name ? String(source_name) : '',
          credit: photo_credit_id ? parseInt(photo_credit_id) : 0,
          other_credit: credit ? String(credit) : 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time ? new Date(photography_time) : new Date(),
          enter_by: userId,
          updated_by: userId,
          is_active: parseInt(status), // Use user-provided status or default 1
          is_trash: 0,
          entered_on: new Date(),
          updated_on: new Date()
        }
      });

      const photoId = Number(photo.photo_id);

      // 2. Process each uploaded file
      const fileRecords = [];

      for (const file of files) {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = path.extname(file.originalname);
        const fileName = `${timestamp}_${randomString}${fileExtension}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Read file buffer
        const fileBuffer = file.buffer;

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(fileBuffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(fileBuffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        const photoCaption = exifData?.Caption ? String(exifData.Caption) : '';
        const photoTitle = exifData?.title?.value ? String(exifData.title.value) : '';
        const photoCopyright = exifData?.CopyrightNotice ? String(exifData.CopyrightNotice) : '';

        // Extract dominant color
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(fileBuffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const orientation = getOrientationScientific(width, height);

        // Generate S3 keys (use user-uploads folder instead of testing)
        //const mainFileKey = `uploads/${year}/${month}/${date}/${fileName}`;
        //const thumbnailKey = `uploads/400/${year}/${month}/${date}/${fileName}`;

        const mainFileKey = `uploads/testing/${year}/${month}/${date}/${fileName}`;
        const thumbnailKey = `uploads/testing/400/${year}/${month}/${date}/${fileName}`;

        try {
          // Upload main image to S3
          const mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
          console.log(`Main image uploaded to S3: ${mainFileUrl}`);

          // Create and upload thumbnail
          const thumbnailBuffer = await sharp(fileBuffer)
            .resize({
              width: 400,
              height: 400,
              fit: 'inside',
              withoutEnlargement: true
            })
            .toBuffer();

          const thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
          console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);



          // Create database record for this file
          const fileRecord = await tx.pam_photos_files.create({
            data: {
              photo_id: photoId,
              file_ext: ext,
              type: ext,

              photo_title: photoTitle,
              photo_caption: photoCaption,  
              photo_copyright: photoCopyright,

              dir_path: `testing/${year}/${month}/${date}`,
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
              Width: width,
              Height: height,
              orientation: orientation,
              raw_name: baseFileName,
              Image_Name: fileName,
              original_image_name: originalName,
              isMigrat: 0,
              dominant_color: dominantColor
            }
          });

          fileRecords.push(fileRecord);

        } catch (uploadError) {
          console.error(`Error uploading file ${file.originalname}:`, uploadError);
          throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
        }
      }

      // 3. Process tags
      let tagsInserted = 0;
      if (tag_ids.length > 0 || photo_tags) {
        const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : (tag_ids ? tag_ids.split(',') : []);

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

    // Log activity (user activity, not admin)
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username || req.user.email || 'User',
        user_type: 'user',
        activity_type: 'create',
        module: 'photos',
        action: 'user_photo_upload',
        message: `User uploaded new photo: "${photo_title}" with ${files.length} images`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title,
        created_at: new Date(),
        activity_code: 'USER_UPLOAD_001'
      }
    });

    return res.status(201).json(convertBigIntToString({
      status: 'success',
      message: 'Photo uploaded successfully',
      data: {
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
            original_name: f.original_image_name,
            width: f.Width,
            height: f.Height,
            orientation: f.orientation,
            dominant_color: f.dominant_color
          }))
        },
        tags: result.tagsInserted
      }
    }));

  } catch (error) {
    console.error('User photo upload error details:', error);
    console.error('Error stack:', error.stack);

    return res.status(500).json({
      status: 'error',
      message: 'Failed to upload photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update photo
 */
export const updatePhoto = async (req, res) => {

  console.log("~~~~~~~~~~~~ I am in updatePhoto ~~~~~~~~~~~~");
  console.log(JSON.stringify(req.body, null, 2))
  console.log("~~~~~~~~~~~~~~~~~~ a ~~~~~~~~~~~~~~~~~~")
  // return;

  try {
    const { id } = req.params;
    const photoId = parseInt(id);
    const userId = req.body?.updated_by || req.admin?.admin_id;

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

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
      is_active,
      max_download,
      tag_ids, // Add this - array of tag IDs from frontend
      author_name, // You might want to handle this separately
      author,
      other_credit,
      status
    } = req.body;

    // Build update data
    const updateData = {
      updated_on: new Date(),
      updated_by: userId
    };

    if (photo_title !== undefined) updateData.photo_title = photo_title;
    if (description !== undefined) updateData.description = description;
    if (category_id !== undefined) updateData.category_id = parseInt(category_id);
    if (sub_category_id !== undefined) updateData.sub_category_id = parseInt(sub_category_id);
    if (country_id !== undefined) updateData.country_id = parseInt(country_id);
    if (state_id !== undefined) updateData.state_id = parseInt(state_id);
    if (city_id !== undefined) updateData.city_id = parseInt(city_id);
    if (source_name !== undefined) updateData.source_name = source_name;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (photography_time !== undefined) updateData.photography_time = new Date(photography_time);
    if (event_name !== undefined) updateData.event_name = event_name;
    if (photo_credit_id !== undefined) updateData.credit = parseInt(photo_credit_id);
    if (status !== undefined) updateData.is_active = parseInt(status);
    if (max_download !== undefined) updateData.max_download = parseInt(max_download);
    if (other_credit !== undefined) updateData.other_credit = other_credit;
    // console.log(JSON.stringify(updateData, null, 2));
    // return;

    // Use transaction to ensure data consistency
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Update photo
      const updatedPhoto = await tx.pam_photos.update({
        where: { photo_id: BigInt(photoId) },
        data: updateData,
        include: {
          category: {
            select: { name: true }
          }
        }
      });

      // 2. Handle tags if tag_ids is provided
      let tagsUpdated = 0;
      if (tag_ids && Array.isArray(tag_ids)) {
        // Remove all existing tags for this photo
        await tx.pam_photo_tags.deleteMany({
          where: { photo_id: photoId }
        });

        // Add new tags if there are any
        if (tag_ids.length > 0) {
          // Filter out invalid tag IDs
          const validTagIds = tag_ids
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);

          if (validTagIds.length > 0) {
            // Create new tag associations
            const tagPromises = validTagIds.map(tagId =>
              tx.pam_photo_tags.create({
                data: {
                  photo_id: photoId,
                  tag_id: tagId
                }
              })
            );

            const createdTags = await Promise.all(tagPromises);
            tagsUpdated = createdTags.length;
          }
        }
      }

      return { updatedPhoto, tagsUpdated };
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user?.username || 'Admin',
        user_type: req.user?.role === 'admin' ? 'admin' : 'user',
        activity_type: 'update',
        module: 'photos',
        action: 'photo_update',
        message: `Updated photo: "${photo_title || existingPhoto.photo_title}" with ${result.tagsUpdated} tags`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title || existingPhoto.photo_title,
        created_at: new Date(),
        activity_code: "UPDPHO1001",
      }
    });

    return res.status(200).json(convertBigIntToString(
      successResponse('Photo updated successfully', {
        photo: {
          id: result.updatedPhoto.photo_id,
          title: result.updatedPhoto.photo_title,
          category: result.updatedPhoto.category?.name,
          updated_at: result.updatedPhoto.updated_at,
          tags_updated: result.tagsUpdated
        }
      })
    ));

  } catch (error) {
    console.error('Update photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to update photo', error)
    );
  }
};

// Delete photo (soft delete)

export const deletePhoto = async (req, res) => {
  console.log("I am in deletePhoto !!!");
  try {
    const { id } = req.params;
    // console.log(req.body); return;
    // const userId = req.user.id;
    const userId = req.body?.updated_by || req.admin?.admin_id ;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists and user owns it
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to delete this photo')
      );
    }

    // Soft delete (move to trash)
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        is_trash: 1,
        trashed_by: userId,
        trashed_at: new Date(),
        updated_at: new Date()
      }
    });

    // Also mark all files as trashed
    await Prisma.pam_photos_files.updateMany({
      where: { photo_id: photoId },
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
        module: 'photos',
        action: 'photo_delete',
        message: `Moved photo to trash: "${existingPhoto.photo_title}"`,
        status: 'success',
        severity: 'warning',
        ip_address: req.ip,
        resource_name: existingPhoto.photo_title,
        created_at: new Date()
      }
    });

    return res.status(200).json(
      successResponse('Photo moved to trash successfully')
    );
  } catch (error) {
    console.error('Delete photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to delete photo', error)
    );
  }
};

export const trashPhotoAlbum = async (req, res) => {
  console.log("I am in trashPhotoAlbum !!!");
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.body?.updated_by || req.admin?.admin_id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check if user owns this photo or is admin
    const isOwner = existingPhoto.author_id === userId;
    const isAdmin = req.user?.role === 'admin' || req.admin?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('You do not have permission to delete this photo')
      );
    }

    // Check if already trashed
    if (existingPhoto.is_trash === 1) {
      return res.status(400).json(
        errorResponse('Photo is already in trash')
      );
    }

    // Soft delete (move to trash) - Only use fields that exist in the model
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        is_trash: 1,
        updated_on: new Date(),
        updated_by: userId
      }
    });

    // Also mark all files as trashed
    await Prisma.pam_photos_files.updateMany({
      where: { photo_id: photoId },
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
        user_name: req.user?.username || req.user?.email || 'User',
        user_type: req.user?.role === 'admin' ? 'admin' : 'user',
        activity_type: 'delete',
        module: 'photos',
        action: 'photo_delete',
        message: `Moved photo to trash: "${existingPhoto.photo_title}" (ID: ${photoId})`,
        status: 'success',
        severity: 'warning',
        ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        resource_name: existingPhoto.photo_title,
        resource_id:  photoId,
        created_at: new Date(),
        activity_code: 'DELETE_PHOTO_001'
      }
    });

    return res.status(200).json(
      successResponse('Photo moved to trash successfully', {
        photo_id: photoId,
        photo_title: existingPhoto.photo_title,
        is_trash: 1
      })
    );

  } catch (error) {
    console.error('Delete photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to delete photo', error.message)
    );
  }
};
// ==================== PHOTO FILES MANAGEMENT ====================

/**
 * IMPORTANT!
 * Add files to existing photo with S3 upload
 * This is used once user in logged in and want to add more images in S3.
 * 05/03/2026
 */

export const addPhotoFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);
    const files = req.files || [];

    // console.log("=== Add Photo Files ===");
    // console.log("Photo ID:", photoId);
    // console.log("Files received:", files.length);
    // console.log('req.files:', req.files?.map(f => ({ 
    //   name: f.originalname, 
    //   size: f.size, 
    //   mimetype: f.mimetype,
    //   fieldname: f.fieldname
    // })));
    // console.log('Content-Type:', req.headers['content-type']);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    if (files.length === 0) {
      return res.status(400).json(
        errorResponse('No files uploaded')
      );
    }

    // Check if photo exists and user owns it
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }
    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to add files to this photo')
      );
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');

    const addedFiles = [];

    for (const file of files) {
      try {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = path.extname(file.originalname);
        const fileName = `${timestamp}_${randomString}${fileExtension}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Get file buffer (multer memory storage)
        const fileBuffer = file.buffer;

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(fileBuffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data (optional)
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(fileBuffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        // const photoCaption = exifData?.Caption || '';
        const photoCaption = exifData?.Caption ? String(exifData.Caption) : '';
        const photoTitle = exifData?.title?.value ? String(exifData.title.value) : '';
        const photoCopyright = exifData?.CopyrightNotice ? String(exifData.CopyrightNotice) : '';

        // console.log('Caption', exifData.Caption );
        // metadata: exifData ? JSON.stringify(exifData) : null,
        // console.log('exifData', JSON.stringify(exifData));
        // return false;


        // Extract dominant color (optional)
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(fileBuffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const orientation = getOrientationScientific(width, height);

        // Generate S3 keys - using same pattern as createPhoto
        const mainFileKey = `uploads/testing/${year}/${month}/${day}/${fileName}`;
        const thumbnailKey = `uploads/testing/400/${year}/${month}/${day}/${fileName}`;

        // Upload main image to S3
        const mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
        console.log(`Main image uploaded to S3: ${mainFileUrl}`);

        // Create and upload thumbnail
        const thumbnailBuffer = await sharp(fileBuffer)
          .resize({
            width: 400,
            height: 400,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        const thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
        console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);
        // metadata: exifData ? JSON.stringify(exifData) : null,



        // Create database record for this file
        const fileRecord = await Prisma.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: ext,
            type: ext,
            dir_path: `testing/${year}/${month}/${day}`,
            file_size: String(file.size),
            photo_title: photoTitle,
            photo_caption: photoCaption, // Will be empty string if not found
            photo_copyright: photoCopyright,
            reference: '',
            source: 'Additional Upload',
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
            raw_name: baseFileName,
            Image_Name: fileName,
            original_image_name: originalName,
            isMigrat: 0,
            dominant_color: dominantColor,
          }
        });

        addedFiles.push(fileRecord);

      } catch (uploadError) {
        console.error(`Error uploading file ${file.originalname}:`, uploadError);
        // Continue with other files even if one fails
      }
    }

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_on: new Date(),
        updated_by: userId
      }
    });

    // Get total files count for response
    const totalFiles = await Prisma.pam_photos_files.count({
      where: {
        photo_id: photoId,
        is_trash: 'N'
      }
    });

    // Prepare response with serialized BigInt values
    const responseData = {
      photo_id: photoId,
      added_files: addedFiles.map(f => ({
        id: f.file_id ? f.file_id.toString() : null, // Convert BigInt to string
        filename: f.Image_Name,
        original_name: f.original_image_name,
        size: f.file_size,
        width: f.Width,
        height: f.Height,
        orientation: f.orientation,
        thumbnail_url: `${f.dir_path}/${f.Image_Name}`,
        url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/${f.dir_path}/${f.Image_Name}`,
        //thumbnail_url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/400/${f.dir_path}/${f.Image_Name}`
      })),
      total_files: totalFiles
    };

    // Use your serializeBigInt helper if available
    return res.status(201).json(
      typeof serializeBigInt === 'function'
        ? serializeBigInt(successResponse(`${addedFiles.length} file(s) added to photo`, responseData))
        : successResponse(`${addedFiles.length} file(s) added to photo`, responseData)
    );

  } catch (error) {
    console.error('Add photo files error:', error);
    return res.status(500).json(
      errorResponse('Failed to add files to photo', error)
    );
  }
};

export const addAdminPhotoFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);
    const files = req.files || [];
    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }
    if (files.length === 0) {
      return res.status(400).json(
        errorResponse('No files uploaded')
      );
    }
    // Check if photo exists and user owns it
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');

    const addedFiles = [];

    for (const file of files) {
      try {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = path.extname(file.originalname);
        const fileName = `${timestamp}_${randomString}${fileExtension}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Get file buffer (multer memory storage)
        const fileBuffer = file.buffer;

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(fileBuffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data (optional)
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(fileBuffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        // Extract dominant color (optional)
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(fileBuffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const orientation = getOrientationScientific(width, height);

        // Generate S3 keys - using same pattern as createPhoto
        const mainFileKey = `uploads/testing/${year}/${month}/${day}/${fileName}`;
        const thumbnailKey = `uploads/testing/400/${year}/${month}/${day}/${fileName}`;

        // Upload main image to S3
        const mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
        console.log(`Main image uploaded to S3: ${mainFileUrl}`);

        // Create and upload thumbnail
        const thumbnailBuffer = await sharp(fileBuffer)
          .resize({
            width: 400,
            height: 400,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        const thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
        console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

        // Create database record for this file
        const fileRecord = await Prisma.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: ext,
            type: ext,
            dir_path: `testing/${year}/${month}/${day}`,
            file_size: String(file.size),
            reference: '',
            source: 'Outlook Images',
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
            raw_name: baseFileName,
            Image_Name: fileName,
            original_image_name: originalName,
            isMigrat: 0,
            dominant_color: dominantColor,
          }
        });

        addedFiles.push(fileRecord);

      } catch (uploadError) {
        console.error(`Error uploading file ${file.originalname}:`, uploadError);    // Continue with other files even if one fails
      }
    }

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_on: new Date(),
        updated_by: userId
      }
    });

    // Get total files count for response
    const totalFiles = await Prisma.pam_photos_files.count({
      where: {
        photo_id: photoId,
        is_trash: 'N'
      }
    });

    // Prepare response with serialized BigInt values
    const responseData = {
      photo_id: photoId,
      added_files: addedFiles.map(f => ({
        id: f.file_id ? f.file_id.toString() : null, // Convert BigInt to string
        filename: f.Image_Name,
        original_name: f.original_image_name,
        size: f.file_size,
        width: f.Width,
        height: f.Height,
        orientation: f.orientation,
        url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/${f.dir_path}/${f.Image_Name}`,
        thumbnail_url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/400/${f.dir_path}/${f.Image_Name}`
      })),
      total_files: totalFiles
    };

    // Use your serializeBigInt helper if available
    return res.status(201).json(
      typeof serializeBigInt === 'function'
        ? serializeBigInt(successResponse(`${addedFiles.length} file(s) added to photo`, responseData))
        : successResponse(`${addedFiles.length} file(s) added to photo`, responseData)
    );

  } catch (error) {
    console.error('Add photo files error:', error);
    return res.status(500).json(
      errorResponse('Failed to add files to photo', error)
    );
  }
};

/*
export const addPhotoFiles11111 = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);
    const files = req.files || [];
    
    console.log("=== Add Photo Files ===");
    console.log("Photo ID:", photoId);
    console.log("Files received:", files.length);
    console.log('req.files:', req.files?.map(f => ({ 
      name: f.originalname, 
      size: f.size, 
      mimetype: f.mimetype,
      fieldname: f.fieldname
    })));
    console.log('Content-Type:', req.headers['content-type']);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    if (files.length === 0) {
      return res.status(400).json(
        errorResponse('No files uploaded')
      );
    }

    // Check if photo exists and user owns it
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to add files to this photo')
      );
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');

    const addedFiles = [];

    for (const file of files) {
      try {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = path.extname(file.originalname);
        const fileName = `${timestamp}_${randomString}${fileExtension}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Get file buffer (multer memory storage)
        const fileBuffer = file.buffer;

        // Get image metadata
        let metadata = {};
        try {
          metadata = await getImageMetadata(fileBuffer);
          console.log('Image metadata:', metadata);
        } catch (metaError) {
          console.warn('Could not extract image metadata:', metaError.message);
        }

        // Extract EXIF data (optional)
        let exifData = {};
        try {
          exifData = await extractExifFromBuffer(fileBuffer);
          console.log('EXIF data:', exifData);
        } catch (exifError) {
          console.warn('Could not extract EXIF data:', exifError.message);
        }

        // Extract dominant color (optional)
        let dominantColor = null;
        try {
          dominantColor = await extractDominantColor(fileBuffer);
          console.log('Dominant color:', dominantColor);
        } catch (colorError) {
          console.warn('Could not extract dominant color:', colorError.message);
        }

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const orientation = getOrientationScientific(width, height);

        // Generate S3 keys - using same pattern as createPhoto
        const mainFileKey = `uploads/testing/${year}/${month}/${day}/${fileName}`;
        const thumbnailKey = `uploads/testing/400/${year}/${month}/${day}/${fileName}`;

        // Upload main image to S3
        const mainFileUrl = await uploadToS3Direct(fileBuffer, mainFileKey, file.mimetype, true);
        console.log(`Main image uploaded to S3: ${mainFileUrl}`);

        // Create and upload thumbnail
        const thumbnailBuffer = await sharp(fileBuffer)
          .resize({
            width: 400,
            height: 400,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        const thumbnailUrl = await uploadToS3Direct(thumbnailBuffer, thumbnailKey, file.mimetype, true);
        console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

        // Create database record for this file
        const fileRecord = await Prisma.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: ext,
            type: ext,
            dir_path: `testing/${year}/${month}/${day}`,
            file_size: String(file.size),
            reference: '',
            source: 'Outlook Images',
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
            raw_name: baseFileName,
            Image_Name: fileName,
            original_image_name: originalName,
            isMigrat: 0,
            dominant_color: dominantColor,
            // You might want to store S3 URLs in separate fields if your schema supports it
            // s3_url: mainFileUrl,
            // s3_thumbnail_url: thumbnailUrl,
            // s3_key: mainFileKey,
            // s3_thumbnail_key: thumbnailKey
          }
        });

        addedFiles.push(fileRecord);

      } catch (uploadError) {
        console.error(`Error uploading file ${file.originalname}:`, uploadError);
        // Continue with other files even if one fails
        // You might want to collect errors and return partial success
      }
    }

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_on: new Date(),
        updated_by: userId
      }
    });

    return res.status(201).json(
      successResponse(`${addedFiles.length} file(s) added to photo`, {
        photo_id: photoId,
        added_files: addedFiles.map(f => ({
          id: f.file_id,
          filename: f.Image_Name,
          original_name: f.original_image_name,
          size: f.file_size,
          width: f.Width,
          height: f.Height,
          orientation: f.orientation,
          url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/${f.dir_path}/${f.Image_Name}`,
          thumbnail_url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/400/${f.dir_path}/${f.Image_Name}`
        })),
        total_files: await Prisma.pam_photos_files.count({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        })
      })
    );
  } catch (error) {
    console.error('Add photo files error:', error);
    return res.status(500).json(
      errorResponse('Failed to add files to photo', error)
    );
  }
};
export const addPhotoFiles000000 = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);
    const files = req.files || [];
    console.log("#########################################################################");

    // DEBUG: Log what multer received
    console.log('req.files:', req.files);
    console.log('req.file:', req.file);
    console.log('req.body:', req.body);
    console.log('Content-Type:', req.headers['content-type']);
    // return;

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    if (files.length === 0) {
      return res.status(400).json(
        errorResponse('No files uploaded')
      );
    }

    // Check if photo exists and user owns it
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to add files to this photo')
      );
    }

    const addedFiles = [];

    for (const file of files) {
      // Get image metadata
      let metadata = {};
      try {
        const fileBuffer = file.buffer || fs.readFileSync(file.path);
        metadata = await getImageMetadata(fileBuffer);
      } catch (metaError) {
        console.warn('Could not extract metadata:', metaError);
      }

      const orientation = getOrientationScientific(
        metadata.width,
        metadata.height
      );

      const fileRecord = await Prisma.pam_photos_files.create({
        data: {
          photo_id: photoId,
          file_ext: path.extname(file.originalname).replace('.', ''),
          type: path.extname(file.originalname).replace('.', ''),


          dir_path: file.path || file.url,
          file_size: String(file.size),
          reference: '',
          source: 'Additional Upload',
          date_created: new Date(),
          enter_by: String(userId),
          entered_on: new Date(),
          updated_by: String(userId),
          updated_on: new Date(),
          is_trash: 'N',
          trashed_by: '',
          trashed_on: new Date(),
          Width: metadata.width || null,
          Height: metadata.height || null,
          orientation: orientation,
          raw_name: path.parse(file.originalname).name || '',
          Image_Name: file.filename,
          original_image_name: file.originalname,
          isMigrat: 0
        }
      });

      addedFiles.push(fileRecord);
    }

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_at: new Date(),
        updated_by: userId
      }
    });

    return res.status(201).json(
      successResponse(`${addedFiles.length} file(s) added to photo`, {
        photo_id: photoId,
        added_files: addedFiles.map(f => ({
          id: f.file_id,
          filename: f.Image_Name,
          size: f.file_size
        })),
        total_files: await Prisma.pam_photos_files.count({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        })
      })
    );
  } catch (error) {
    console.error('Add photo files error:', error);
    return res.status(500).json(
      errorResponse('Failed to add files to photo', error)
    );
  }
};*/

// ==================== CATEGORY AND TAGGING CONTROLLERS ====================

/**
 * Get photos by category
 */
export const getPhotosByCategory = async (req, res) => {
  console.log('Get photos by category');
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const categoryIdNum = parseInt(categoryId);
    if (isNaN(categoryIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid category ID')
      );
    }

    // Verify category exists
    const category = await Prisma.pam_category.findUnique({
      where: { category_id: categoryIdNum }
    });

    if (!category) {
      return res.status(404).json(
        errorResponse('Category not found')
      );
    }

    // Build where clause
    const where = {
      category_id: categoryIdNum,
      is_active: 1,
      is_trash: 0
    };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy: {
        photo_id: 'desc'
      },
      skip,
      take: limit,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true
          }
        }
      }
    });

    // Process results
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description?.substring(0, 150) + (photo.description?.length > 150 ? '...' : ''),
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          photography_time: photo.photography_time,
          price: photo.price,
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: {
          category: {
            id: category.category_id,
            name: category.name,
            slug: category.slug
          },
          photos: results
        },
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Get photos by category error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by category', error)
    );
  }
};

// ==================== ADMIN CONTROLLERS ====================

/**
 * Admin: Get all photos with advanced filtering
 */
export const adminGetAllPhotos22 = async (req, res) => {
  console.log('~~~~~~~~~~~~~~~~~ adminGetAllPhotos~~~~~~~~~~~~~~~~~~~')
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const {
      search,
      category_id,
      author_id,
      status,
      is_trash,
      start_date,
      end_date,
      sort_by = 'photo_id',
      sort_order = 'desc'
    } = req.query;

    // Build where clause
    const where = {};

    // Search filter
    if (search) {
      where.OR = [
        { photo_title: { contains: search } },
        { description: { contains: search } },
        { event_name: { contains: search } }
      ];
    }

    // Category filter
    if (category_id) {
      where.category_id = parseInt(category_id);
    }

    // Author filter
    if (author_id) {
      where.author_id = parseInt(author_id);
    }

    // Status filter
    if (status !== undefined) {
      where.is_active = parseInt(status);
    }

    // Trash filter
    if (is_trash !== undefined) {
      where.is_trash = parseInt(is_trash);
    }

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Validate sort field
    const allowedSortFields = [
      'photo_id',
      'photo_title',
      'category_id',
      'author_id',
      'created_at',
      'updated_at',
      'photography_time'
    ];

    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photo_id';
    const orderBy = {
      [sortBy]: sort_order === 'asc' ? 'asc' : 'desc'
    };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos with relations
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        category: {
          select: {
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true,
            email: true
          }
        },
        _count: {
          select: {
            pam_photos_files: {
              where: { is_trash: 'N' }
            },
            pam_photo_views: true,
            //pam_photo_downloads: true
          }
        }
      }
    });

    const formattedPhotos = photos.map(photo => ({
      ...photo,
      photo_id: photo.photo_id.toString(),
      statistics: {
        files: photo._count.pam_photos_files,
        views: photo._count.pam_photo_views,
        downloads: photo._count.pam_photo_downloads
      }
    }));

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: formattedPhotos,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Admin get all photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos for admin', error)
    );
  }
};

export const adminGetAllPhotos222 = async (req, res) => {
  console.log('~~~ x ~~~ adminGetAllPhotos ~~~ x ~~~')
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const {
      search,
      category_id,
      author_id,
      status,
      is_trash,
      start_date,
      end_date,
      sort_by = 'photo_id',
      sort_order = 'desc'
    } = req.query;

    // Build where clause
    const where = {};

    // Search filter
    if (search) {
      where.OR = [
        { photo_title: { contains: search } },
        { description: { contains: search } },
        { event_name: { contains: search } }
      ];
    }

    // Category filter
    if (category_id) {
      where.category_id = parseInt(category_id);
    }

    // Author filter
    if (author_id) {
      where.author_id = parseInt(author_id);
    }

    // Status filter
    if (status !== undefined) {
      where.is_active = parseInt(status);
    }

    // Trash filter
    if (is_trash !== undefined) {
      where.is_trash = parseInt(is_trash);
    }

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Validate sort field
    const allowedSortFields = [
      'photo_id',
      'photo_title',
      'category_id',
      'author_id',
      'created_at',
      'updated_at',
      'photography_time'
    ];

    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photo_id';
    const orderBy = {
      [sortBy]: sort_order === 'asc' ? 'asc' : 'desc'
    };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos with relations
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        category: {
          select: {
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true,
            email: true
          }
        }
      }
    });

    // First, let's debug what models are available in Prisma
    //console.log('Available Prisma models:', Object.keys(Prisma));

    // Get photo IDs for batch queries
    const photoIds = photos.map(photo => photo.photo_id);

    console.log("photoIds: ", photoIds);

    // Batch query for file counts - use the correct model name
    let fileCounts = [];
    try {
      // Try different possible model names
      if (Prisma.pam_photos_files) {
        fileCounts = await Prisma.pam_photos_files.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds },
            is_trash: 'N'
          },
          _count: {
            photo_id: true
          }
        });
      } else if (Prisma.pam_photos_files_) { // Check for different naming
        fileCounts = await Prisma.pam_photos_files_.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds },
            is_trash: 'N'
          },
          _count: {
            photo_id: true
          }
        });
      } else if (Prisma.files) {
        fileCounts = await Prisma.files.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds },
            is_trash: 'N'
          },
          _count: {
            photo_id: true
          }
        });
      }
    } catch (fileError) {
      console.error('Error getting file counts:', fileError);
    }

    // Batch query for view counts
    let viewCounts = [];
    try {
      if (Prisma.pam_photo_views) {
        viewCounts = await Prisma.pam_photo_views.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds }
          },
          _count: {
            photo_id: true
          }
        });
      } else if (Prisma.views) {
        viewCounts = await Prisma.views.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds }
          },
          _count: {
            photo_id: true
          }
        });
      }
    } catch (viewError) {
      console.error('Error getting view counts:', viewError);
    }

    // Convert counts to lookup objects
    const fileCountMap = {};
    fileCounts.forEach(item => {
      fileCountMap[item.photo_id] = item._count.photo_id;
    });

    const viewCountMap = {};
    viewCounts.forEach(item => {
      viewCountMap[item.photo_id] = item._count.photo_id;
    });

    // Format photos with statistics
    const formattedPhotos = photos.map(photo => ({
      ...photo,
      photo_id: photo.photo_id.toString(),
      //photos: files,
      statistics: {
        files: fileCountMap[photo.photo_id] || 0,
        views: viewCountMap[photo.photo_id] || 0,
        downloads: 0 // Add if you have downloads model
      }
    }));
    console.log("formattedPhotos==", formattedPhotos)
    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: formattedPhotos,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Admin get all photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos for admin', error)
    );
  }
};

export const adminGetAllPhotos = async (req, res) => {
  console.log('~~~~~~x~~~~~~~~~~~ adminGetAllPhotos~~~~~~~~x~~~~~~~~~~~')
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const {
      search,
      category_id,
      author_id,
      status,
      is_trash,
      start_date,
      end_date,
      sort_by = 'photo_id',
      sort_order = 'desc'
    } = req.query;

    // Build where clause
    const where = {};

    // Search filter
    if (search) {
      where.OR = [
        { photo_title: { contains: search } },
        { description: { contains: search } },
        { event_name: { contains: search } }
      ];
    }

    // Category filter
    if (category_id) {
      where.category_id = parseInt(category_id);
    }

    // Author filter
    if (author_id) {
      where.author_id = parseInt(author_id);
    }

    // Status filter
    if (status !== undefined) {
      where.is_active = parseInt(status);
    }

    // Trash filter
    if (is_trash !== undefined) {
      where.is_trash = parseInt(is_trash);
    }

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Validate sort field
    const allowedSortFields = [
      'photo_id',
      'photo_title',
      'category_id',
      'author_id',
      'created_at',
      'updated_at',
      'photography_time'
    ];

    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photo_id';
    const orderBy = {
      [sortBy]: sort_order === 'asc' ? 'asc' : 'desc'
    };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos with relations
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        category: {
          select: {
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true,
            email: true
          }
        }
      }
    });

    // Get photo IDs for batch queries
    const photoIds = photos.map(photo => photo.photo_id);

    // console.log("photoIds: ", photoIds);

    // Get ALL files for each photo (not just counts)
    let allFiles = [];
    try {
      // Fetch all files for these photo IDs
      if (Prisma.pam_photos_files) {
        allFiles = await Prisma.pam_photos_files.findMany({
          where: {
            photo_id: { in: photoIds },
            is_trash: 'N'
          },
          select: {
            file_id: true,
            photo_id: true,
            dir_path: true,
            Image_Name: true,
            isMigrat: true,
            migratedFilePath: true,
            migratedFileName: true,
            orientation: true,
            Width: true,
            Height: true,
            type: true,
            source: true,
            file_size: true,
            file_ext: true,
            original_image_name: true,
            date_created: true,
            updated_on: true,
            enter_by: true,
            updated_by: true,
            is_trash: true
          },
          orderBy: {
            file_id: 'asc'
          }
        });
      }
    } catch (fileError) {
      console.error('Error getting files:', fileError);
    }

    // Group files by photo_id for easier access
    const filesByPhotoId = {};
    allFiles.forEach(file => {
      if (!filesByPhotoId[file.photo_id]) {
        filesByPhotoId[file.photo_id] = [];
      }
      filesByPhotoId[file.photo_id].push({
        file_id: file.file_id ? file.file_id.toString() : '',
        photo_id: file.photo_id ? file.photo_id.toString() : '',
        dir_path: file.dir_path || '',
        Image_Name: file.Image_Name || '',
        is_migrated: file.isMigrat === 1,
        migrated_file_path: file.migratedFilePath || '',
        migrated_file_name: file.migratedFileName || '',
        orientation: file.orientation || 'unknown',
        width: file.Width || 0,
        height: file.Height || 0,
        type: file.type || '',
        source: file.source || '',
        file_size: file.file_size || 0,
        file_ext: file.file_ext || '',
        original_image_name: file.original_image_name || '',
        created_at: file.date_created,
        updated_at: file.updated_on,
        enter_by: file.enter_by || 0,
        updated_by: file.updated_by || 0,
        is_trash: file.is_trash,
        // Generate URLs
        image_url: file.dir_path && file.Image_Name
          ? `${file.dir_path}/${file.Image_Name}`
          : null,
        thumbnail_url: file.dir_path && file.Image_Name
          ? `${file.dir_path}/${file.Image_Name}`
          : null
      });
    });

    // Batch query for view counts
    let viewCounts = [];
    try {
      if (Prisma.pam_photo_views) {
        viewCounts = await Prisma.pam_photo_views.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds }
          },
          _count: {
            photo_id: true
          }
        });
      } else if (Prisma.views) {
        viewCounts = await Prisma.views.groupBy({
          by: ['photo_id'],
          where: {
            photo_id: { in: photoIds }
          },
          _count: {
            photo_id: true
          }
        });
      }
    } catch (viewError) {
      console.error('Error getting view counts:', viewError);
    }

    // Convert counts to lookup objects
    const viewCountMap = {};
    viewCounts.forEach(item => {
      viewCountMap[item.photo_id] = item._count.photo_id;
    });

    // Format photos with all files and statistics
    const formattedPhotos = photos.map(photo => {
      const photoId = photo.photo_id;
      const files = filesByPhotoId[photoId] || [];
      const coverImage = files.length > 0 ? files[0] : null;

      // Calculate orientation from files if needed
      let orientation = 'unknown';
      if (files.length > 0) {
        const file = files[0];
        if (file.orientation && file.orientation !== 'unknown') {
          orientation = file.orientation;
        } else if (file.width && file.height) {
          const ratio = file.width / file.height;
          if (ratio > 1.1) orientation = 'horizontal';
          else if (ratio < 0.9) orientation = 'vertical';
          else orientation = 'square';
        }
      }

      return {
        ...photo,
        photo_id: photo.photo_id.toString(),
        // Include all files
        files: files,
        total_files: files.length,
        cover_image: coverImage,
        image_url: coverImage?.image_url || null,
        thumbnail_url: coverImage?.thumbnail_url || null,
        orientation: orientation,
        // Statistics
        statistics: {
          files: files.length,
          views: viewCountMap[photoId] || 0,
          downloads: 0 // Add if you have downloads model
        }
      };
    });

    // console.log("formattedPhotos count:", formattedPhotos.length);

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: formattedPhotos,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Admin get all photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos for admin', error)
    );
  }
};

/**
 * Toggle photo status (active/inactive)
 */
export const togglePhotoStatus = async (req, res) => {
  console.log("=== togglePhotoStatus // Checked ===")
  try {
    const { id } = req.params;
    const userId = req.admin?.admin_id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!photo) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    const newStatus = photo.is_active === 1 ? 0 : 1;
    const updatedPhoto = await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        is_active: newStatus,
        updated_on: new Date(),
        updated_by: userId
      }
    });

    return res.status(200).json(
      successResponse(`Photo ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`, {
        photo_id: photoId,
        new_status: newStatus,
        previous_status: photo.is_active
      })
    );
  } catch (error) {
    console.error('Toggle photo status error:', error);
    return res.status(500).json(
      errorResponse('Failed to toggle photo status', error)
    );
  }
};

// ==================== STATISTICS AND ANALYTICS ====================

/**
 * Get photo statistics
 */
export const getPhotoStatistics = async (req, res) => {
  try {
    const [
      totalPhotos,
      activePhotos,
      trashedPhotos,
      photosWithFiles,
      totalFiles,
      photosByCategory,
      photosByMonth,
      topAuthors,
      recentActivity
    ] = await Promise.all([
      // Total photos
      Prisma.pam_photos.count(),
      // Active photos
      Prisma.pam_photos.count({ where: { is_active: 1, is_trash: 0 } }),
      // Trashed photos
      Prisma.pam_photos.count({ where: { is_trash: 1 } }),
      // Photos with at least one file
      Prisma.pam_photos.count({
        where: {
          pam_photos_files: {
            some: { is_trash: 'N' }
          }
        }
      }),
      // Total files
      Prisma.pam_photos_files.count({ where: { is_trash: 'N' } }),
      // Photos by category
      Prisma.pam_photos.groupBy({
        by: ['category_id'],
        where: { is_trash: 0 },
        _count: { category_id: true },
        orderBy: { _count: { category_id: 'desc' } },
        take: 10
      }),
      // Photos created by month (last 6 months)
      Prisma.$queryRaw`
        SELECT 
          DATE_FORMAT(created_at, '%Y-%m') as month,
          COUNT(*) as count
        FROM pam_photos
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
        ORDER BY month DESC
      `,
      // Top authors (by photo count)
      Prisma.pam_photos.groupBy({
        by: ['author_id'],
        where: { is_trash: 0 },
        _count: { author_id: true },
        orderBy: { _count: { author_id: 'desc' } },
        take: 10
      }),
      // Recent activity
      Prisma.pam_photos.findMany({
        where: { is_trash: 0 },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          photo_id: true,
          photo_title: true,
          created_at: true,
          author: {
            select: {
              username: true,
              firstname: true,
              lastname: true
            }
          }
        }
      })
    ]);

    // Get category names
    const categoriesWithNames = await Promise.all(
      photosByCategory.map(async (cat) => {
        const category = await Prisma.pam_category.findUnique({
          where: { category_id: cat.category_id },
          select: { name: true }
        });
        return {
          category_id: cat.category_id,
          category_name: category?.name || 'Unknown',
          count: cat._count.category_id
        };
      })
    );

    // Get author names
    const authorsWithNames = await Promise.all(
      topAuthors.map(async (author) => {
        const user = await Prisma.pam_users.findUnique({
          where: { id: author.author_id },
          select: { username: true, firstname: true, lastname: true }
        });
        return {
          author_id: author.author_id,
          author_name: user ? `${user.firstname} ${user.lastname}` : 'Unknown',
          count: author._count.author_id
        };
      })
    );

    return res.status(200).json(
      successResponse('Photo statistics retrieved', {
        overview: {
          total_photos: totalPhotos,
          active_photos: activePhotos,
          trashed_photos: trashedPhotos,
          photos_with_files: photosWithFiles,
          total_files: totalFiles,
          average_files_per_photo: totalPhotos > 0 ? (totalFiles / totalPhotos).toFixed(2) : 0
        },
        distribution: {
          by_category: categoriesWithNames,
          by_month: photosByMonth,
          by_author: authorsWithNames
        },
        recent_activity: recentActivity.map(photo => ({
          id: photo.photo_id,
          title: photo.photo_title,
          author: `${photo.author?.firstname} ${photo.author?.lastname}`,
          created_at: photo.created_at
        }))
      })
    );
  } catch (error) {
    console.error('Get photo statistics error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo statistics', error)
    );
  }
};

/**
 * Get popular photos
 */
export const getPopularPhotos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const period = req.query.period || 'all'; // all, week, month, year

    let dateFilter = {};
    if (period !== 'all') {
      const date = new Date();
      switch (period) {
        case 'week':
          date.setDate(date.getDate() - 7);
          break;
        case 'month':
          date.setMonth(date.getMonth() - 1);
          break;
        case 'year':
          date.setFullYear(date.getFullYear() - 1);
          break;
      }
      dateFilter.gte = date;
    }

    // Get photos with most views
    const popularPhotos = await Prisma.pam_photo_views.groupBy({
      by: ['photo_id'],
      where: {
        viewed_at: dateFilter
      },
      _count: {
        photo_id: true
      },
      orderBy: {
        _count: {
          photo_id: 'desc'
        }
      },
      take: limit
    });

    // Get photo details
    const photosWithDetails = await Promise.all(
      popularPhotos.map(async (view) => {
        const photo = await Prisma.pam_photos.findUnique({
          where: { photo_id: BigInt(view.photo_id) },
          include: {
            author: {
              select: {
                username: true,
                firstname: true,
                lastname: true
              }
            },
            category: {
              select: {
                name: true
              }
            }
          }
        });

        if (!photo) return null;

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: view.photo_id,
            is_trash: 'N'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(Number(photo.photo_id).toString()).toString('base64'),
          photo_title: photo.photo_title,
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          category_name: photo.category?.name,
          view_count: view._count.photo_id,
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    const filteredPhotos = photosWithDetails.filter(photo => photo !== null);

    return res.status(200).json(
      successResponse('Popular photos retrieved', {
        period,
        photos: filteredPhotos
      })
    );
  } catch (error) {
    console.error('Get popular photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch popular photos', error)
    );
  }
};

export const addPhotoTags = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    const { tag_ids, photo_tags } = req.body;

    if (!tag_ids && !photo_tags) {
      return res.status(400).json(
        errorResponse('Either tag_ids or photo_tags is required')
      );
    }

    // Check if photo exists and user has permission
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to add tags to this photo')
      );
    }

    const addedTags = [];

    // Process tag_ids (existing tags)
    if (tag_ids) {
      const tagIdsArray = Array.isArray(tag_ids) ? tag_ids : tag_ids.split(',');
      const uniqueTagIds = [...new Set(tagIdsArray.filter(id => id))];

      for (const tagId of uniqueTagIds) {
        const tagIdNum = parseInt(tagId);

        // Check if tag exists
        const tagExists = await Prisma.pam_tags.findUnique({
          where: { tag_id: tagIdNum }
        });

        if (!tagExists) {
          continue;
        }

        // Check if tag is already added to photo
        const existingTag = await Prisma.pam_photo_tags.findFirst({
          where: {
            photo_id: photoId,
            tag_id: tagIdNum
          }
        });

        if (!existingTag) {
          await Prisma.pam_photo_tags.create({
            data: {
              photo_id: photoId,
              tag_id: tagIdNum
            }
          });
          addedTags.push({ id: tagIdNum, name: tagExists.photo_tag });
        }
      }
    }

    // Process photo_tags (new tags from string)
    if (photo_tags) {
      const tagsFromString = photo_tags.split(',').map(tag => tag.trim());
      for (const tagName of tagsFromString) {
        if (!tagName) continue;

        // Find or create tag
        let tag = await Prisma.pam_tags.findFirst({
          where: { photo_tag: tagName }
        });

        if (!tag) {
          const slug = tagName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
          tag = await Prisma.pam_tags.create({
            data: {
              photo_tag: tagName,
              photo_slug: slug
            }
          });
        }

        // Check if tag is already added to photo
        const existingTag = await Prisma.pam_photo_tags.findFirst({
          where: {
            photo_id: photoId,
            tag_id: tag.tag_id
          }
        });

        if (!existingTag) {
          await Prisma.pam_photo_tags.create({
            data: {
              photo_id: photoId,
              tag_id: tag.tag_id
            }
          });
          addedTags.push({ id: tag.tag_id, name: tag.photo_tag });
        }
      }
    }

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_at: new Date(),
        updated_by: userId
      }
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: req.user.role === 'admin' ? 'admin' : 'user',
        activity_type: 'update',
        module: 'photos',
        action: 'add_tags',
        message: `Added ${addedTags.length} tag(s) to photo: "${existingPhoto.photo_title}"`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: existingPhoto.photo_title,
        created_at: new Date()
      }
    });

    return res.status(200).json(
      successResponse('Tags added successfully', {
        photo_id: photoId,
        added_tags: addedTags,
        total_added: addedTags.length
      })
    );
  } catch (error) {
    console.error('Add photo tags error:', error);
    return res.status(500).json(
      errorResponse('Failed to add tags to photo', error)
    );
  }
};

/**
 * Remove tag from photo
 */
export const removePhotoTag = async (req, res) => {
  try {
    const { id, tagId } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);
    const tagIdNum = parseInt(tagId);

    if (isNaN(photoId) || isNaN(tagIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or tag ID')
      );
    }

    // Check if photo exists and user has permission
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to remove tags from this photo')
      );
    }

    // Check if tag exists on photo
    const photoTag = await Prisma.pam_photo_tags.findFirst({
      where: {
        photo_id: photoId,
        tag_id: tagIdNum
      },
      include: {
        tag: {
          select: {
            photo_tag: true
          }
        }
      }
    });

    if (!photoTag) {
      return res.status(404).json(
        errorResponse('Tag not found on this photo')
      );
    }

    // Remove tag from photo
    await Prisma.pam_photo_tags.delete({
      where: {
        id: photoTag.id
      }
    });

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_at: new Date(),
        updated_by: userId
      }
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: req.user.role === 'admin' ? 'admin' : 'user',
        activity_type: 'update',
        module: 'photos',
        action: 'remove_tag',
        message: `Removed tag "${photoTag.tag.photo_tag}" from photo: "${existingPhoto.photo_title}"`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: existingPhoto.photo_title,
        created_at: new Date()
      }
    });

    return res.status(200).json(
      successResponse('Tag removed successfully', {
        photo_id: photoId,
        removed_tag: {
          id: tagIdNum,
          name: photoTag.tag.photo_tag
        }
      })
    );
  } catch (error) {
    console.error('Remove photo tag error:', error);
    return res.status(500).json(
      errorResponse('Failed to remove tag from photo', error)
    );
  }
};

/**
 * Get photo tags
 */
export const getPhotoTags = async (req, res) => {
  try {
    const { id } = req.params;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      select: { is_active: true, is_trash: true, author_id: true }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check permissions
    const isOwner = req.user?.id === existingPhoto.author_id;
    const isAdmin = req.user?.role === 'admin';
    const isPublic = existingPhoto.is_active === 1 && existingPhoto.is_trash === 0;

    if (!isPublic && !isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('Access denied')
      );
    }

    // Get tags for this photo
    const photoTags = await Prisma.pam_photo_tags.findMany({
      where: {
        photo_id: photoId
      },
      include: {
        tag: {
          select: {
            tag_id: true,
            photo_tag: true,
            photo_slug: true
          }
        }
      }
    });

    return res.status(200).json(
      successResponse('Photo tags retrieved successfully', {
        photo_id: photoId,
        tags: photoTags.map(pt => pt.tag),
        count: photoTags.length
      })
    );
  } catch (error) {
    console.error('Get photo tags error:', error);
    return res.status(500).json(
      errorResponse('Failed to get photo tags', error)
    );
  }
};

// ==================== ADDITIONAL MISSING CONTROLLERS ====================

/**
 * Get photos by author
 */
export const getPhotosByAuthor = async (req, res) => {
  try {
    const { authorId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const authorIdNum = parseInt(authorId);
    if (isNaN(authorIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid author ID')
      );
    }

    // Build where clause
    const where = {
      author_id: authorIdNum,
      is_active: 1,
      is_trash: 0
    };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy: {
        photo_id: 'desc'
      },
      skip,
      take: limit,
      include: {
        category: {
          select: {
            name: true
          }
        }
      }
    });

    // Process results
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description?.substring(0, 150) + (photo.description?.length > 150 ? '...' : ''),
          category_name: photo.category?.name,
          photography_time: photo.photography_time,
          price: photo.price,
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: results,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Get photos by author error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by author', error)
    );
  }
};

/**
 * Restore photo from trash
 */
export const restorePhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists in trash
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.is_trash !== 1) {
      return res.status(400).json(
        errorResponse('Photo is not in trash')
      );
    }

    // Check permissions (admin only for restoring)
    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to restore this photo')
      );
    }

    // Restore photo
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        is_trash: 0,
        restored_by: userId,
        restored_at: new Date(),
        updated_at: new Date()
      }
    });

    // Also restore all files
    await Prisma.pam_photos_files.updateMany({
      where: { photo_id: photoId },
      data: {
        is_trash: 'N'
      }
    });

    return res.status(200).json(
      successResponse('Photo restored successfully', {
        photo_id: photoId,
        title: existingPhoto.photo_title
      })
    );
  } catch (error) {
    console.error('Restore photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to restore photo', error)
    );
  }
};

export const restorePhotoAdmin22 = async (req, res) => {
  console.log("----- restorePhotoAdmin -----")
  try {
    const { id, fileId } = req.params;
    const userId = req.user.id || req.admin?.admin_id;
    const photo_id = parseInt(id);
    const file_id = parseInt(fileId);
    if (isNaN(photo_id) || isNaN(file_id)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }
    console.log(file_id, "----- photo_id -----", photo_id)
    return;
    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });
    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }
    // Check if file exists and belongs to photo
    const existingFile = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileIdNum,
        photo_id: photoId,
        is_trash: 'Y'
      }
    });
    if (!existingFile) {
      return res.status(404).json(
        errorResponse('File not found or already removed')
      );
    }
    // Soft delete file
    await Prisma.pam_photos_files.update({
      where: { file_id: fileIdNum },
      data: {
        is_trash: 'N',
        trashed_by: String(userId),
        trashed_on: new Date()
      }
    });
    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_on: new Date(),
        updated_by: userId
      }
    });
    return res.status(200).json(
      successResponse('File restoreed successfully', {
        photo_id: photoId,
        file_id: fileIdNum,
        filename: existingFile.Image_Name
      })
    );
  } catch (error) {
    console.error('restore photo file error:', error);
    return res.status(500).json(
      errorResponse('Failed to restore file from photo', error)
    );
  }
};

export const restorePhotoAdmin = async (req, res) => {
  console.log("----- restorePhotoAdmin -----");

  try {
    const { id, file_id } = req.params;
    const userId = req.user?.id || req.admin?.admin_id;

    // Parse IDs
    const photoId = parseInt(id);
    const fileId = parseInt(file_id);

    console.log("Photo ID:", photoId, "File ID:", fileId);

    // Validate IDs - check both are valid numbers
    if (isNaN(photoId) || isNaN(fileId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }

    // Check if photo exists - FIXED: Use photo_id, not file_id
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: photoId // Changed from file_id to photo_id
      }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse(`Photo not found.`)
      );
    }

    // Check if file exists and belongs to the photo and is trashed
    const existingFile = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileId,
        photo_id: photoId, // ADDED: Ensure file belongs to this photo
        is_trash: 'Y'
      }
    });

    if (!existingFile) {
      return res.status(404).json(
        errorResponse('File not found or is not in trash')
      );
    }

    // Use transaction for data consistency
    await Prisma.$transaction(async (tx) => {
      // Restore the file (set is_trash back to 'N')
      await tx.pam_photos_files.update({
        where: { file_id: fileId },
        data: {
          is_trash: 'N',
          trashed_by: String(userId),
          trashed_on: new Date()
        }
      });

      // ADDED: Update photo's updated timestamp
      await tx.pam_photos.update({
        where: { photo_id: photoId },
        data: {
          updated_on: new Date(),
          updated_by: userId
        }
      });
    });

    // Log activity for audit trail - FIXED variable names
    // await Prisma.pam_activities.create({
    //   data: {
    //     user_id: userId,
    //     user_name: req.user?.username || 'Admin',
    //     user_type: 'admin',
    //     activity_type: 'restore',
    //     module: 'photos',
    //     action: 'file_restore',
    //     message: `Restored file "${existingFile.Image_Name}" for photo ID: ${photoId}`,
    //     status: 'success',
    //     severity: 'info',
    //     ip_address: req.ip,
    //     resource_name: existingFile.Image_Name,
    //     resource_id: fileId.toString(), // Changed from fileIdNum to fileId
    //     created_at: new Date(),
    //     activity_code: 'Restore File A005'
    //   }
    // });

    return res.status(200).json(
      successResponse('File restored successfully', {
        photo_id: photoId, // ADDED: Include photo_id in response
        file_id: fileId,
        filename: existingFile.Image_Name,
        original_name: existingFile.original_image_name
      })
    );

  } catch (error) {
    console.error('Restore photo file error:', error);
    console.error('Error stack:', error.stack);

    return res.status(500).json(
      errorResponse('Failed to restore file from photo',
        process.env.NODE_ENV === 'development' ? error.message : undefined
      )
    );
  }
};

export const restorePhotoFile = async (req, res) => {
  console.log("----- restorePhotoFile (User) -----");
  try {
    const { id, file_id } = req.params;
    const userId = req.user?.id || req.body?.updated_by || req.admin?.admin_id;
    const photoId = parseInt(id);
    const fileId = parseInt(file_id);
    console.log("Photo ID:", photoId, "File ID:", fileId);
    if (isNaN(photoId) || isNaN(fileId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: photoId
      }
    });
    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check if user owns this photo or is admin
    const isOwner = existingPhoto.author_id === userId;
    const isAdmin = req.user?.role === 'admin' || req.admin?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('You do not have permission to restore files from this photo')
      );
    }

    // Check if file exists, belongs to the photo, and is trashed
    const existingFile = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileId,
        photo_id: photoId,
        is_trash: 'Y'
      }
    });

    if (!existingFile) {
      return res.status(404).json(
        errorResponse('File not found or is not in trash')
      );
    }

    // Use transaction for data consistency
    await Prisma.$transaction(async (tx) => {
      // Restore the file (set is_trash back to 'N')
      await tx.pam_photos_files.update({
        where: { file_id: fileId },
        data: {
          is_trash: 'N',
          trashed_by: String(userId),
          trashed_on: new Date()
        }
      });

      // Update photo's updated timestamp
      await tx.pam_photos.update({
        where: { photo_id: photoId },
        data: {
          updated_on: new Date(),
          updated_by: userId
        }
      });
    });

    // Log activity for audit trail
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user?.username || req.user?.email || 'User',
        user_type: req.user?.role === 'admin' ? 'admin' : 'user',
        activity_type: 'restore',
        module: 'photos',
        action: 'file_restore',
        message: `Restored file "${existingFile.Image_Name}" from trash for photo: "${existingPhoto.photo_title}" (ID: ${photoId})`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        resource_name: existingFile.Image_Name,
        resource_id: fileId,
        created_at: new Date(),
        activity_code: 'RESTORE_FILE_001'
      }
    });

    return res.status(200).json(
      successResponse('File restored successfully', {
        photo_id: photoId,
        file_id: fileId,
        filename: existingFile.Image_Name,
        original_name: existingFile.original_image_name,
        is_trash: 'N'
      })
    );

  } catch (error) {
    console.error('Restore photo file error:', error);
    console.error('Error stack:', error.stack);

    return res.status(500).json(
      errorResponse('Failed to restore file from photo',
        process.env.NODE_ENV === 'development' ? error.message : undefined
      )
    );
  }
};


/**
 * Remove photo file
 */
export const removePhotoFile = async (req, res) => {
  console.log("@@ I am in removePhotoFile");
  try {
    const { id, fileId } = req.params;
    //const userId = req.user.id;
    const userId = req.user.id || req.admin?.admin_id;
    const photoId = parseInt(id);
    const fileIdNum = parseInt(fileId);
    if (isNaN(photoId) || isNaN(fileIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }
    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });
    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }
    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to remove files from this photo')
      );
    }
    // Check if file exists and belongs to photo
    const existingFile = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileIdNum,
        photo_id: photoId,
        is_trash: 'N'
      }
    });
    if (!existingFile) {
      return res.status(404).json(
        errorResponse('File not found or already removed')
      );
    }
    // Soft delete file
    await Prisma.pam_photos_files.update({
      where: { file_id: fileIdNum },
      data: {
        is_trash: 'Y',
        trashed_by: String(userId),
        trashed_on: new Date()
      }
    });
    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_on: new Date(),
        updated_by: userId
      }
    });
    return res.status(200).json(
      successResponse('File removed successfully', {
        photo_id: photoId,
        file_id: fileIdNum,
        filename: existingFile.Image_Name
      })
    );
  } catch (error) {
    console.error('Remove photo file error:', error);
    return res.status(500).json(
      errorResponse('Failed to remove file from photo', error)
    );
  }
};

export const removePhotoFileByAdmin = async (req, res) => {
  console.log("@@ I am in removePhotoFileByAdmin");
  try {
    const { id, fileId } = req.params;
    const userId = req.user.id || req.admin?.admin_id;
    const photoId = parseInt(id);
    const fileIdNum = parseInt(fileId);
    if (isNaN(photoId) || isNaN(fileIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }
    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });
    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }
    // Check if file exists and belongs to photo
    const existingFile = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileIdNum,
        photo_id: photoId,
        is_trash: 'N'
      }
    });
    if (!existingFile) {
      return res.status(404).json(
        errorResponse('File not found or already removed')
      );
    }
    // Soft delete file
    await Prisma.pam_photos_files.update({
      where: { file_id: fileIdNum },
      data: {
        is_trash: 'Y',
        trashed_by: String(userId),
        trashed_on: new Date()
      }
    });
    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_on: new Date(),
        updated_by: userId
      }
    });
    return res.status(200).json(
      successResponse('File removed successfully', {
        photo_id: photoId,
        file_id: fileIdNum,
        filename: existingFile.Image_Name
      })
    );
  } catch (error) {
    console.error('Remove photo file error:', error);
    return res.status(500).json(
      errorResponse('Failed to remove file from photo', error)
    );
  }
};

/**
 * Admin: Update photo details (with admin permissions)
 */
export const adminUpdatePhotoDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Only admin can use this function
    if (req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('Admin access required')
      );
    }

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
      is_active,
      is_trash,
      author_id
    } = req.body;

    // Build update data
    const updateData = {
      updated_at: new Date(),
      updated_by: userId
    };

    if (photo_title !== undefined) updateData.photo_title = photo_title;
    if (description !== undefined) updateData.description = description;
    if (category_id !== undefined) updateData.category_id = parseInt(category_id);
    if (sub_category_id !== undefined) updateData.sub_category_id = parseInt(sub_category_id);
    if (country_id !== undefined) updateData.country_id = parseInt(country_id);
    if (state_id !== undefined) updateData.state_id = parseInt(state_id);
    if (city_id !== undefined) updateData.city_id = parseInt(city_id);
    if (source_name !== undefined) updateData.source_name = source_name;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (photography_time !== undefined) updateData.photography_time = new Date(photography_time);
    if (event_name !== undefined) updateData.event_name = event_name;
    if (photo_credit_id !== undefined) updateData.credit = parseInt(photo_credit_id);
    if (is_active !== undefined) updateData.is_active = parseToNumber(is_active);
    if (is_trash !== undefined) updateData.is_trash = parseToNumber(is_trash);
    if (author_id !== undefined) updateData.author_id = parseInt(author_id);

    // Update photo
    const updatedPhoto = await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: updateData,
      include: {
        category: { select: { name: true } },
        author: { select: { username: true, firstname: true, lastname: true } }
      }
    });

    // Log admin activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'admin',
        activity_type: 'update',
        module: 'photos',
        action: 'admin_photo_update',
        message: `Admin updated photo: "${photo_title || existingPhoto.photo_title}"`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: photo_title || existingPhoto.photo_title,
        created_at: new Date()
      }
    });

    return res.status(200).json(
      successResponse('Photo updated successfully by admin', {
        photo: {
          id: updatedPhoto.photo_id,
          title: updatedPhoto.photo_title,
          author: `${updatedPhoto.author?.firstname} ${updatedPhoto.author?.lastname}`,
          category: updatedPhoto.category?.name,
          is_active: updatedPhoto.is_active,
          is_trash: updatedPhoto.is_trash,
          updated_at: updatedPhoto.updated_at
        }
      })
    );
  } catch (error) {
    console.error('Admin update photo details error:', error);
    return res.status(500).json(
      errorResponse('Failed to update photo as admin', error)
    );
  }
};

/**
 * Admin: Bulk update photos
 */
export const adminBulkUpdatePhotos = async (req, res) => {
  // console.log("-*-adminBulkUpdatePhotos-*-");
  // return;
  try {
    //const userId = req.user.id;
    const userId = req.body?.updated_by || req.admin?.admin_id;

    // Only admin can use this function
    if (req.admin.admin_role_id !== 1) {
      return res.status(403).json(
        errorResponse('Admin access required')
      );
    }

    const { photo_ids, update_fields } = req.body;
    // console.log("@@@@", req.admin, photo_ids, update_fields);
    // return

    if (!photo_ids || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json(
        errorResponse('photo_ids array is required')
      );
    }

    if (!update_fields || typeof update_fields !== 'object') {
      return res.status(400).json(
        errorResponse('update_fields object is required')
      );
    }

    // Convert photo_ids to numbers
    const photoIds = photo_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    if (photoIds.length === 0) {
      return res.status(400).json(
        errorResponse('No valid photo IDs provided')
      );
    }

    // Prepare update data
    const updateData = {
      updated_on: new Date(),
      updated_by: userId
    };

    // Add allowed fields to update
    const allowedFields = [
      'category_id', 'sub_category_id', 'country_id', 'state_id', 'city_id',
      'is_active', 'is_trash', 'price', 'author_id', 'credit'
    ];

    for (const field of allowedFields) {
      if (update_fields[field] !== undefined) {
        if (field.includes('_id') || field === 'credit' || field === 'author_id') {
          updateData[field] = parseInt(update_fields[field]);
        } else if (field === 'is_active' || field === 'is_trash') {
          updateData[field] = parseToNumber(update_fields[field]);
        } else if (field === 'price') {
          updateData[field] = parseFloat(update_fields[field]);
        }
      }
    }

    // Bulk update
    const result = await Prisma.pam_photos.updateMany({
      where: {
        photo_id: {
          in: photoIds.map(id => BigInt(id))
        }
      },
      data: updateData
    });

    // Log admin activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'admin',
        activity_type: 'update',
        module: 'photos',
        action: 'bulk_update_photos',
        message: `Admin bulk updated ${result.count} photos`,
        status: 'success',
        severity: 'info',
        ip_address: req.ip,
        resource_name: 'Multiple Photos',
        created_at: new Date(),
        activity_code: 'UPD2001'
      }
    });

    return res.status(200).json(
      successResponse('Photos bulk updated successfully', {
        count: result.count,
        updated_photos: photoIds.length,
        fields_updated: Object.keys(update_fields)
      })
    );
  } catch (error) {
    console.error('Admin bulk update photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to bulk update photos', error)
    );
  }
};

/**
 * Admin: Bulk delete photos
 */
export const adminBulkDeletePhotos = async (req, res) => {
  try {
    const userId = req.user.id;

    // Only admin can use this function
    if (req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('Admin access required')
      );
    }

    const { photo_ids, permanent = false } = req.body;

    if (!photo_ids || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json(
        errorResponse('photo_ids array is required')
      );
    }

    // Convert photo_ids to numbers
    const photoIds = photo_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    if (photoIds.length === 0) {
      return res.status(400).json(
        errorResponse('No valid photo IDs provided')
      );
    }

    let result;
    let message;

    if (permanent) {
      // Permanent delete
      result = await Prisma.$transaction(async (tx) => {
        // Delete photo tags first
        await tx.pam_photo_tags.deleteMany({
          where: {
            photo_id: {
              in: photoIds
            }
          }
        });

        // Delete photo files
        await tx.pam_photos_files.deleteMany({
          where: {
            photo_id: {
              in: photoIds
            }
          }
        });

        // Delete photo views
        await tx.pam_photo_views.deleteMany({
          where: {
            photo_id: {
              in: photoIds
            }
          }
        });

        // Delete photo downloads
        await tx.pam_photo_downloads.deleteMany({
          where: {
            photo_id: {
              in: photoIds
            }
          }
        });

        // Finally delete photos
        return await tx.pam_photos.deleteMany({
          where: {
            photo_id: {
              in: photoIds.map(id => BigInt(id))
            }
          }
        });
      });
      message = `Permanently deleted ${result.count} photos`;
    } else {
      // Soft delete (move to trash)
      result = await Prisma.pam_photos.updateMany({
        where: {
          photo_id: {
            in: photoIds.map(id => BigInt(id))
          }
        },
        data: {
          is_trash: 1,
          trashed_by: userId,
          trashed_at: new Date(),
          updated_at: new Date()
        }
      });

      // Also mark files as trashed
      await Prisma.pam_photos_files.updateMany({
        where: {
          photo_id: {
            in: photoIds
          }
        },
        data: {
          is_trash: 'Y',
          trashed_by: String(userId),
          trashed_on: new Date()
        }
      });

      message = `Moved ${result.count} photos to trash`;
    }

    // Log admin activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'admin',
        activity_type: 'delete',
        module: 'photos',
        action: 'bulk_delete_photos',
        message: `Admin ${permanent ? 'permanently deleted' : 'moved to trash'} ${result.count} photos`,
        status: 'success',
        severity: 'warning',
        ip_address: req.ip,
        resource_name: 'Multiple Photos',
        created_at: new Date()
      }
    });

    return res.status(200).json(
      successResponse(message, {
        count: result.count,
        deleted_photos: photoIds.length,
        permanent
      })
    );
  } catch (error) {
    console.error('Admin bulk delete photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to bulk delete photos', error)
    );
  }
};

/**
 * Admin: Export photos
 */
export const adminExportPhotos = async (req, res) => {
  try {
    // Only admin can use this function
    if (req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('Admin access required')
      );
    }

    const {
      format = 'json',
      start_date,
      end_date,
      category_id,
      author_id,
      include_files = false
    } = req.query;

    // Build where clause
    const where = {};

    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    if (category_id) {
      where.category_id = parseInt(category_id);
    }

    if (author_id) {
      where.author_id = parseInt(author_id);
    }

    // Get photos with relations
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy: { photo_id: 'desc' },
      include: {
        category: { select: { name: true } },
        author: { select: { username: true, firstname: true, lastname: true } },
        _count: {
          select: {
            pam_photos_files: true,
            pam_photo_views: true,
            pam_photo_downloads: true
          }
        }
      }
    });

    // Process photos data
    const processedPhotos = await Promise.all(
      photos.map(async (photo) => {
        const photoData = {
          id: Number(photo.photo_id),
          title: photo.photo_title,
          description: photo.description,
          event_name: photo.event_name,
          category: photo.category?.name,
          author: `${photo.author?.firstname} ${photo.author?.lastname}`,
          price: photo.price,
          photography_time: photo.photography_time,
          created_at: photo.created_at,
          updated_at: photo.updated_at,
          is_active: photo.is_active,
          is_trash: photo.is_trash,
          statistics: {
            files: photo._count.pam_photos_files,
            views: photo._count.pam_photo_views,
            downloads: photo._count.pam_photo_downloads
          }
        };

        if (include_files) {
          const files = await Prisma.pam_photos_files.findMany({
            where: { photo_id: Number(photo.photo_id) },
            select: {
              file_id: true,
              Image_Name: true,
              dir_path: true,
              file_size: true,
              file_ext: true,
              Width: true,
              Height: true
            }
          });
          photoData.files = files;
        }

        return photoData;
      })
    );

    // Format response based on requested format
    if (format === 'csv') {
      // Generate CSV
      const csvData = processedPhotos.map(photo => ({
        ID: photo.id,
        Title: photo.title,
        Description: photo.description,
        Category: photo.category,
        Author: photo.author,
        Price: photo.price,
        'Created At': photo.created_at,
        'Files Count': photo.statistics.files,
        'Views': photo.statistics.views,
        'Downloads': photo.statistics.downloads
      }));

      const csv = require('csv-stringify/sync');
      const csvOutput = csv.stringify(csvData, { header: true });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=photos_export.csv');
      return res.send(csvOutput);
    } else {
      // Default JSON format
      return res.status(200).json(
        successResponse('Photos exported successfully', {
          count: processedPhotos.length,
          photos: processedPhotos,
          metadata: {
            exported_at: new Date(),
            format: 'json',
            filters: {
              start_date,
              end_date,
              category_id,
              author_id,
              include_files
            }
          }
        })
      );
    }
  } catch (error) {
    console.error('Admin export photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to export photos', error)
    );
  }
};

// ==================== OTHER MISSING CONTROLLERS ====================

/**
 * Get photos by tag
 */
export const getPhotosByTag = async (req, res) => {
  try {
    const { tagId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const tagIdNum = parseInt(tagId);
    if (isNaN(tagIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid tag ID')
      );
    }

    // Verify tag exists
    const tag = await Prisma.pam_tags.findUnique({
      where: { tag_id: tagIdNum }
    });

    if (!tag) {
      return res.status(404).json(
        errorResponse('Tag not found')
      );
    }

    // Get photo IDs with this tag
    const photoTags = await Prisma.pam_photo_tags.findMany({
      where: { tag_id: tagIdNum },
      select: { photo_id: true },
      skip,
      take: limit
    });

    const photoIds = photoTags.map(pt => pt.photo_id);

    // Get total count
    const totalRecords = await Prisma.pam_photo_tags.count({
      where: { tag_id: tagIdNum }
    });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where: {
        photo_id: {
          in: photoIds.map(id => BigInt(id))
        },
        is_active: 1,
        is_trash: 0
      },
      include: {
        category: { select: { name: true } },
        author: { select: { firstname: true, lastname: true } }
      }
    });

    // Process results
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description?.substring(0, 150) + (photo.description?.length > 150 ? '...' : ''),
          category_name: photo.category?.name,
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          photography_time: photo.photography_time,
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: {
          tag: {
            id: tag.tag_id,
            name: tag.photo_tag,
            slug: tag.photo_slug
          },
          photos: results
        },
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Get photos by tag error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by tag', error)
    );
  }
};

/**
 * Get photos by location
 */
export const getPhotosByLocation = async (req, res) => {
  try {
    const { locationType, locationId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const locationIdNum = parseInt(locationId);
    if (isNaN(locationIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid location ID')
      );
    }

    // Build where clause based on location type
    const where = {
      is_active: 1,
      is_trash: 0
    };

    switch (locationType) {
      case 'country':
        where.country_id = locationIdNum;
        break;
      case 'state':
        where.state_id = locationIdNum;
        break;
      case 'city':
        where.city_id = locationIdNum;
        break;
      default:
        return res.status(400).json(
          errorResponse('Invalid location type. Use: country, state, or city')
        );
    }

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy: { photo_id: 'desc' },
      skip,
      take: limit,
      include: {
        category: { select: { name: true } },
        author: { select: { firstname: true, lastname: true } }
      }
    });

    // Process results
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description?.substring(0, 150) + (photo.description?.length > 150 ? '...' : ''),
          category_name: photo.category?.name,
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          photography_time: photo.photography_time,
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: {
          location_type: locationType,
          location_id: locationIdNum,
          photos: results
        },
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );
  } catch (error) {
    console.error('Get photos by location error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by location', error)
    );
  }
};

/**
 * Update photo file details
 */
export const updatePhotoFile = async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);
    const fileIdNum = parseInt(fileId);

    if (isNaN(photoId) || isNaN(fileIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }

    const { alt_text, caption, sequence } = req.body;

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check permissions
    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to update this file')
      );
    }

    // Check if file exists and belongs to photo
    const existingFile = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileIdNum,
        photo_id: photoId,
        is_trash: 'N'
      }
    });

    if (!existingFile) {
      return res.status(404).json(
        errorResponse('File not found')
      );
    }

    // Build update data
    const updateData = {
      updated_by: String(userId),
      updated_on: new Date()
    };

    if (alt_text !== undefined) updateData.alt_text = alt_text;
    if (caption !== undefined) updateData.caption = caption;
    if (sequence !== undefined) updateData.sequence = parseInt(sequence);

    // Update file
    const updatedFile = await Prisma.pam_photos_files.update({
      where: { file_id: fileIdNum },
      data: updateData
    });

    // Update photo updated_at
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        updated_at: new Date(),
        updated_by: userId
      }
    });

    return res.status(200).json(
      successResponse('File updated successfully', {
        photo_id: photoId,
        file_id: fileIdNum,
        filename: updatedFile.Image_Name,
        updated_fields: Object.keys(updateData).filter(key => key !== 'updated_by' && key !== 'updated_on')
      })
    );
  } catch (error) {
    console.error('Update photo file error:', error);
    return res.status(500).json(
      errorResponse('Failed to update photo file', error)
    );
  }
};

/**
 * Get photo file details
 */
export const getPhotoFileDetails = async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const photoId = parseInt(id);
    const fileIdNum = parseInt(fileId);

    if (isNaN(photoId) || isNaN(fileIdNum)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID or file ID')
      );
    }

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      select: { is_active: true, is_trash: true, author_id: true }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check permissions
    const isOwner = req.user?.id === existingPhoto.author_id;
    const isAdmin = req.user?.role === 'admin';
    const isPublic = existingPhoto.is_active === 1 && existingPhoto.is_trash === 0;

    if (!isPublic && !isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('Access denied')
      );
    }

    // Get file details
    const file = await Prisma.pam_photos_files.findFirst({
      where: {
        file_id: fileIdNum,
        photo_id: photoId,
        is_trash: 'N'
      }
    });

    if (!file) {
      return res.status(404).json(
        errorResponse('File not found')
      );
    }

    const fileDetails = {
      ...file,
      file_id: file.file_id.toString(),
      url: `${file.dir_path}/${file.Image_Name}`,
      thumbnail_url: file.dir_path.includes('400')
        ? `${file.dir_path}/${file.Image_Name}`
        : `${file.dir_path.replace('/uploads/', '/uploads/400/')}/${file.Image_Name}`,
      metadata: {
        width: file.Width,
        height: file.Height,
        orientation: file.orientation,
        size: file.file_size,
        format: file.file_ext,
        uploaded_at: file.entered_on
      }
    };

    return res.status(200).json(
      successResponse('File details retrieved successfully', fileDetails)
    );
  } catch (error) {
    console.error('Get photo file details error:', error);
    return res.status(500).json(
      errorResponse('Failed to get file details', error)
    );
  }
};

// Add other stub implementations for remaining functions
// export const updatePhotoFile = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const getPhotoFileDetails = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const updatePhotoMetadata = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const adminBulkUpdatePhotos = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const adminBulkDeletePhotos = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const adminExportPhotos = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const getPhotoTrends = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const recordPhotoView = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const recordPhotoDownload = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const getPhotoInteractions = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const validatePhotoSlug = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const generatePhotoSlug = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const duplicatePhoto = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

// export const mergePhotos = async (req, res) => {
//   return res.status(501).json(
//     errorResponse('Function not implemented yet')
//   );
// };

/**
 * Alias for getPhotoById (used as getPhotoDetails in routes)
 */
export const getPhotoDetails = async (req, res) => {
  return getPhotoById(req, res);
};

/**
 * Alias for getPhotosByCategory (used as getPhotosBySubcategory in routes)
 */
export const getPhotosBySubcategory = async (req, res) => {
  return getPhotosByCategory(req, res);
};

/**
 * Get user photos (alias for getMyPhotos)
 */
export const getUserPhotos = async (req, res) => {
  return getMyPhotos(req, res);
};

/**
 * Permanently delete photo (admin function)
 */
export const permanentlyDeletePhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Only admin can permanently delete
    if (req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('Admin access required for permanent deletion')
      );
    }

    // Check if photo exists
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Use transaction to delete all related data
    await Prisma.$transaction(async (tx) => {
      // Delete photo tags
      await tx.pam_photo_tags.deleteMany({
        where: { photo_id: photoId }
      });

      // Delete photo files
      await tx.pam_photos_files.deleteMany({
        where: { photo_id: photoId }
      });

      // Delete photo views
      await tx.pam_photo_views.deleteMany({
        where: { photo_id: photoId }
      });

      // Delete photo downloads
      await tx.pam_photo_downloads.deleteMany({
        where: { photo_id: photoId }
      });

      // Delete the photo
      await tx.pam_photos.delete({
        where: { photo_id: BigInt(photoId) }
      });
    });

    // Log activity
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user.username,
        user_type: 'admin',
        activity_type: 'delete',
        module: 'photos',
        action: 'permanent_delete_photo',
        message: `Permanently deleted photo: "${existingPhoto.photo_title}"`,
        status: 'success',
        severity: 'critical',
        ip_address: req.ip,
        resource_name: existingPhoto.photo_title,
        created_at: new Date()
      }
    });

    return res.status(200).json(
      successResponse('Photo permanently deleted successfully', {
        photo_id: photoId,
        title: existingPhoto.photo_title
      })
    );
  } catch (error) {
    console.error('Permanently delete photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to permanently delete photo', error)
    );
  }
};

/**
 * Update photo metadata (specific fields like EXIF, tags, etc.)
 */
export const updatePhotoMetadata = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    const { metadata_fields } = req.body;

    if (!metadata_fields || typeof metadata_fields !== 'object') {
      return res.status(400).json(
        errorResponse('metadata_fields object is required')
      );
    }

    // Check if photo exists and user owns it
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to update this photo')
      );
    }

    // Build update data for specific metadata fields
    const updateData = {
      updated_at: new Date(),
      updated_by: userId
    };

    // Add allowed metadata fields
    const allowedFields = ['photo_tags', 'source_name', 'credit', 'other_credit'];

    for (const field of allowedFields) {
      if (metadata_fields[field] !== undefined) {
        updateData[field] = metadata_fields[field];
      }
    }

    // Update photo
    const updatedPhoto = await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: updateData
    });

    return res.status(200).json(
      successResponse('Photo metadata updated successfully', {
        photo_id: photoId,
        updated_fields: Object.keys(metadata_fields),
        updated_at: updatedPhoto.updated_at
      })
    );
  } catch (error) {
    console.error('Update photo metadata error:', error);
    return res.status(500).json(
      errorResponse('Failed to update photo metadata', error)
    );
  }
};

/**
 * Get recent photos (alias for popular photos with time filter)
 */
export const getRecentPhotos = async (req, res) => {
  try {
    // Set period to week for recent photos
    req.query.period = 'week';
    return getPopularPhotos(req, res);
  } catch (error) {
    console.error('Get recent photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch recent photos', error)
    );
  }
};

/**
 * Get photo trends (more detailed than popular photos)
 */
export const getPhotoTrends = async (req, res) => {
  try {
    const { period = 'month', limit = 10 } = req.query;

    // Get trend data: photos with most growth in views
    const trends = await Prisma.$queryRaw`
      SELECT 
        p.photo_id,
        p.photo_title,
        COUNT(DISTINCT CASE 
          WHEN pv.viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) 
          THEN pv.view_id 
        END) as views_7d,
        COUNT(DISTINCT CASE 
          WHEN pv.viewed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) 
          THEN pv.view_id 
        END) as views_30d,
        COUNT(DISTINCT pv.view_id) as views_total,
        p.created_at
      FROM pam_photos p
      LEFT JOIN pam_photo_views pv ON p.photo_id = pv.photo_id
      WHERE p.is_active = 1 AND p.is_trash = 0
      GROUP BY p.photo_id, p.photo_title, p.created_at
      ORDER BY views_7d DESC
      LIMIT ${parseInt(limit)}
    `;

    // Get photo details
    const trendsWithDetails = await Promise.all(
      trends.map(async (trend) => {
        const photo = await Prisma.pam_photos.findUnique({
          where: { photo_id: BigInt(trend.photo_id) },
          include: {
            author: {
              select: {
                username: true,
                firstname: true,
                lastname: true
              }
            },
            category: {
              select: {
                name: true
              }
            }
          }
        });

        if (!photo) return null;

        // Get first file for thumbnail
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: trend.photo_id,
            is_trash: 'N'
          }
        });

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(Number(photo.photo_id).toString()).toString('base64'),
          photo_title: photo.photo_title,
          author_name: `${photo.author?.firstname} ${photo.author?.lastname}`,
          category_name: photo.category?.name,
          trend_data: {
            views_7d: Number(trend.views_7d),
            views_30d: Number(trend.views_30d),
            views_total: Number(trend.views_total),
            growth_rate: trend.views_30d > 0
              ? ((trend.views_7d / trend.views_30d) * 100).toFixed(2)
              : 'N/A'
          },
          thumbnail: firstFile ? `${firstFile.dir_path}/${firstFile.Image_Name}` : null
        };
      })
    );

    const filteredTrends = trendsWithDetails.filter(trend => trend !== null);

    return res.status(200).json(
      successResponse('Photo trends retrieved', {
        period,
        trends: filteredTrends
      })
    );
  } catch (error) {
    console.error('Get photo trends error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo trends', error)
    );
  }
};

/**
 * Record photo view
 */
export const recordPhotoView = async (req, res) => {
  try {
    const { id } = req.params;
    const photoId = parseInt(id);
    const userId = req.user?.id || null;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists and is active
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      select: { is_active: true, is_trash: true }
    });

    if (!photo || photo.is_active !== 1 || photo.is_trash !== 0) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Record view
    await Prisma.pam_photo_views.create({
      data: {
        photo_id: photoId,
        user_id: userId,
        viewed_at: new Date(),
        ip_address: ipAddress,
        user_agent: req.headers['user-agent'] || '',
        referrer: req.headers['referer'] || ''
      }
    });

    return res.status(200).json(
      successResponse('View recorded')
    );
  } catch (error) {
    console.error('Record photo view error:', error);
    // Don't fail the request if view recording fails
    return res.status(200).json(
      successResponse('View recorded')
    );
  }
};

/**
 * Record photo download
 */
export const recordPhotoDownload = async (req, res) => {
  console.log('recordPhotoDownload~~~~~~ +1');
  try {
    const { eid, pid } = req.params;
    const photoId = parseInt(eid);
    const file_id = parseInt(pid);
    const userId = req.user?.id || null;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    //const { file_id, resolution, format } = req.body; 
    // console.log( photoId, file_id,  userId,  req.body); 
    //     recordPhotoDownload~~~~~~
    // 167304 208080 53 {
    //   timestamp: '2026-02-01T09:06:03.646Z',
    //   user_id: 53,
    //   action: 'download',
    //   file_name: '39_20251222142158.jpg'
    // }
    // { is_active: 1, is_trash: 0, author_id: 50 }

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists and is active
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      select: { is_active: true, is_trash: true, author_id: true }
    });
    //console.log( photo.is_active, photo.is_trash, photo.author_id);

    if (!photo || photo.is_active !== 1 || photo.is_trash !== 0) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    const updatedPhoto = await Prisma.pam_photos.update({
      where: {
        photo_id: BigInt(photoId)
      },
      data: {
        download: {
          increment: 1
        }
      }
    });
    // console.log('Updated photo:', JSON.stringify(serializeBigInt(updatedPhoto), null, 2));
    // console.log('Photo ID:', updatedPhoto.photo_id);
    // console.log('New download count:', updatedPhoto.download);
    // console.log('Updated at:', updatedPhoto.updated_on);
    // Log download as activity instead of using pam_photo_downloads
    await Prisma.pam_activities.create({
      data: {
        user_id: userId,
        user_name: req.user?.username || 'guest',
        user_type: 'user',
        activity_type: 'download',
        module: 'photos',
        action: 'photo_download',
        message: `Downloaded photo ID: ${photoId}`,
        status: 'success',
        severity: 'info',
        ip_address: ipAddress,
        resource_id: parseInt(photoId),
        resource_name: `Photo ${photoId}`,
        created_at: new Date(),
        activity_code: 'DNP1001'
      }
    });


    return res.json({
      success: true,
      message: 'Download count incremented',
      downloadCount: updatedPhoto.download
    });

    /*
    // Check permissions (user can only download their own or public photos)
    if (photo.author_id !== userId && req.admin?.role !== 'admin') {
      // Check if photo is purchasable or free
      const photoDetails = await Prisma.pam_photos.findUnique({
        where: { photo_id: BigInt(photoId) },
        select: { price: true }
      });
      // console.log(  "photoDetails", photoDetails);
      if (photoDetails?.price > 0) {
        // Check if user has purchased this photo
        const purchase = await Prisma.pam_photo_purchases.findFirst({
          where: {
            photo_id: photoId,
            user_id: userId,
            status: 'completed'
          }
        });

        if (!purchase) {
          return res.status(403).json(
            errorResponse('Purchase required to download this photo')
          );
        }
      }
    }

    // Record download
    await Prisma.pam_photo_downloads.create({
      data: {
        photo_id: photoId,
        user_id: userId,
        downloaded_at: new Date(),
        ip_address: ipAddress,
        file_id: file_id ? parseInt(file_id) : null,
        resolution: resolution || 'original',
        format: format || 'original',
        user_agent: req.headers['user-agent'] || ''
      }
    });

    return res.status(200).json(
      successResponse('Download recorded', {
        photo_id: photoId,
        timestamp: new Date()
      })
    );*/
  } catch (error) {
    console.error('Record photo download error:', error);
    return res.status(500).json(
      errorResponse('Failed to record download', error)
    );
  }
};

/**
 * Get photo interactions (views, downloads, likes, etc.)
 */
export const getPhotoInteractions = async (req, res) => {
  try {
    const { id } = req.params;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) },
      select: { is_active: true, is_trash: true, author_id: true }
    });

    if (!photo) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    // Check permissions
    const isOwner = req.user?.id === photo.author_id;
    const isAdmin = req.user?.role === 'admin';
    const isPublic = photo.is_active === 1 && photo.is_trash === 0;

    if (!isPublic && !isOwner && !isAdmin) {
      return res.status(403).json(
        errorResponse('Access denied')
      );
    }

    // Get interaction statistics
    const [views, downloads, viewTimeline, downloadTimeline] = await Promise.all([
      // Total views
      Prisma.pam_photo_views.count({
        where: { photo_id: photoId }
      }),
      // Total downloads
      Prisma.pam_photo_downloads.count({
        where: { photo_id: photoId }
      }),
      // View timeline (last 30 days)
      Prisma.$queryRaw`
        SELECT 
          DATE(viewed_at) as date,
          COUNT(*) as count
        FROM pam_photo_views
        WHERE photo_id = ${photoId}
          AND viewed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(viewed_at)
        ORDER BY date
      `,
      // Download timeline (last 30 days)
      Prisma.$queryRaw`
        SELECT 
          DATE(downloaded_at) as date,
          COUNT(*) as count
        FROM pam_photo_downloads
        WHERE photo_id = ${photoId}
          AND downloaded_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(downloaded_at)
        ORDER BY date
      `
    ]);

    return res.status(200).json(
      successResponse('Photo interactions retrieved', {
        photo_id: photoId,
        statistics: {
          total_views: Number(views),
          total_downloads: Number(downloads),
          conversion_rate: views > 0 ? ((downloads / views) * 100).toFixed(2) : 0
        },
        timeline: {
          views: viewTimeline,
          downloads: downloadTimeline
        }
      })
    );
  } catch (error) {
    console.error('Get photo interactions error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photo interactions', error)
    );
  }
};

/**
 * Validate photo slug (check if slug is available)
 */
export const validatePhotoSlug = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || slug.trim() === '') {
      return res.status(400).json(
        errorResponse('Slug is required')
      );
    }

    // Check if slug exists in photos
    const existingPhoto = await Prisma.pam_photos.findFirst({
      where: {
        slug: slug
      },
      select: {
        photo_id: true,
        photo_title: true
      }
    });

    return res.status(200).json(
      successResponse('Slug validation complete', {
        slug,
        available: !existingPhoto,
        exists: !!existingPhoto,
        existing_photo: existingPhoto ? {
          id: existingPhoto.photo_id,
          title: existingPhoto.photo_title
        } : null
      })
    );
  } catch (error) {
    console.error('Validate photo slug error:', error);
    return res.status(500).json(
      errorResponse('Failed to validate slug', error)
    );
  }
};

/**
 * Generate photo slug from title
 */
export const generatePhotoSlug = async (req, res) => {
  try {
    const { title } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json(
        errorResponse('Title is required')
      );
    }

    // Generate slug from title
    const baseSlug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    let slug = baseSlug;
    let counter = 1;

    // Check if slug exists, add counter if needed
    while (true) {
      const existing = await Prisma.pam_photos.findFirst({
        where: { slug: slug }
      });

      if (!existing) {
        break;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return res.status(200).json(
      successResponse('Slug generated', {
        title,
        generated_slug: slug,
        base_slug: baseSlug
      })
    );
  } catch (error) {
    console.error('Generate photo slug error:', error);
    return res.status(500).json(
      errorResponse('Failed to generate slug', error)
    );
  }
};

/**
 * Duplicate photo
 */
export const duplicatePhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const photoId = parseInt(id);

    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }

    // Check if photo exists and user has permission
    const existingPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(photoId) }
    });

    if (!existingPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }

    if (existingPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to duplicate this photo')
      );
    }

    // Use transaction to duplicate photo and related data
    const duplicated = await Prisma.$transaction(async (tx) => {
      // Create new photo record
      const newPhoto = await tx.pam_photos.create({
        data: {
          photo_title: `${existingPhoto.photo_title} (Copy)`,
          event_name: existingPhoto.event_name,
          description: existingPhoto.description,
          photo_tags: existingPhoto.photo_tags,
          category_id: existingPhoto.category_id,
          sub_category_id: existingPhoto.sub_category_id,
          country_id: existingPhoto.country_id,
          state_id: existingPhoto.state_id,
          city_id: existingPhoto.city_id,
          author_id: userId, // Keep the same author or use current user?
          media_type: existingPhoto.media_type,
          source_name: existingPhoto.source_name,
          credit: existingPhoto.credit,
          other_credit: existingPhoto.other_credit,
          price: existingPhoto.price,
          photography_time: existingPhoto.photography_time,
          enter_by: userId,
          updated_by: userId,
          is_active: 0, // Set as inactive by default
          is_trash: 0,
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      const newPhotoId = Number(newPhoto.photo_id);

      // Duplicate tags
      const existingTags = await tx.pam_photo_tags.findMany({
        where: { photo_id: photoId }
      });

      if (existingTags.length > 0) {
        await tx.pam_photo_tags.createMany({
          data: existingTags.map(tag => ({
            photo_id: newPhotoId,
            tag_id: tag.tag_id
          }))
        });
      }

      return {
        photo: newPhoto,
        tags_duplicated: existingTags.length
      };
    });

    return res.status(201).json(
      successResponse('Photo duplicated successfully', {
        original_photo_id: photoId,
        new_photo_id: duplicated.photo.photo_id,
        new_photo_title: duplicated.photo.photo_title,
        tags_duplicated: duplicated.tags_duplicated
      })
    );
  } catch (error) {
    console.error('Duplicate photo error:', error);
    return res.status(500).json(
      errorResponse('Failed to duplicate photo', error)
    );
  }
};

/**
 * Merge photos (combine multiple photos into one)
 */
export const mergePhotos = async (req, res) => {
  try {
    const userId = req.user.id;
    const { source_photo_ids, target_photo_id, merge_options = {} } = req.body;

    if (!source_photo_ids || !Array.isArray(source_photo_ids) || source_photo_ids.length === 0) {
      return res.status(400).json(
        errorResponse('source_photo_ids array is required')
      );
    }

    if (!target_photo_id) {
      return res.status(400).json(
        errorResponse('target_photo_id is required')
      );
    }

    // Convert IDs to numbers
    const sourceIds = source_photo_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    const targetId = parseInt(target_photo_id);

    if (sourceIds.length === 0 || isNaN(targetId)) {
      return res.status(400).json(
        errorResponse('Invalid photo IDs provided')
      );
    }

    // Check if target photo exists and user has permission
    const targetPhoto = await Prisma.pam_photos.findUnique({
      where: { photo_id: BigInt(targetId) }
    });

    if (!targetPhoto) {
      return res.status(404).json(
        errorResponse('Target photo not found')
      );
    }

    if (targetPhoto.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(
        errorResponse('You do not have permission to modify the target photo')
      );
    }

    // Check all source photos
    const sourcePhotos = await Prisma.pam_photos.findMany({
      where: {
        photo_id: {
          in: sourceIds.map(id => BigInt(id))
        }
      }
    });

    if (sourcePhotos.length !== sourceIds.length) {
      return res.status(404).json(
        errorResponse('Some source photos not found')
      );
    }

    // Verify user has permission for all source photos
    for (const sourcePhoto of sourcePhotos) {
      if (sourcePhoto.author_id !== userId && req.user.role !== 'admin') {
        return res.status(403).json(
          errorResponse(`You do not have permission to merge photo: ${sourcePhoto.photo_title}`)
        );
      }
    }

    // Merge photos (move files from source to target, then delete sources)
    const result = await Prisma.$transaction(async (tx) => {
      let filesMoved = 0;
      let tagsMoved = 0;

      // For each source photo
      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue; // Skip if source is target

        // Move files from source to target
        const movedFiles = await tx.pam_photos_files.updateMany({
          where: { photo_id: sourceId },
          data: { photo_id: targetId }
        });
        filesMoved += movedFiles.count;

        // Move tags from source to target
        const sourceTags = await tx.pam_photo_tags.findMany({
          where: { photo_id: sourceId }
        });

        for (const tag of sourceTags) {
          // Check if tag already exists on target
          const existingTag = await tx.pam_photo_tags.findFirst({
            where: {
              photo_id: targetId,
              tag_id: tag.tag_id
            }
          });

          if (!existingTag) {
            await tx.pam_photo_tags.create({
              data: {
                photo_id: targetId,
                tag_id: tag.tag_id
              }
            });
            tagsMoved++;
          }
        }

        // Delete source photo
        await tx.pam_photos.delete({
          where: { photo_id: BigInt(sourceId) }
        });
      }

      // Update target photo
      const updatedTarget = await tx.pam_photos.update({
        where: { photo_id: BigInt(targetId) },
        data: {
          updated_at: new Date(),
          updated_by: userId
        }
      });

      return {
        target_photo: updatedTarget,
        files_moved: filesMoved,
        tags_moved: tagsMoved,
        sources_deleted: sourceIds.filter(id => id !== targetId).length
      };
    });

    return res.status(200).json(
      successResponse('Photos merged successfully', {
        target_photo_id: targetId,
        target_photo_title: targetPhoto.photo_title,
        ...result
      })
    );
  } catch (error) {
    console.error('Merge photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to merge photos', error)
    );
  }
};

export const editPhoto = async (req, res) => {
  console.log("=== I AM IN editPhoto ===")
  try {
    const photoId = parseInt(req.params.id);

    if (!photoId || isNaN(photoId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid photo ID'
      });
    }

    // Get photo basic data
    const photo = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: photoId,
        is_trash: 0
      },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true,
            status: true
          }
        },
        sub_category: {
          select: {
            sub_category_id: true,
            name: true,
            slug: true,
            status: true
          }
        },
        country: {
          select: {
            id: true,
            name: true,
          }
        },
        state: {
          select: {
            id: true,
            name: true,
            status: true
          }
        },
        city: {
          select: {
            id: true,
            name: true,
            status: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true,
            email: true
          }
        }
      }
    });

    if (!photo) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found'
      });
    }

    // Get files SEPARATELY - using the same photoId
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        photo_id: photoId, // This should match the type in database
        //is_trash: 'N'
      },
      orderBy: {
        file_id: 'asc'
      }
    });

    // console.log('Files found:', files.length);

    // Get all photo_tag_ids and tag_ids for this photo
    // const photoTagRelations = await Prisma.pam_photo_tags.findMany({
    //   where: {
    //     photo_id: photoId
    //   },
    //   select: {
    //     photo_tag_id: true,
    //     tag_id: true,
    //     photo_id: true
    //   }
    // });

    // console.log("Photo Tag Relations:", photoTagRelations);

    // // Get all tag details separately
    // if (photoTagRelations.length > 0) {
    //   const tagIds = photoTagRelations.map(ptr => ptr.tag_id);

    //   const tags = await Prisma.pam_tags.findMany({
    //     where: {
    //       tag_id: {
    //         in: tagIds
    //       }
    //     },
    //     select: {
    //       tag_id: true,
    //       photo_tag: true,
    //       photo_slug: true
    //     }
    //   });

    //   console.log("Tags from pam_tags:", tags);

    //   // Combine the data
    //   const combinedTags = photoTagRelations.map(ptr => {
    //     const tagDetail = tags.find(t => t.tag_id === ptr.tag_id);
    //     return {
    //       photo_tag_id: ptr.photo_tag_id.toString(),
    //       tag_id: ptr.tag_id.toString(),
    //       photo_id: ptr.photo_id.toString(),
    //       photo_tag: tagDetail ? tagDetail.photo_tag : 'Unknown',
    //       photo_slug: tagDetail ? tagDetail.photo_slug : 'unknown'
    //     };
    //   });

    //   console.log("Combined Tags:", combinedTags);
    // }

    // Get all photo_tag_ids and tag_ids for this photo
    const photoTagRelations = await Prisma.pam_photo_tags.findMany({
      where: {
        photo_id: photoId
      },
      select: {
        photo_tag_id: true,
        tag_id: true,
        photo_id: true
      }
    });

    console.log("Photo Tag Relations:", photoTagRelations);

    let combinedTags = [];
    // Get all tag details separately only if there are photo tag relations
    if (photoTagRelations && photoTagRelations.length > 0) {
      const tagIds = photoTagRelations.map(ptr => ptr.tag_id);
      const tags = await Prisma.pam_tags.findMany({
        where: {
          tag_id: {
            in: tagIds
          }
        },
        select: {
          tag_id: true,
          photo_tag: true,
          photo_slug: true
        }
      });
      console.log("Tags from pam_tags:", tags);
      // Combine the data
      combinedTags = photoTagRelations.map(ptr => {
        const tagDetail = tags.find(t => t.tag_id === ptr.tag_id);
        return {
          photo_tag_id: ptr.photo_tag_id ? ptr.photo_tag_id.toString() : '',
          tag_id: ptr.tag_id ? ptr.tag_id.toString() : '',
          photo_id: ptr.photo_id ? ptr.photo_id.toString() : '',
          photo_tag: tagDetail ? tagDetail.photo_tag : 'Unknown',
          photo_slug: tagDetail ? tagDetail.photo_slug : 'unknown'
        };
      });
      console.log("Combined Tags:", combinedTags);
    }

    // Process files
    const processedFiles = files.map(file => {
      let orientation = file.orientation || 'unknown';

      if ((!orientation || orientation === 'unknown') && file.Width && file.Height) {
        const width = file.Width || 0;
        const height = file.Height || 0;
        if (width > 0 && height > 0) {
          const ratio = width / height;
          if (ratio > 1.1) orientation = 'horizontal';
          else if (ratio < 0.9) orientation = 'vertical';
          else orientation = 'square';
        }
      }

      return {
        file_id: file.file_id.toString(),
        photo_id: file.photo_id.toString(),
        dir_path: file.dir_path,
        Image_Name: file.Image_Name,
        original_image_name: file.original_image_name,
        file_ext: file.file_ext,
        file_size: file.file_size,
        width: file.Width,
        height: file.Height,
        orientation: orientation,
        type: file.type,
        source: file.source,
        reference: file.reference,
        is_trash: file.is_trash,
        is_migrated: file.isMigrat === 1,
        migrated_file_path: file.migratedFilePath,
        migrated_file_name: file.migratedFileName,
        created_at: file.date_created,
        updated_at: file.updated_on,
        enter_by: file.enter_by,
        updated_by: file.updated_by,
        image_url: file.dir_path && file.Image_Name
          ? `${file.dir_path}/${file.Image_Name}`
          : null,
        thumbnail_url: file.dir_path && file.Image_Name
          ? `${file.dir_path}/${file.Image_Name}`
          : null
      };
    });

    // Prepare response
    const response = {
      status: 'success',
      data: {
        // Photo data
        id: photo.photo_id,
        photo_id: photo.photo_id,
        photo_title: photo.photo_title || '',
        event_name: photo.event_name || '',
        description: photo.description || '',
        photo_tags: photo.photo_tags || '',
        source_name: photo.source_name || '',
        credit: photo.credit || 0,
        other_credit: photo.other_credit || '',
        max_download: photo.max_download || 0,
        download: photo.download || 0,
        price: photo.price || 0,
        media_type: photo.media_type || '',
        photography_time: photo.photography_time,
        entered_on: photo.entered_on,
        updated_on: photo.updated_on,
        enter_by: photo.enter_by || 0,
        updated_by: photo.updated_by || 0,
        author_id: photo.author_id || 0,
        category_id: photo.category_id || 0,
        sub_category_id: photo.sub_category_id || 0,
        country_id: photo.country_id || 0,
        state_id: photo.state_id || 0,
        city_id: photo.city_id || 0,

        // Related data
        category: photo.category,
        sub_category: photo.sub_category,
        country: photo.country,
        state: photo.state,
        city: photo.city,
        author: photo.user,

        // Status
        is_active: photo.is_active === 1,
        is_trash: photo.is_trash === 1,
        status: photo.is_active,

        // Files and tags
        files: processedFiles,
        total_files: processedFiles.length,
        cover_image: processedFiles[0] || null,
        image_url: processedFiles[0]?.image_url || null,

        // tags: tags.map(pt => ({
        //   id: pt.tag?.tag_id?.toString() || '',
        //   tag_id: pt.tag?.tag_id?.toString() || '',
        //   name: pt.tag?.photo_tag || '',
        //   slug: pt.tag?.photo_slug || ''
        // })),

        tags: combinedTags.map(tag => ({
          id: tag.tag_id || '',
          tag_id: tag.tag_id || '',
          name: tag.photo_tag || '',
          slug: tag.photo_slug || ''
        })),

        // Form data
        form_data: {
          title: photo.photo_title || '',
          event_name: photo.event_name || '',
          description: photo.description || '',
          photo_tags: photo.photo_tags || '',
          author: photo.user ? `${photo.user.firstname || ''} ${photo.user.lastname || ''}`.trim() : '',
          photo_credit_id: photo.author_id?.toString() || '',
          category_id: photo.category_id?.toString() || '',
          sub_category_id: photo.sub_category_id?.toString() || '',
          country_id: photo.country_id?.toString() || '',
          state_id: photo.state_id?.toString() || '',
          city_id: photo.city_id?.toString() || '',
          source: photo.source_name || '',
          max_downloads: photo.max_download || 0,
          //tags: tags.map(pt => pt.tag?.photo_tag || '').filter(tag => tag),
          image_url: processedFiles[0]?.image_url || '',
          status: photo.is_active,
          photography_time: photo.photography_time ?
            new Date(photo.photography_time).toISOString().split('T')[0] + "T00:00" :
            new Date().toISOString().split('T')[0] + "T00:00"
        }
      }
    };

    res.json(serializeBigInt(response));

  } catch (error) {
    console.error('Error fetching photo details:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch photo details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export const updateCoverPhoto = async (req, res) => {
  console.log("~~~ I AM IN updateCoverPhoto ~~~");
  try {
    const { id: photoId } = req.params;
    const { file_id } = req.body;
    const adminId = req.admin.admin_id;

    // Validate input
    if (!file_id) {
      return res.status(400).json({
        status: "error",
        message: "File ID is required"
      });
    }

    // Start a transaction
    const result = await Prisma.$transaction(async (tx) => {
      // 1. Verify the photo exists
      const photo = await tx.pam_photos.findUnique({
        where: { photo_id: BigInt(photoId) }
      });

      if (!photo) {
        throw new Error("Photo not found");
      }

      // 2. Verify the file exists and belongs to this photo
      const file = await tx.pam_photos_files.findFirst({
        where: {
          file_id: BigInt(file_id),
          photo_id: BigInt(photoId),
          is_trash: "N" // Only consider non-trashed files
        }
      });

      if (!file) {
        throw new Error("File not found or doesn't belong to this photo");
      }

      // 3. Reset all files' is_cover to false for this photo
      await tx.pam_photos_files.updateMany({
        where: {
          photo_id: BigInt(photoId),
          is_cover: true
        },
        data: {
          is_cover: false,
          updated_by: adminId.toString(),
          updated_on: new Date()
        }
      });

      // 4. Set the selected file as cover
      const updatedFile = await tx.pam_photos_files.update({
        where: { file_id: BigInt(file_id) },
        data: {
          is_cover: true,
          updated_by: adminId.toString(),
          updated_on: new Date()
        }
      });

      // 5. Update the photo record
      const updatedPhoto = await tx.pam_photos.update({
        where: { photo_id: BigInt(photoId) },
        data: {
          // Optionally update photo_title with cover image name
          photo_title: file.Image_Name || file.original_image_name || photo.photo_title,
          updated_by: adminId,
          updated_on: new Date()
        }
      });

      return { updatedFile, updatedPhoto };
    });

    res.json({
      status: "success",
      message: "Cover image updated successfully",
      data: {
        photo_id: photoId,
        file_id: file_id,
        is_cover: true,
        image_url: result.updatedFile.Image_Name || result.updatedFile.original_image_name
      }
    });

  } catch (error) {
    console.error("Set cover image error:", error);

    if (error.message.includes("not found")) {
      return res.status(404).json({
        status: "error",
        message: error.message
      });
    }

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message
    });
  }
}


/**
 * Get photos by category slug
 */
export const getPhotosByCategorySlug = async (req, res) => {
  console.log('Get photos by category slug only:', req.params.category_slug);

  try {
    const { category_slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Find category by slug
    const category = await Prisma.pam_category.findFirst({
      where: {
        slug: category_slug,
        status: 1
      }
    });

    if (!category) {
      return res.status(404).json(
        errorResponse('Category not found')
      );
    }

    // Build where clause
    const where = {
      category_id: category.category_id,
      //is_active: 1,
      //is_trash: 0
    };

    // Apply additional filters from query params
    const {
      search,
      orientation,
      dateRange,
      tags,
      sort_by = 'photography_time',
      sort_order = 'desc'
    } = req.query;

    // Search filter
    if (search) {
      where.OR = [
        { photo_title: { contains: search } },
        { description: { contains: search } },
        { event_name: { contains: search } }
      ];
    }

    // Tag filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      if (tagArray.length > 0) {
        where.AND = tagArray.map(tag => ({
          tags: {
            some: {
              tag: {
                photo_tag: { contains: tag }
              }
            }
          }
        }));
      }
    }

    // Date range filter
    if (dateRange && dateRange !== 'anytime') {
      const currentDate = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case '24h':
          startDate.setHours(currentDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(currentDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(currentDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(currentDate.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(currentDate.getFullYear() - 1);
          break;
      }

      //where.photography_time = { gte: startDate };
    }

    // Validate sort field
    const allowedSortFields = ['photo_id', 'photo_title', 'price', 'photography_time', 'entered_on'];
    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photography_time';
    const orderBy = { [sortBy]: sort_order === 'asc' ? 'asc' : 'desc' };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        sub_category: {
          select: {
            sub_category_id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true
          }
        },
        tags: {
          include: {
            tag: {
              select: {
                tag_id: true,
                photo_tag: true,
                photo_slug: true
              }
            }
          }
        }
      }
    });

    // Process photos with orientation filtering if needed
    let results = await processPhotosWithOrientation(photos, orientation, limit, skip);

    // If orientation filter was applied, we need to adjust pagination info
    let finalResults = results.results;
    let finalTotalRecords = results.orientation ? results.estimatedTotal : totalRecords;

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        results: finalResults,
        category: {
          id: category.category_id,
          name: category.name,
          slug: category.slug
        },
        pagination: {
          page,
          limit,
          totalRecords: finalTotalRecords,
          filteredCount: finalResults.length,
          totalPages: Math.ceil(finalTotalRecords / limit)
        }
      })
    );

  } catch (error) {
    console.error('Get photos by category slug error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by category', error)
    );
  }
};

/**
 * Get photos by subcategory slug
 */

export const getPhotosBySubcategorySlug = async (req, res) => {
  //console.log('getPhotosBySubcategorySlug >>>> :', req.params.subcategory_slug);
  try {
    const { category_slug, subcategory_slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log("WITH CAT & SUBCAT: ", category_slug, subcategory_slug);

    // Find subcategory by slug with category
    const subcategory = await Prisma.pam_sub_category.findFirst({
      where: {
        slug: subcategory_slug,
        status: 1,
        category: {
          slug: category_slug,
          status: 1
        }
      },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!subcategory) {
      return res.status(404).json(
        errorResponse('Subcategory not found')
      );
    }

    // Build where clause
    const where = {
      sub_category_id: subcategory.sub_category_id,
      is_active: 1,
      is_trash: 0
    };

    // Apply filters from query params
    const {
      search,
      tags,
      sort_by = 'photography_time',
      sort_order = 'desc'
    } = req.query;

    // Search filter
    if (search) {
      where.OR = [
        { photo_title: { contains: search } },
        { description: { contains: search } },
        { event_name: { contains: search } }
      ];
    }

    // Tag filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      if (tagArray.length > 0) {
        where.AND = tagArray.map(tag => ({
          tags: {
            some: {
              tag: {
                photo_tag: { contains: tag }
              }
            }
          }
        }));
      }
    }

    // Validate sort field
    const allowedSortFields = ['photo_id', 'photo_title', 'price', 'photography_time', 'entered_on'];
    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photography_time';
    const orderBy = { [sortBy]: sort_order === 'asc' ? 'asc' : 'desc' };

    // Get total count
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true
          }
        },
        tags: {
          include: {
            tag: {
              select: {
                tag_id: true,
                photo_tag: true,
                photo_slug: true
              }
            }
          }
        }
      }
    });

    // Process each photo to get file details
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get file count
        const fileCount = await Prisma.pam_photos_files.count({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          }
        });

        // Get first file (prefer cover image)
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: {
            photo_id: photoId,
            is_trash: 'N'
          },
          orderBy: {
            is_cover: 'desc'
          },
          select: {
            file_id: true,
            dir_path: true,
            Image_Name: true,
            Width: true,
            Height: true,
            isMigrat: true,
            migratedFilePath: true,
            migratedFileName: true,
            is_cover: true,
            dominant_color: true
          }
        });

        // Calculate orientation
        let orientation = null;
        if (firstFile?.Width && firstFile?.Height) {
          const ratio = firstFile.Width / firstFile.Height;
          if (ratio > 1.05) orientation = 'horizontal';
          else if (ratio < 0.95) orientation = 'vertical';
          else orientation = 'square';
        }

        // Construct image URL
        let imageUrl = null;
        if (firstFile) {
          if (firstFile.isMigrat === 1 && firstFile.migratedFilePath && firstFile.migratedFileName) {
            imageUrl = `${firstFile.migratedFilePath}${firstFile.migratedFileName}`;
          } else if (firstFile.dir_path && firstFile.Image_Name) {
            imageUrl = `${firstFile.dir_path}${firstFile.Image_Name}`;
          }
        }

        // Extract tags
        const photoTags = photo.tags?.map(pt => ({
          tag_id: pt.tag.tag_id,
          name: pt.tag.photo_tag,
          slug: pt.tag.photo_slug
        })) || [];

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          category_slug: photo.category?.slug,
          sub_category_id: photo.sub_category_id,
          sub_category_name: photo.sub_category?.name,
          sub_category_slug: photo.sub_category?.slug,
          price: photo.price,
          photography_time: photo.photography_time,
          datetime: new Date(photo.photography_time).toLocaleDateString('en-GB'),
          author_id: photo.author_id,
          author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
          entered_on: photo.entered_on,
          updated_on: photo.updated_on,
          num_files: fileCount,
          tags: photoTags,
          photos: firstFile ? {
            file_id: firstFile.file_id,
            Image_Name: firstFile.Image_Name,
            isMigrat: firstFile.isMigrat,
            dir_path: firstFile.dir_path,
            migratedFilePath: firstFile.migratedFilePath,
            migratedFileName: firstFile.migratedFileName,
            Width: firstFile.Width,
            Height: firstFile.Height,
            orientation: orientation,
            is_cover: firstFile.is_cover,
            dominant_color: firstFile.dominant_color,
            url: imageUrl
          } : null
        };
      })
    );

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        results: results,
        category: {
          id: subcategory.category.category_id,
          name: subcategory.category.name,
          slug: subcategory.category.slug
        },
        subcategory: {
          id: subcategory.sub_category_id,
          name: subcategory.name,
          slug: subcategory.slug
        },
        pagination: {
          page,
          limit,
          totalRecords,
          filteredCount: results.length,
          totalPages: Math.ceil(totalRecords / limit)
        }
      })
    );

  } catch (error) {
    console.error('Get photos by subcategory slug error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by subcategory', error)
    );
  }
};

export const getPhotosBySubcategorySlug22 = async (req, res) => {
  console.log('getPhotosBySubcategorySlug  >>>> :', req.params.subcategory_slug);

  try {
    const { category_slug, subcategory_slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log("WITH CAT & SUBCAT: ", category_slug, subcategory_slug)

    // Find subcategory by slug with category
    const subcategory = await Prisma.pam_sub_category.findFirst({
      where: {
        slug: subcategory_slug,
        status: 1,
        category: {
          slug: category_slug,
          status: 1
        }
      },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!subcategory) {
      return res.status(404).json(
        errorResponse('Subcategory not found')
      );
    }

    // Build where clause
    const where = {
      sub_category_id: subcategory.sub_category_id,
      is_active: 1,
      is_trash: 0
    };

    // Apply additional filters from query params
    const {
      search,
      orientation,
      dateRange,
      tags,
      sort_by = 'photography_time',
      sort_order = 'desc'
    } = req.query;

    // Search filter
    if (search) {
      where.OR = [
        { photo_title: { contains: search } },
        { description: { contains: search } },
        { event_name: { contains: search } }
      ];
    }

    // Tag filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      if (tagArray.length > 0) {
        where.AND = tagArray.map(tag => ({
          tags: {
            some: {
              tag: {
                photo_tag: { contains: tag }
              }
            }
          }
        }));
      }
    }

    // Date range filter
    if (dateRange && dateRange !== 'anytime') {
      const currentDate = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case '24h':
          startDate.setHours(currentDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(currentDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(currentDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(currentDate.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(currentDate.getFullYear() - 1);
          break;
      }

      //where.photography_time = { gte: startDate };
    }

    // Validate sort field
    const allowedSortFields = ['photo_id', 'photo_title', 'price', 'photography_time', 'entered_on'];
    const sortBy = allowedSortFields.includes(sort_by) ? sort_by : 'photography_time';
    const orderBy = { [sortBy]: sort_order === 'asc' ? 'asc' : 'desc' };
    const totalRecords = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true
          }
        },
        tags: {
          include: {
            tag: {
              select: {
                tag_id: true,
                photo_tag: true,
                photo_slug: true
              }
            }
          }
        }
      }
    });

    // Process photos with orientation filtering if needed
    let results = await processPhotosWithOrientation(photos, orientation, limit, skip);

    // If orientation filter was applied, we need to adjust pagination info
    let finalResults = results.results;
    let finalTotalRecords = results.orientation ? results.estimatedTotal : totalRecords;

    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        results: finalResults,
        category: {
          id: subcategory.category.category_id,
          name: subcategory.category.name,
          slug: subcategory.category.slug
        },
        subcategory: {
          id: subcategory.sub_category_id,
          name: subcategory.name,
          slug: subcategory.slug
        },
        pagination: {
          page,
          limit,
          totalRecords: finalTotalRecords,
          filteredCount: finalResults.length,
          totalPages: Math.ceil(finalTotalRecords / limit)
        }
      })
    );

  } catch (error) {
    console.error('Get photos by subcategory slug error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch photos by subcategory', error)
    );
  }
};

/**
 * Helper function to process photos with orientation filtering
 */
async function processPhotosWithOrientation(photos, orientationFilter, limit, skip) {
  if (!orientationFilter) {
    // No orientation filter - process all photos normally
    const results = await Promise.all(
      photos.map(async (photo) => {
        const photoId = Number(photo.photo_id);

        // Get file count
        const fileCount = await Prisma.pam_photos_files.count({
          where: { photo_id: photoId, is_trash: 'N' }
        });

        // Get first file (prefer cover image)
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: { photo_id: photoId, is_trash: 'N' },
          orderBy: { is_cover: 'desc' },
          select: {
            file_id: true,
            dir_path: true,
            Image_Name: true,
            Width: true,
            Height: true,
            isMigrat: true,
            migratedFilePath: true,
            migratedFileName: true,
            is_cover: true,
            dominant_color: true
          }
        });

        // Calculate orientation
        let calculatedOrientation = null;
        if (firstFile?.Width && firstFile?.Height) {
          const ratio = firstFile.Width / firstFile.Height;
          if (ratio > 1.05) calculatedOrientation = 'horizontal';
          else if (ratio < 0.95) calculatedOrientation = 'vertical';
          else calculatedOrientation = 'square';
        }

        // Construct image URL
        let imageUrl = null;
        if (firstFile) {
          if (firstFile.isMigrat === 1 && firstFile.migratedFilePath && firstFile.migratedFileName) {
            imageUrl = `${firstFile.migratedFilePath}${firstFile.migratedFileName}`;
          } else if (firstFile.dir_path && firstFile.Image_Name) {
            imageUrl = `${firstFile.dir_path}${firstFile.Image_Name}`;
          }
        }

        // Extract tags
        const photoTags = photo.tags?.map(pt => ({
          tag_id: pt.tag.tag_id,
          name: pt.tag.photo_tag,
          slug: pt.tag.photo_slug
        })) || [];

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          category_slug: photo.category?.slug,
          sub_category_id: photo.sub_category_id,
          sub_category_name: photo.sub_category?.name,
          sub_category_slug: photo.sub_category?.slug,
          price: photo.price,
          photography_time: photo.photography_time,
          datetime: new Date(photo.photography_time).toLocaleDateString('en-GB'),
          author_id: photo.author_id,
          author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
          entered_on: photo.entered_on,
          updated_on: photo.updated_on,
          num_files: fileCount,
          tags: photoTags,
          photos: firstFile ? {
            file_id: firstFile.file_id,
            Image_Name: firstFile.Image_Name,
            isMigrat: firstFile.isMigrat,
            dir_path: firstFile.dir_path,
            migratedFilePath: firstFile.migratedFilePath,
            migratedFileName: firstFile.migratedFileName,
            Width: firstFile.Width,
            Height: firstFile.Height,
            orientation: calculatedOrientation,
            is_cover: firstFile.is_cover,
            dominant_color: firstFile.dominant_color,
            url: imageUrl
          } : null
        };
      })
    );

    return { results, orientation: false };
  } else {
    // With orientation filter - fetch more and filter
    const normalizedOrientation = orientationFilter.toLowerCase();
    const fetchMultiplier = 5;
    const fetchLimit = limit * fetchMultiplier;

    // Get more photos than needed for orientation filtering
    const extendedPhotos = photos.length < fetchLimit ?
      await Prisma.pam_photos.findMany({
        where: {
          category_id: photos[0]?.category_id,
          sub_category_id: photos[0]?.sub_category_id,
          is_active: 1,
          is_trash: 0
        },
        orderBy: { photography_time: 'desc' },
        take: fetchLimit,
        include: {
          category: true,
          sub_category: true,
          user: true,
          tags: { include: { tag: true } }
        }
      }) : photos;

    // Process all photos and filter by orientation
    const processedItems = await Promise.all(
      extendedPhotos.map(async (photo) => {
        const firstFile = await Prisma.pam_photos_files.findFirst({
          where: { photo_id: Number(photo.photo_id), is_trash: 'N' },
          orderBy: { is_cover: 'desc' }
        });

        let orientation = null;
        if (firstFile?.Width && firstFile?.Height) {
          const ratio = firstFile.Width / firstFile.Height;
          if (ratio > 1.05) orientation = 'horizontal';
          else if (ratio < 0.95) orientation = 'vertical';
          else orientation = 'square';
        }

        return { photo, firstFile, orientation };
      })
    );

    // Filter by orientation
    const filteredItems = processedItems.filter(item =>
      item.orientation === normalizedOrientation
    );

    // Apply pagination
    const startIndex = Math.min(skip, filteredItems.length);
    const endIndex = Math.min(skip + limit, filteredItems.length);
    const paginatedItems = filteredItems.slice(startIndex, endIndex);

    // Format results
    const results = await Promise.all(
      paginatedItems.map(async ({ photo, firstFile, orientation }) => {
        const photoId = Number(photo.photo_id);
        const fileCount = await Prisma.pam_photos_files.count({
          where: { photo_id: photoId, is_trash: 'N' }
        });

        let imageUrl = null;
        if (firstFile) {
          if (firstFile.isMigrat === 1 && firstFile.migratedFilePath && firstFile.migratedFileName) {
            imageUrl = `${firstFile.migratedFilePath}${firstFile.migratedFileName}`;
          } else if (firstFile.dir_path && firstFile.Image_Name) {
            imageUrl = `${firstFile.dir_path}${firstFile.Image_Name}`;
          }
        }

        const photoTags = photo.tags?.map(pt => ({
          tag_id: pt.tag.tag_id,
          name: pt.tag.photo_tag,
          slug: pt.tag.photo_slug
        })) || [];

        return {
          photo_id: photo.photo_id,
          photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
          photo_title: photo.photo_title,
          description: photo.description,
          category_id: photo.category_id,
          category_name: photo.category?.name,
          category_slug: photo.category?.slug,
          sub_category_id: photo.sub_category_id,
          sub_category_name: photo.sub_category?.name,
          sub_category_slug: photo.sub_category?.slug,
          price: photo.price,
          photography_time: photo.photography_time,
          datetime: new Date(photo.photography_time).toLocaleDateString('en-GB'),
          author_id: photo.author_id,
          author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
          num_files: fileCount,
          tags: photoTags,
          photos: firstFile ? {
            file_id: firstFile.file_id,
            Image_Name: firstFile.Image_Name,
            isMigrat: firstFile.isMigrat,
            dir_path: firstFile.dir_path,
            migratedFilePath: firstFile.migratedFilePath,
            migratedFileName: firstFile.migratedFileName,
            Width: firstFile.Width,
            Height: firstFile.Height,
            orientation: orientation,
            is_cover: firstFile.is_cover,
            dominant_color: firstFile.dominant_color,
            url: imageUrl
          } : null
        };
      })
    );

    const estimatedTotal = Math.floor(extendedPhotos.length / 3);
    return { results, orientation: true, estimatedTotal };
  }
}

/**
 * Get category info by slug
 */
export const getCategoryInfoBySlug = async (req, res) => {
  try {
    const { slug, type } = req.params;

    if (type === 'category') {
      const category = await Prisma.pam_category.findFirst({
        where: { slug, status: 1 },
        select: {
          category_id: true,
          name: true,
          slug: true,
          _count: {
            select: { photos: { where: { is_active: 1, is_trash: 0 } } }
          }
        }
      });

      if (!category) {
        return res.status(404).json(
          errorResponse('Category not found')
        );
      }

      return res.status(200).json({
        status: 'success',
        data: {
          id: category.category_id,
          name: category.name,
          slug: category.slug,
          photo_count: category._count.photos,
          type: 'category'
        }
      });

    } else if (type === 'subcategory') {
      const subcategory = await Prisma.pam_sub_category.findFirst({
        where: { slug, status: 1 },
        include: {
          category: {
            select: {
              category_id: true,
              name: true,
              slug: true,
              status: true
            }
          },
          _count: {
            select: { photos: { where: { is_active: 1, is_trash: 0 } } }
          }
        }
      });

      if (!subcategory) {
        return res.status(404).json(
          errorResponse('Subcategory not found')
        );
      }

      return res.status(200).json({
        status: 'success',
        data: {
          id: subcategory.sub_category_id,
          name: subcategory.name,
          slug: subcategory.slug,
          photo_count: subcategory._count.photos,
          category: {
            id: subcategory.category.category_id,
            name: subcategory.category.name,
            slug: subcategory.category.slug
          },
          type: 'subcategory'
        }
      });
    }

  } catch (error) {
    console.error('Get category info error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch category info', error)
    );
  }
};

/**
 * Get all categories with photo counts
 */
export const getAllCategories = async (req, res) => {
  try {
    const categories = await Prisma.pam_category.findMany({
      where: { status: 1 },
      select: {
        category_id: true,
        name: true,
        slug: true,
        _count: {
          select: {
            photos: {
              where: { is_active: 1, is_trash: 0 }
            }
          }
        },
        subcategories: {
          where: { status: 1 },
          select: {
            sub_category_id: true,
            name: true,
            slug: true,
            _count: {
              select: {
                photos: {
                  where: { is_active: 1, is_trash: 0 }
                }
              }
            }
          },
          orderBy: { name: 'asc' }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formattedCategories = categories.map(cat => ({
      id: cat.category_id,
      name: cat.name,
      slug: cat.slug,
      photo_count: cat._count.photos,
      subcategories: cat.subcategories.map(sub => ({
        id: sub.sub_category_id,
        name: sub.name,
        slug: sub.slug,
        photo_count: sub._count.photos
      }))
    }));

    return res.status(200).json({
      status: 'success',
      results: formattedCategories,
      count: formattedCategories.length
    });

  } catch (error) {
    console.error('Get all categories error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch categories', error)
    );
  }
};

export const increaseDownload = async (req, res) => {
  console.log('--- I AM IN increaseDownload --- ');
  try {
    const { photoId } = req.params;
    const { file_id, increment_by = 1 } = req.body;

    const fileId = file_id.split('_')[1];
    // console.log('photoId: ', photoId);
    // console.log('file_id: ', fileId);
    // Validate photoId
    if (!photoId) {
      return res.status(400).json({
        status: 'error',
        message: 'photoId is required'
      });
    }
    const photo = await Prisma.pam_photos.update({
      where: {
        photo_id: parseInt(photoId)
      },
      data: {
        download: {
          increment: increment_by
        },
        updated_on: new Date()
      }
    });
    // console.log(JSON.stringify(req.user)) //{"id":105,"email":"naresh@naresh.com","role":1,"iat":1773744354,"exp":1773830754}
    if (req.user) {
      await Prisma.pam_activities.create({
        data: {
          user_id: req.user.id,
          user_name: req.user.username || 'User',
          user_type: 'user', // req.user.role || 'user',
          activity_type: 'download',
          module: 'photos',
          action: 'file_download',
          message: `Downloaded photo ID: ${photoId}${file_id ? `, File ID: ${fileId}` : ''}`,
          resource_id: parseInt(photoId),
          created_at: new Date(),
          activity_code: 'DOWNLOAD001'
        }
      });
    }
    res.json({
      status: 'success',
      message: 'Download count updated',
      data: {
        download_count: photo.download,
        photo_id: photoId,
        file_id: file_id || null
      }
    });
  } catch (error) {
    console.error('Error updating download count:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update download count',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const downloadPhotoFile = async (req, res) => {
  console.log("--- @@@downloadPhotoFile@@@ ---");
  try {
    const { photoId, fileId } = req.params;
    console.log(`--- downloadPhotoFileData: --- ${photoId} --- ${fileId} ---`)
    if (!photoId || !fileId) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo ID and File ID are required'
      });
    }
    
    const file = await Prisma.pam_photos_files.findFirst({
      where: {
        photo_id: parseInt(photoId),
        file_id: parseInt(fileId),
        is_trash: 'N'
      }
    });
    if (!file) {
      return res.status(404).json({
        status: 'error',
        message: 'File not found'
      });
    } 
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: parseInt(photoId) },
      select: { is_active: true, is_trash: true, author_id: true }
    });
    if (!photo || photo.is_active !== 1 || photo.is_trash !== 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found or not accessible'
      });
    }
    try {
      const currentDownloads = file.downloads || 0;
      await Prisma.pam_photos_files.update({
        where: {
          file_id: parseInt(fileId)  // Only works if file_id is unique
        },
        data: {
          downloads: currentDownloads + 1
        }
      });
      console.log(`✅ Downloads updated: ${currentDownloads} → ${currentDownloads + 1}`);
    } catch (updateError) {
      console.error('Failed to update downloads count:', updateError);
      // Continue with download even if update fails
    }
    
    const ASSET_BASE_URL = process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com';
    const OLD_ASSET_BASE_URL = process.env.VITE_OLD_S3_BASE_URL || '';
    
    let fileUrl;
    if (file.isMigrat === 1 && file.migratedFilePath && file.migratedFileName) {
      fileUrl = `${OLD_ASSET_BASE_URL}/${file.migratedFilePath}${file.migratedFileName}`;
    } else if (file.dir_path && file.Image_Name) {
      fileUrl = `${ASSET_BASE_URL}/uploads/${file.dir_path}/${file.Image_Name}`;
    } else {
      return res.status(404).json({
        status: 'error',
        message: 'File URL not found'
      });
    }
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || file.file_ext || 'image/jpeg';
    // const filename = file.original_image_name || file.Image_Name || `download.${file.file_ext || 'jpg'}`;
    // ✅ Determine filename with proper extension
    const fileExtension = file.file_ext || 'jpg';
    const originalName = file.original_image_name || file.Image_Name || 'download';
    // Remove any existing extension from original name and add the correct one
    //const baseName = originalName.replace(/\.[^/.]+$/, '');
    const filename = `${file.photo_id}_${file.file_id}.${fileExtension}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (error) {
    console.error('Download photo file error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to download file',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const downloadAllPhotoFiles = async (req, res) => {
  console.log("--- downloadAllPhotoFiles ---");
  try {
    const { photoId } = req.params;
    //console.log(`--- downloadAllPhotoFiles --- ${photoId} ---`);
    if (!photoId) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo ID is required'
      });
    }
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: parseInt(photoId) },
      select: { 
        is_active: true, 
        is_trash: true, 
        author_id: true,
        photo_title: true,
        photography_time: true
      }
    });
    if (!photo || photo.is_active !== 1 || photo.is_trash !== 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found or not accessible'
      });
    }
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        photo_id: parseInt(photoId),
        is_trash: 'N'
      },
      orderBy: {
        file_id: 'asc'
      }
    });
    if (!files || files.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No files found for this photo'
      });
    }
    const ASSET_BASE_URL = process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com';
    const OLD_ASSET_BASE_URL = process.env.VITE_OLD_S3_BASE_URL || '';
    // Create a new ZIP archive
    const zip = new JSZip();

    // Process each file
    for (const file of files) {
      try {
        // Construct the file URL
        let fileUrl;
        if (file.isMigrat === 1 && file.migratedFilePath && file.migratedFileName) {
          fileUrl = `${OLD_ASSET_BASE_URL}/${file.migratedFilePath}${file.migratedFileName}`;
        } else if (file.dir_path && file.Image_Name) {
          fileUrl = `${ASSET_BASE_URL}/uploads/${file.dir_path}/${file.Image_Name}`;
        } else {
          console.warn(`Skipping file ${file.file_id}: URL not found`);
          continue;
        }

        // Fetch the file from S3
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
          console.warn(`Failed to fetch file ${file.file_id}: ${response.status}`);
          continue;
        }

        // Get the file buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Determine filename with proper extension
        const fileExtension = file.file_ext || 'jpg';
        const filename = `${photoId}_${file.file_id}.${fileExtension}`;

        // Add file to ZIP
        zip.file(filename, buffer);

      } catch (fileError) {
        console.error(`Error processing file ${file.file_id}:`, fileError);
        // Continue with other files
      }
    }

    // Check if any files were added to ZIP
    const fileCount = Object.keys(zip.files).length;
    if (fileCount === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No files could be processed for download'
      });
    }

    // Generate ZIP file
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6 // Good balance between compression and speed
      }
    });
    // Generate ZIP filename based on photography_time 
    // ( photo.photography_time ? new Date(photo.photography_time) :)
    const photographyDate = new Date();
    const day = String(photographyDate.getDate()).padStart(2, '0');
    const month = String(photographyDate.getMonth() + 1).padStart(2, '0');
    const year = photographyDate.getFullYear();
    const formattedDate = `${day}_${month}_${year}`;

    // Determine ZIP filename
    // const zipFilename = `${photo.photo_title || 'photo'}_${photoId}_files.zip`;
    // const zipFilename = `outlook_photo_${photoId}.zip`;
    const zipFilename = `outlook_photo_${formattedDate}_${photoId}.zip`; 
    const sanitizedFilename = zipFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');

    // Set headers for ZIP download
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Send the ZIP file
    res.send(zipBuffer);

  } catch (error) {
    console.error('Download all photo files error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to download files as ZIP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * Download multiple galleries as a single ZIP file
 * Accepts an array of photo IDs and downloads all their files
 */
export const downloadMultipleGalleries_OLD = async (req, res) => {
  console.log("--- downloadMultipleGalleries ---");
  
  try {
    const { photoIds } = req.body;
    //console.log(JSON.stringify(photoIds, null, 2)); return
    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo IDs array is required'
      });
    }

    const ASSET_BASE_URL = process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com';
    const OLD_ASSET_BASE_URL = process.env.VITE_OLD_S3_BASE_URL || '';
    
    // Create a new ZIP archive
    const zip = new JSZip();
    let totalFilesAdded = 0;
    let totalGalleriesProcessed = 0;
    const failedGalleries = [];

    // Process each photo/gallery
    for (const photoId of photoIds) {
      try {
        // Check if photo exists and is accessible
        const photo = await Prisma.pam_photos.findUnique({
          where: { photo_id: parseInt(photoId) },
          select: {
            is_active: true,
            is_trash: true,
            author_id: true,
            photo_title: true,
            photography_time: true
          }
        });

        if (!photo || photo.is_active !== 1 || photo.is_trash !== 0) {
          console.warn(`Skipping gallery ${photoId}: Photo not found or not accessible`);
          failedGalleries.push({ photoId, reason: 'Photo not found or not accessible' });
          continue;
        }

        // Get files for this gallery
        const files = await Prisma.pam_photos_files.findMany({
          where: {
            photo_id: parseInt(photoId),
            is_trash: 'N'
          },
          orderBy: {
            file_id: 'asc'
          }
        });

        if (!files || files.length === 0) {
          console.warn(`Skipping gallery ${photoId}: No files found`);
          failedGalleries.push({ photoId, reason: 'No files found' });
          continue;
        }

        // Create folder name for this gallery
        // const folderName = `${photoId}_${photo.photo_title || 'untitled'}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const folderName = photoId// `${photoId}|| 'untitled'}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        // Process each file in this gallery
        let filesAddedInGallery = 0;
        for (const file of files) {
          try {
            let fileUrl;
            if (file.isMigrat === 1 && file.migratedFilePath && file.migratedFileName) {
              fileUrl = `${OLD_ASSET_BASE_URL}/${file.migratedFilePath}${file.migratedFileName}`;
            } else if (file.dir_path && file.Image_Name) {
              fileUrl = `${ASSET_BASE_URL}/uploads/${file.dir_path}/${file.Image_Name}`;
            } else {
              console.warn(`Skipping file ${file.file_id} in gallery ${photoId}: URL not found`);
              continue;
            }

            // Fetch the file from S3
            const response = await fetch(fileUrl);
            
            if (!response.ok) {
              console.warn(`Failed to fetch file ${file.file_id} in gallery ${photoId}: ${response.status}`);
              continue;
            }

            // Get the file buffer
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Determine filename with proper extension
            const fileExtension = file.file_ext || 'jpg';
            const filename = `${photoId}_${file.file_id}.${fileExtension}`;

            // Add file to ZIP with folder structure
            zip.file(`${folderName}/${filename}`, buffer);
            filesAddedInGallery++;
            totalFilesAdded++;

          } catch (fileError) {
            console.error(`Error processing file ${file.file_id} in gallery ${photoId}:`, fileError);
          }
        }

        if (filesAddedInGallery > 0) {
          totalGalleriesProcessed++;
        } else {
          failedGalleries.push({ photoId, reason: 'No files could be processed' });
        }

      } catch (galleryError) {
        console.error(`Error processing gallery ${photoId}:`, galleryError);
        failedGalleries.push({ photoId, reason: galleryError.message });
      }
    }

    // Check if any files were added to ZIP
    if (totalFilesAdded === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No files could be processed for download',
        details: {
          totalGalleriesRequested: photoIds.length,
          failedGalleries
        }
      });
    }

    // Generate ZIP file
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6
      }
    });

    // Generate ZIP filename
    const currentDate = new Date();
    const day = String(currentDate.getDate()).padStart(2, '0');
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const year = currentDate.getFullYear();
    const formattedDate = `${day}_${month}_${year}`;
    const zipFilename = `outlook_photos_${photoIds.length}_galleries_${formattedDate}.zip`;
    const sanitizedFilename = zipFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');

    // Set headers for ZIP download
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Send the ZIP file
    res.send(zipBuffer);

  } catch (error) {
    console.error('Download multiple galleries error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to download galleries as ZIP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const downloadMultipleGalleries = async (req, res) => {
  console.log("--- downloadMultipleGalleries ---");
  
  try {
    const { photoIds } = req.body;
    
    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo IDs array is required'
      });
    }

    const ASSET_BASE_URL = process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com';
    const OLD_ASSET_BASE_URL = process.env.VITE_OLD_S3_BASE_URL || '';
    
    // Create a new ZIP archive
    const zip = new JSZip();
    let totalFilesAdded = 0;
    const failedFiles = [];

    // Process each file ID
    for (const fileId of photoIds) {
      try {
        // Directly query pam_photos_files for this file_id
        const file = await Prisma.pam_photos_files.findFirst({
          where: {
            file_id: parseInt(fileId),
            is_trash: 'N'
          }
        });

        if (!file) {
          console.warn(`Skipping file ${fileId}: File not found or trashed`);
          failedFiles.push({ fileId, reason: 'File not found or trashed' });
          continue;
        }

        let fileUrl;
        let dir_path = file.dir_path.replace(/\/$/, '');
        if (file.isMigrat === 1 && file.migratedFilePath && file.migratedFileName) {
          fileUrl = `${OLD_ASSET_BASE_URL}/${file.migratedFilePath}${file.migratedFileName}`;
        } else if (dir_path && file.Image_Name) { 
          fileUrl = `${ASSET_BASE_URL}/uploads/${dir_path}/${file.Image_Name}`;
        } else {
          console.warn(`Skipping file ${fileId}: URL not found`);
          failedFiles.push({ fileId, reason: 'URL not found' });
          continue;
        }
        // console.log( fileUrl )

        // https://oli-photoassets.s3.ap-south-1.amazonaws.com/uploads/2025/11/26//Pollution_NCR_3_20251126161403.jpg
        // Fetch the file from S3
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
          console.warn(`Failed to fetch file ${fileId}: ${response.status}`);
          failedFiles.push({ fileId, reason: `Failed to fetch: ${response.status}` });
          continue;
        }

        // Get the file buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Determine filename with proper extension
        const fileExtension = file.file_ext || 'jpg';
        // File rename: file_id.jpg (e.g., 208631.jpg)
        const filename = `${file.file_id}.${fileExtension}`;

        // Add file to ZIP (without folder structure)
        zip.file(filename, buffer);
        totalFilesAdded++;

      } catch (error) {
        console.error(`Error processing file ${fileId}:`, error);
        failedFiles.push({ fileId, reason: error.message });
      }
    }

    // Check if any files were added to ZIP
    if (totalFilesAdded === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No files could be processed for download',
        details: {
          totalFilesRequested: photoIds.length,
          failedFiles
        }
      });
    }

    // Generate ZIP file
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6
      }
    });

    // Generate ZIP filename
    const currentDate = new Date();
    const day = String(currentDate.getDate()).padStart(2, '0');
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const year = currentDate.getFullYear();
    const formattedDate = `${day}_${month}_${year}`;
    const zipFilename = `outlook_photos_${formattedDate}.zip`;
    const sanitizedFilename = zipFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');

    // Set headers for ZIP download
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Send the ZIP file
    res.send(zipBuffer);

  } catch (error) {
    console.error('Download multiple galleries error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to download galleries as ZIP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get related photos for a given photo ID
 * Fetches photos from the same category, subcategory, or with similar tags
 */

export const getRelatedPhotos = async (req, res) => {
  console.log("--- getRelatedPhotos ---");
  
  try {
    const { id } = req.params;
    const photoId = parseInt(id);
    const limit = parseInt(req.query.limit) || 12;
    
    if (isNaN(photoId)) {
      return res.status(400).json(
        errorResponse('Invalid photo ID')
      );
    }
    
    // Get the current photo details to find related content
    const currentPhoto = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: BigInt(photoId),
        is_active: 1,
        is_trash: 0
      },
      include: {
        tags: {
          include: {
            tag: {
              select: {
                tag_id: true,
                photo_tag: true
              }
            }
          }
        }
      }
    });
    
    if (!currentPhoto) {
      return res.status(404).json(
        errorResponse('Photo not found')
      );
    }
    
    // Get tag IDs from current photo
    const tagIds = currentPhoto.tags.map(pt => pt.tag_id);
    
    // Build where clause for related photos
    const where = {
      photo_id: { not: BigInt(photoId) }, // Exclude current photo
      is_active: 1,
      is_trash: 0
    };
    
    // Build OR conditions for related photos
    const orConditions = [];
    
    // 1. Same category
    if (currentPhoto.category_id) {
      orConditions.push({ category_id: currentPhoto.category_id });
    }
    
    // 2. Same subcategory
    if (currentPhoto.sub_category_id) {
      orConditions.push({ sub_category_id: currentPhoto.sub_category_id });
    }
    
    // 3. Same tags (if any)
    if (tagIds.length > 0) {
      orConditions.push({
        tags: {
          some: {
            tag_id: { in: tagIds }
          }
        }
      });
    }
    
    // If no conditions, fallback to recent photos
    if (orConditions.length === 0) {
      // Get recent photos as fallback
      const recentPhotos = await Prisma.pam_photos.findMany({
        where: {
          photo_id: { not: BigInt(photoId) },
          is_active: 1,
          is_trash: 0
        },
        orderBy: {
          photo_id: 'desc'
        },
        take: limit,
        include: {
          category: {
            select: {
              name: true,
              slug: true
            }
          },
          sub_category: {
            select: {
              name: true,
              slug: true
            }
          },
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true
            }
          },
          tags: {
            include: {
              tag: {
                select: {
                  tag_id: true,
                  photo_tag: true,
                  photo_slug: true
                }
              }
            }
          }
        }
      });
      
      // Process results
      const results = await processRelatedPhotos(recentPhotos);
      
      return res.status(200).json(
        serializeBigInt({
          status: 'success',
          data: results,
          count: results.length,
          source: 'recent'
        })
      );
    }
    
    // Use OR condition for related photos
    where.OR = orConditions;
    
    // Get related photos
    const relatedPhotos = await Prisma.pam_photos.findMany({
      where,
      orderBy: {
        photo_id: 'desc'
      },
      take: limit * 2, // Fetch more to account for duplicates
      include: {
        category: {
          select: {
            name: true,
            slug: true
          }
        },
        sub_category: {
          select: {
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true
          }
        },
        tags: {
          include: {
            tag: {
              select: {
                tag_id: true,
                photo_tag: true,
                photo_slug: true
              }
            }
          }
        }
      }
    });
    
    // Remove duplicates (photos that appear multiple times due to OR conditions)
    const uniquePhotos = [];
    const seenIds = new Set();
    
    for (const photo of relatedPhotos) {
      const photoIdStr = photo.photo_id.toString();
      if (!seenIds.has(photoIdStr)) {
        seenIds.add(photoIdStr);
        uniquePhotos.push(photo);
      }
    }
    
    // Limit results
    const limitedPhotos = uniquePhotos.slice(0, limit);
    
    // Process results
    const results = await processAllRelatedPhotos(limitedPhotos);
    
    return res.status(200).json(
      serializeBigInt({
        status: 'success',
        data: results,
        count: results.length,
        source: 'related'
      })
    );
    
  } catch (error) {
    console.error('Get related photos error:', error);
    return res.status(500).json(
      errorResponse('Failed to fetch related photos', error)
    );
  }
};

async function processAllRelatedPhotos(photos) {
  const results = await Promise.all(
    photos.map(async (photo) => {
      const photoId = Number(photo.photo_id);
      const fileCount = await Prisma.pam_photos_files.count({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        }
      });
      const firstFile = await Prisma.pam_photos_files.findFirst({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        },
        orderBy: {
          is_cover: 'desc'
        },
        select: {
          file_id: true,
          dir_path: true,
          Image_Name: true,
          Width: true,
          Height: true,
          isMigrat: true,
          migratedFilePath: true,
          migratedFileName: true,
          is_cover: true,
          dominant_color: true
        }
      });
      let calculatedOrientation = null;
      if (firstFile?.Width && firstFile?.Height) {
        const ratio = firstFile.Width / firstFile.Height;
        if (ratio > 1.05) calculatedOrientation = 'horizontal';
        else if (ratio < 0.95) calculatedOrientation = 'vertical';
        else calculatedOrientation = 'square';
      }
      let imageUrl = null;
      if (firstFile) {
        if (firstFile.isMigrat === 1 && firstFile.migratedFilePath && firstFile.migratedFileName) {
          imageUrl = `${firstFile.migratedFilePath}/${firstFile.migratedFileName}`;
        } else if (firstFile.dir_path && firstFile.Image_Name) {
          imageUrl = `${firstFile.dir_path}/${firstFile.Image_Name}`;
        }
      }
      const photoTags = photo.tags?.map(pt => ({
        tag_id: pt.tag.tag_id,
        name: pt.tag.photo_tag,
        slug: pt.tag.photo_slug
      })) || [];
      
      return {
        photo_id: photo.photo_id,
        photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
        photo_title: photo.photo_title,
        description: photo.description,
        category_id: photo.category_id,
        category_name: photo.category?.name,
        category_slug: photo.category?.slug,
        sub_category_id: photo.sub_category_id,
        sub_category_name: photo.sub_category?.name,
        sub_category_slug: photo.sub_category?.slug,
        price: photo.price,
        photography_time: photo.photography_time,
        author_id: photo.author_id,
        author_name: photo.user ? `${photo.user.firstname} ${photo.user.lastname}` : null,
        num_files: fileCount,
        tags: photoTags,
        photos: firstFile ? {
          file_id: firstFile.file_id,
          Image_Name: firstFile.Image_Name,
          isMigrat: firstFile.isMigrat,
          dir_path: firstFile.dir_path,
          migratedFilePath: firstFile.migratedFilePath,
          migratedFileName: firstFile.migratedFileName,
          Width: firstFile.Width,
          Height: firstFile.Height,
          orientation: calculatedOrientation,
          is_cover: firstFile.is_cover,
          dominant_color: firstFile.dominant_color,
          url: imageUrl
        } : null
      };
    })
  );
  
  return results;
}

/**
 * Autosuggest photos based on search query
 * Returns photo titles and basic info for autocomplete
 */
 
export const autosuggestPhotos = async (req, res) => {
  console.log("--- autosuggestPhotos ---");
  
  try {
    const { q: query, limit = 10 } = req.query;

    if (!query || query.trim() === '') {
      return res.status(200).json({
        status: 'success',
        results: [],
        count: 0
      });
    }

    const searchTerm = query.trim();
    
    // Check if the search term is a number (potential ID search)
    const isNumeric = /^\d+$/.test(searchTerm);
    
    let photos = [];
    let searchType = 'text';
    
    if (isNumeric) {
      try {
        // If it's a number, search in pam_photos_files by file_id OR photo_id
        console.log(`🔍 ID-based search for: ${searchTerm}`);
        searchType = 'id';
        
        const numericId = parseInt(searchTerm);
        
        // First, find files with matching file_id or photo_id
        const matchingFiles = await Prisma.pam_photos_files.findMany({
          where: {
            is_trash: 'N',
            OR: [
              { file_id: numericId },
              { photo_id: numericId }
            ]
          },
          select: {
            photo_id: true,
            file_id: true
          },
          take: parseInt(limit)
        });
        
        // Get unique photo_ids from matching files
        const photoIds = [...new Set(matchingFiles.map(f => Number(f.photo_id)))];
        
        if (photoIds.length > 0) {
          // Fetch photos with these IDs
          photos = await Prisma.pam_photos.findMany({
            where: {
              photo_id: { in: photoIds },
              is_active: 1,
              is_trash: 0
            },
            take: parseInt(limit),
            orderBy: {
              photo_id: 'desc'
            },
            select: {
              photo_id: true,
              photo_title: true,
              description: true,
              event_name: true,
              category: {
                select: {
                  name: true
                }
              },
              sub_category: {
                select: {
                  name: true
                }
              }
            }
          });
        }
      } catch (idError) {
        console.error('ID search error, falling back to text search:', idError);
        // If ID search fails, fall back to text search
        searchType = 'text';
        // Continue to text search
      }
    }
    
    // If no results from ID search or it wasn't a numeric search, do text search
    if (photos.length === 0 && searchType === 'text') {
      console.log(`🔍 Text search for: ${searchTerm}`);
      
      const lowerSearchTerm = searchTerm.toLowerCase();
      const upperSearchTerm = searchTerm.toUpperCase();
      const titleCaseTerm = searchTerm.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');

      // Search in photos table with multiple case variations
      photos = await Prisma.pam_photos.findMany({
        where: {
          is_active: 1,
          is_trash: 0,
          OR: [
            // Original case
            { photo_title: { contains: searchTerm } },
            { description: { contains: searchTerm } },
            { event_name: { contains: searchTerm } },
            { photo_tags: { contains: searchTerm } },
            // Lowercase
            { photo_title: { contains: lowerSearchTerm } },
            { description: { contains: lowerSearchTerm } },
            { event_name: { contains: lowerSearchTerm } },
            { photo_tags: { contains: lowerSearchTerm } },
            // Uppercase
            { photo_title: { contains: upperSearchTerm } },
            { description: { contains: upperSearchTerm } },
            { event_name: { contains: upperSearchTerm } },
            { photo_tags: { contains: upperSearchTerm } },
            // Title Case
            { photo_title: { contains: titleCaseTerm } },
            { description: { contains: titleCaseTerm } },
            { event_name: { contains: titleCaseTerm } },
            { photo_tags: { contains: titleCaseTerm } }
          ]
        },
        take: parseInt(limit),
        orderBy: {
          photo_id: 'desc'
        },
        select: {
          photo_id: true,
          photo_title: true,
          description: true,
          event_name: true,
          category: {
            select: {
              name: true
            }
          },
          sub_category: {
            select: {
              name: true
            }
          }
        },
        distinct: ['photo_title']
      });
    }

    // Process results
    const results = photos.map((photo) => {
      return {
        photo_id: photo.photo_id.toString(),
        photo_title: photo.photo_title,
        description: photo.description?.substring(0, 100) + (photo.description?.length > 100 ? '...' : ''),
        event_name: photo.event_name || '',
        category_name: photo.category?.name || null,
        sub_category_name: photo.sub_category?.name || null,
        id: photo.photo_id.toString(),
        title: photo.photo_title,
        source: photo.category?.name || null,
      };
    });

    return res.status(200).json({
      status: 'success',
      results: results,
      count: results.length,
      query: searchTerm,
      searchType: searchType
    });

  } catch (error) {
    console.error('Autosuggest photos error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch suggestions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const autosuggestPhotos____OLD  = async (req, res) => {
  console.log("--- autosuggestPhotos ---");
  
  try {
    const { q: query, limit = 10 } = req.query;

    if (!query || query.trim() === '') {
      return res.status(200).json({
        status: 'success',
        results: [],
        count: 0
      });
    }

    const searchTerm = query.trim();
    const lowerSearchTerm = searchTerm.toLowerCase();
    const upperSearchTerm = searchTerm.toUpperCase();
    const titleCaseTerm = searchTerm.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');

    // Search in photos table with multiple case variations
    const photos = await Prisma.pam_photos.findMany({
      where: {
        is_active: 1,
        is_trash: 0,
        OR: [
          // Original case
          { photo_title: { contains: searchTerm } },
          { description: { contains: searchTerm } },
          { event_name: { contains: searchTerm } },
          { photo_tags: { contains: searchTerm } },
          // Lowercase
          { photo_title: { contains: lowerSearchTerm } },
          { description: { contains: lowerSearchTerm } },
          { event_name: { contains: lowerSearchTerm } },
          { photo_tags: { contains: lowerSearchTerm } },
          // Uppercase
          { photo_title: { contains: upperSearchTerm } },
          { description: { contains: upperSearchTerm } },
          { event_name: { contains: upperSearchTerm } },
          { photo_tags: { contains: upperSearchTerm } },
          // Title Case
          { photo_title: { contains: titleCaseTerm } },
          { description: { contains: titleCaseTerm } },
          { event_name: { contains: titleCaseTerm } },
          { photo_tags: { contains: titleCaseTerm } }
        ]
      },
      take: parseInt(limit),
      orderBy: {
        photo_id: 'desc'
      },
      select: {
        photo_id: true,
        photo_title: true,
        description: true,
        event_name: true,
        category: {
          select: {
            name: true
          }
        },
        sub_category: {
          select: {
            name: true
          }
        }
      },
      distinct: ['photo_title']
    });

    // Process results
    const results = photos.map((photo) => {
      return {
        photo_id: photo.photo_id.toString(),
        photo_title: photo.photo_title,
        description: photo.description?.substring(0, 100) + (photo.description?.length > 100 ? '...' : ''),
        event_name: photo.event_name || '',
        category_name: photo.category?.name || null,
        sub_category_name: photo.sub_category?.name || null,
        id: photo.photo_id.toString(),
        title: photo.photo_title,
        source: photo.category?.name || null,
      };
    });

    return res.status(200).json({
      status: 'success',
      results: results,
      count: results.length,
      query: searchTerm
    });

  } catch (error) {
    console.error('Autosuggest photos error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch suggestions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// end of cagegory change.





// ==================== EXPORT ALL CONTROLLERS ====================

export default {
  // Photo listing and viewing
  getAllPhotos,
  getPhotoDetails: getPhotoById,
  getPhotoFiles,
  getPhotoById,
  getPhotoByEncodedId,
  editPhoto,
  updateCoverPhoto,

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
  createPhoto, createUserPhoto, editPhotoAnySide,
  updatePhoto,
  deletePhoto, trashPhotoAlbum,
  togglePhotoStatus,
  restorePhoto: async () => { }, // Implement as needed
  restorePhotoAdmin: async () => { },
  permanentlyDeletePhoto: async () => { }, // Implement as needed
  restorePhotoFile:   async () => { },

  // Photo files management
  addPhotoFiles, addAdminPhotoFiles,
  removePhotoFile: async () => { }, // Implement as needed
  removePhotoFileByAdmin: async () => { },
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