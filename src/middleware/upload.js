import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { 
  uploadImageWithThumbnail, 
  getPublicUrl,
  generateS3Key 
} from '../utils/s3.js';
import { getImageMetadata } from '../utils/image-processor.js';

// Configuration
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 50;
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/svg+xml'
];

/**
 * Multer storage configuration for local file storage
 */
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadDir = 'public/uploads/';
    
    // Determine directory based on file type/context
    if (req.uploadConfig?.type === 'user_avatar') {
      uploadDir = path.join('public', 'uploads', 'users', 'avatars');
    } else if (req.uploadConfig?.type === 'photo') {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      uploadDir = path.join('public', 'uploads', 'photos', String(year), month, day);
    } else if (req.uploadConfig?.type === 'document') {
      uploadDir = path.join('public', 'uploads', 'documents');
    } else {
      uploadDir = path.join('public', 'uploads', 'temp');
    }

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname);
    
    let filename;
    if (req.uploadConfig?.type === 'user_avatar' && req.user) {
      filename = `avatar_${req.user.id}_${Date.now()}${extension}`;
    } else if (req.uploadConfig?.type === 'photo') {
      filename = `photo_${Date.now()}_${uniqueId.substring(0, 8)}${extension}`;
    } else {
      filename = `${Date.now()}_${uniqueId.substring(0, 8)}${extension}`;
    }

    cb(null, filename);
  }
});

/**
 * Memory storage for processing files without saving to disk
 */
const memoryStorage = multer.memoryStorage();

/**
 * File filter for image uploads
 */
const imageFileFilter = (req, file, cb) => {
  // Check file type
  const allowedMimeTypes = ALLOWED_IMAGE_TYPES;
  
  if (!allowedMimeTypes.includes(file.mimetype)) {
    const error = new Error('Invalid file type. Only image files are allowed.');
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }

  // Check file extension
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.svg'];
  const extension = path.extname(file.originalname).toLowerCase();
  
  if (!allowedExtensions.includes(extension)) {
    const error = new Error('Invalid file extension.');
    error.code = 'INVALID_FILE_EXTENSION';
    return cb(error, false);
  }

  cb(null, true);
};

/**
 * File filter for document uploads
 */
const documentFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    const error = new Error('Invalid file type. Only document files are allowed.');
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }

  cb(null, true);
};

/**
 * Multer configuration options
 */
const multerOptions = {
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  },
  fileFilter: imageFileFilter
};

/**
 * Create multer instance based on storage type
 */
const createMulterInstance = (storageType = 'local', config = {}) => {
  let storage;
  
  switch (storageType) {
    case 'memory':
      storage = memoryStorage;
      break;
    case 's3':
      // For S3, we'll use memory storage and process in middleware
      storage = memoryStorage;
      break;
    case 'local':
    default:
      storage = localStorage;
      break;
  }

  return multer({
    storage,
    ...multerOptions,
    ...config
  });
};

/**
 * Middleware to process uploaded images
 * - Resize images if needed
 * - Convert to WebP if configured
 * - Extract metadata
 */
const processImageMiddleware = async (req, res, next) => {
  if (!req.files && !req.file) {
    return next();
  }

  try {
    const files = req.files || [req.file];
    const processedFiles = [];

    for (const file of files) {
      if (file.mimetype.startsWith('image/')) {
        // Process image
        const processedFile = await processImageFile(file, req.uploadConfig);
        processedFiles.push(processedFile);
      } else {
        // Non-image files
        processedFiles.push({
          ...file,
          processed: false,
          message: 'Non-image file, skipping processing'
        });
      }
    }

    // Replace original files with processed files
    if (req.files) {
      req.files = processedFiles;
    } else {
      req.file = processedFiles[0];
    }

    req.processedFiles = processedFiles;
    next();
  } catch (error) {
    console.error('Image processing error:', error);
    next(error);
  }
};

/**
 * Process individual image file
 */
const processImageFile = async (file, config = {}) => {
  const {
    resize = false,
    maxWidth = 1920,
    maxHeight = 1080,
    convertToWebp = false,
    quality = 80
  } = config;

  let buffer = file.buffer || fs.readFileSync(file.path);
  let metadata;

  try {
    // Get image metadata
    metadata = await sharp(buffer).metadata();

    // Resize if needed
    if (resize && (metadata.width > maxWidth || metadata.height > maxHeight)) {
      buffer = await sharp(buffer)
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer();
      
      // Update metadata after resize
      metadata = await sharp(buffer).metadata();
    }

    // Convert to WebP if configured
    if (convertToWebp && metadata.format !== 'webp') {
      buffer = await sharp(buffer)
        .webp({ quality })
        .toBuffer();
      
      file.mimetype = 'image/webp';
      file.originalname = `${path.parse(file.originalname).name}.webp`;
    }

    // Update file properties
    const processedFile = {
      ...file,
      buffer,
      size: buffer.length,
      metadata: {
        ...metadata,
        orientation: getImageOrientation(metadata.width, metadata.height)
      },
      processed: true
    };

    // If file was on disk, update it
    if (file.path) {
      fs.writeFileSync(file.path, buffer);
      processedFile.path = file.path;
    }

    return processedFile;
  } catch (error) {
    console.error('Error processing image file:', error);
    throw error;
  }
};

/**
 * Get image orientation
 */
const getImageOrientation = (width, height) => {
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
};

/**
 * Middleware to upload files to AWS S3
 */
const uploadToS3Middleware = async (req, res, next) => {
  // Skip if not using S3
  if (process.env.STORAGE_TYPE !== 's3') {
    return next();
  }

  if (!req.processedFiles && !req.files && !req.file) {
    return next();
  }

  try {
    const files = req.processedFiles || req.files || [req.file];
    const uploadedFiles = [];

    for (const file of files) {
      const {
        type = 'general',
        prefix = 'uploads',
        makePublic = true,
        generateThumbnail = true
      } = req.uploadConfig || {};

      if (file.mimetype.startsWith('image/')) {
        // Upload image with thumbnail
        const uploadResult = await uploadImageWithThumbnail(
          file.buffer || fs.readFileSync(file.path),
          file.originalname,
          file.mimetype,
          {
            prefix: `${prefix}/${type}`,
            isPublic: makePublic,
            thumbnailWidth: 400,
            thumbnailHeight: 400
          }
        );

        uploadedFiles.push({
          originalname: file.originalname,
          filename: uploadResult.fileName,
          mimetype: file.mimetype,
          size: file.size,
          url: uploadResult.mainUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          s3Key: uploadResult.mainKey,
          s3ThumbnailKey: uploadResult.thumbnailKey,
          storage: 's3',
          metadata: file.metadata || {}
        });

        // Clean up local file if it exists
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } else {
        // Upload non-image file
        const timestamp = Date.now();
        const uniqueName = `${timestamp}_${uuidv4().substring(0, 8)}${path.extname(file.originalname)}`;
        const s3Key = generateS3Key(uniqueName, false, `${prefix}/${type}`);

        const s3Url = await uploadToS3(
          file.buffer || fs.readFileSync(file.path),
          s3Key,
          file.mimetype,
          makePublic
        );

        uploadedFiles.push({
          originalname: file.originalname,
          filename: uniqueName,
          mimetype: file.mimetype,
          size: file.size,
          url: s3Url,
          s3Key,
          storage: 's3'
        });
      }
    }

    // Attach uploaded files to request
    req.uploadedFiles = uploadedFiles;
    
    // Also update req.files for backward compatibility
    if (req.files) {
      req.files = uploadedFiles;
    } else if (req.file) {
      req.file = uploadedFiles[0];
    }

    next();
  } catch (error) {
    console.error('S3 upload error:', error);
    next(error);
  }
};

/**
 * Middleware to handle local file storage
 */
const handleLocalStorage = async (req, res, next) => {
  if (process.env.STORAGE_TYPE === 's3') {
    return next();
  }

  if (!req.files && !req.file) {
    return next();
  }

  try {
    const files = req.files || [req.file];
    const storedFiles = [];

    for (const file of files) {
      const baseUrl = process.env.APP_URL || `http://${req.headers.host}`;
      const relativePath = file.path.replace(/^public/, '');
      const fileUrl = `${baseUrl}${relativePath}`;

      storedFiles.push({
        originalname: file.originalname,
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
        url: fileUrl,
        storage: 'local'
      });
    }

    req.storedFiles = storedFiles;
    next();
  } catch (error) {
    console.error('Local storage handling error:', error);
    next(error);
  }
};

/**
 * Validation middleware for uploads
 */
const validateUpload = (config = {}) => {
  return (req, res, next) => {
    try {
      // Store upload configuration
      req.uploadConfig = config;

      // Validate file count
      if (config.maxFiles && req.files && req.files.length > config.maxFiles) {
        throw new Error(`Maximum ${config.maxFiles} files allowed`);
      }

      // Validate file types if specified
      if (config.allowedTypes) {
        const files = req.files || [req.file];
        for (const file of files) {
          if (!config.allowedTypes.includes(file.mimetype)) {
            throw new Error(`File type ${file.mimetype} not allowed`);
          }
        }
      }

      // Validate file sizes
      if (config.maxSizePerFile) {
        const files = req.files || [req.file];
        for (const file of files) {
          if (file.size > config.maxSizePerFile) {
            throw new Error(`File ${file.originalname} exceeds maximum size`);
          }
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Error handling middleware for uploads
 */
const uploadErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          status: 'error',
          message: 'File too large',
          maxSize: `${MAX_FILE_SIZE / (1024 * 1024)}MB`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          status: 'error',
          message: 'Too many files',
          maxFiles: MAX_FILES
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          status: 'error',
          message: 'Unexpected file field'
        });
      default:
        return res.status(400).json({
          status: 'error',
          message: `Upload error: ${err.message}`
        });
    }
  } else if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      status: 'error',
      message: err.message,
      allowedTypes: ALLOWED_IMAGE_TYPES
    });
  } else if (err.code === 'INVALID_FILE_EXTENSION') {
    return res.status(400).json({
      status: 'error',
      message: err.message
    });
  } else if (err.message.includes('maximum size')) {
    return res.status(400).json({
      status: 'error',
      message: err.message
    });
  }

  // Pass other errors to the default error handler
  next(err);
};

/**
 * Cleanup middleware - remove temporary files on error
 */
const cleanupTempFiles = (req, res, next) => {
  // Cleanup on response finish
  res.on('finish', () => {
    if (req.files || req.file) {
      const files = req.files || [req.file];
      
      files.forEach(file => {
        if (file.path && fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
            console.log('Cleaned up temp file:', file.path);
          } catch (cleanupError) {
            console.error('Error cleaning up temp file:', cleanupError);
          }
        }
      });
    }
  });

  next();
};

/**
 * Preconfigured upload middlewares for different use cases
 */

// Single image upload
const singleImageUpload = (fieldName = 'image', config = {}) => {
  const multerInstance = createMulterInstance(config.storage || 'local', {
    fileFilter: imageFileFilter,
    limits: {
      fileSize: config.maxSize || MAX_FILE_SIZE
    }
  });

  return [
    multerInstance.single(fieldName),
    validateUpload({
      maxFiles: 1,
      allowedTypes: ALLOWED_IMAGE_TYPES,
      maxSizePerFile: config.maxSize || MAX_FILE_SIZE,
      ...config
    }),
    processImageMiddleware,
    uploadToS3Middleware,
    handleLocalStorage,
    uploadErrorHandler,
    cleanupTempFiles
  ];
};

// Multiple images upload
const multipleImagesUpload = (fieldName = 'images', maxCount = 10, config = {}) => {
  const multerInstance = createMulterInstance(config.storage || 'local', {
    fileFilter: imageFileFilter,
    limits: {
      fileSize: config.maxSize || MAX_FILE_SIZE,
      files: maxCount
    }
  });

  return [
    multerInstance.array(fieldName, maxCount),
    validateUpload({
      maxFiles: maxCount,
      allowedTypes: ALLOWED_IMAGE_TYPES,
      maxSizePerFile: config.maxSize || MAX_FILE_SIZE,
      ...config
    }),
    processImageMiddleware,
    uploadToS3Middleware,
    handleLocalStorage,
    uploadErrorHandler,
    cleanupTempFiles
  ];
};

// User avatar upload
const userAvatarUpload = () => {
  return [
    (req, res, next) => {
      req.uploadConfig = {
        type: 'user_avatar',
        resize: true,
        maxWidth: 500,
        maxHeight: 500,
        convertToWebp: true,
        quality: 85
      };
      next();
    },
    ...singleImageUpload('avatar', {
      type: 'user_avatar',
      maxSize: 5 * 1024 * 1024 // 5MB
    })
  ];
};

// Photo upload (for photo gallery)
const photoUpload = (maxFiles = 10) => {
  return [
    (req, res, next) => {
      req.uploadConfig = {
        type: 'photo',
        resize: true,
        maxWidth: 1920,
        maxHeight: 1080,
        generateThumbnail: true,
        prefix: 'photos'
      };
      next();
    },
    ...multipleImagesUpload('files', maxFiles, {
      type: 'photo',
      maxSize: 20 * 1024 * 1024 // 20MB per photo
    })
  ];
};

// Document upload
const documentUpload = (fieldName = 'document') => {
  const multerInstance = createMulterInstance('local', {
    fileFilter: documentFileFilter,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB for documents
    }
  });

  return [
    multerInstance.single(fieldName),
    validateUpload({
      maxFiles: 1,
      allowedTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ],
      maxSizePerFile: 10 * 1024 * 1024
    }),
    uploadErrorHandler,
    cleanupTempFiles
  ];
};

/**
 * Utility function to get upload configuration
 */
const getUploadConfig = (type) => {
  const configs = {
    avatar: {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
      dimensions: { width: 500, height: 500 }
    },
    photo: {
      maxSize: 20 * 1024 * 1024, // 20MB
      allowedTypes: ALLOWED_IMAGE_TYPES,
      dimensions: { width: 1920, height: 1080 }
    },
    thumbnail: {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ALLOWED_IMAGE_TYPES,
      dimensions: { width: 400, height: 400 }
    },
    document: {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]
    }
  };

  return configs[type] || {};
};

/**
 * Generate file response object
 */
const generateFileResponse = (file, options = {}) => {
  const baseUrl = process.env.APP_URL || 'http://localhost:4600';
  
  return {
    filename: file.filename || file.originalname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    url: file.url || `${baseUrl}/uploads/${file.filename}`,
    thumbnailUrl: file.thumbnailUrl || null,
    path: file.path || null,
    storage: file.storage || 'local',
    metadata: file.metadata || {},
    uploadedAt: new Date().toISOString(),
    ...options
  };
};

export {
  // Multer instances
  createMulterInstance,
  
  // File filters
  imageFileFilter,
  documentFileFilter,
  
  // Middleware functions
  processImageMiddleware,
  uploadToS3Middleware,
  handleLocalStorage,
  validateUpload,
  uploadErrorHandler,
  cleanupTempFiles,
  
  // Preconfigured upload middlewares
  singleImageUpload,
  multipleImagesUpload,
  userAvatarUpload,
  photoUpload,
  documentUpload,
  
  // Utility functions
  getUploadConfig,
  generateFileResponse,
  
  // Constants
  MAX_FILE_SIZE,
  MAX_FILES,
  ALLOWED_IMAGE_TYPES
};