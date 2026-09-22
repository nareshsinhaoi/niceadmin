import express from 'express';
import {
  // Upload controllers
  uploadSingleImage,
  uploadMultipleImages,
  uploadPhotoWithDetails,
  uploadUserAvatar,
  uploadDocument,
  uploadToS3,
  uploadAndProcessImage,
  uploadPhotoWithThumbnail,
  
  // Utility controllers
  getUploadedFile,
  deleteUploadedFile,
  listUploadedFiles,
  getFileMetadata,
  updateFileMetadata,
  generateThumbnail,
  convertImageFormat,
  compressImage,
  extractExifData,
  
  // Admin upload controllers
  adminUploadPhotoFull,
  adminUploadPhotoSimple,
  adminBulkUpload,
  
  // Test controllers
  testUploadEndpoint,
  testS3Connection,
  testImageProcessing
} from './upload.controllers.js';

import {
  // Middleware
  singleImageUpload,
  multipleImagesUpload,
  userAvatarUpload,
  photoUpload,
  documentUpload,
  validateUpload,
  uploadErrorHandler
} from '../../middleware/upload.js';

//import { authenticateToken, verifyAdmin, checkPermission} from '../../middleware/auth.js';
import { verifyAdmin, checkPermission, optionalAuth, authenticateToken } from '../../../authMiddleware.js'


const router = express.Router();

// ==================== PUBLIC UPLOAD ROUTES ====================

// Simple image upload (public access)
router.post('/image', 
  singleImageUpload('image', {
    maxSize: 10 * 1024 * 1024 // 10MB
  }),
  uploadSingleImage
);

// Multiple images upload
router.post('/images', 
  multipleImagesUpload('images', 10, {
    maxSize: 10 * 1024 * 1024
  }),
  uploadMultipleImages
);

// Test endpoints
router.get('/test', testUploadEndpoint);
router.get('/test/s3', testS3Connection);
router.get('/test/image-processing', testImageProcessing);

// ==================== AUTHENTICATED USER ROUTES ====================

// User avatar upload (requires authentication)
router.post('/avatar', 
  authenticateToken,
  userAvatarUpload(),
  uploadUserAvatar
);

// User document upload
router.post('/document', 
  authenticateToken,
  documentUpload(),
  uploadDocument
);

// Upload photo with details
router.post('/photo', 
  authenticateToken,
  photoUpload(5),
  uploadPhotoWithDetails
);

// Upload to AWS S3 directly
router.post('/s3', 
  authenticateToken,
  singleImageUpload('file', {
    storage: 's3',
    prefix: 'user-uploads'
  }),
  uploadToS3
);

// Upload and process image (resize, compress, etc.)
router.post('/process', 
  authenticateToken,
  singleImageUpload('image', {
    resize: true,
    maxWidth: 1920,
    maxHeight: 1080,
    convertToWebp: true,
    quality: 85
  }),
  uploadAndProcessImage
);

// ==================== FILE MANAGEMENT ROUTES ====================

// Get uploaded file info
router.get('/file/:id', authenticateToken, getUploadedFile);

// Delete uploaded file
router.delete('/file/:id', authenticateToken, deleteUploadedFile);

// List user's uploaded files
router.get('/files', authenticateToken, listUploadedFiles);

// Get file metadata
router.get('/file/:id/metadata', authenticateToken, getFileMetadata);

// Update file metadata
router.put('/file/:id/metadata', authenticateToken, updateFileMetadata);

// Generate thumbnail for existing file
router.post('/file/:id/thumbnail', authenticateToken, generateThumbnail);

// Convert image format
router.post('/file/:id/convert', authenticateToken, convertImageFormat);

// Compress image
router.post('/file/:id/compress', authenticateToken, compressImage);

// Extract EXIF data
router.get('/file/:id/exif', authenticateToken, extractExifData);

// ==================== ADMIN UPLOAD ROUTES ====================

// Full photo upload with all details (admin only)
router.post('/admin/photo/full', 
  authenticateToken,
  verifyAdmin,
  (req, res, next) => {
    // Configure for admin photo upload
    req.uploadConfig = {
      type: 'admin-photo',
      prefix: 'admin/photos',
      resize: true,
      maxWidth: 1920,
      maxHeight: 1080,
      generateThumbnail: true,
      quality: 90
    };
    next();
  },
  multipleImagesUpload('files', 50, {
    maxSize: 50 * 1024 * 1024 // 50MB per file
  }),
  adminUploadPhotoFull
);

// Simple photo upload (admin)
router.post('/admin/photo/simple', 
  authenticateToken,
  verifyAdmin,
  adminUploadPhotoSimple
);

// Bulk upload with CSV/JSON (admin)
router.post('/admin/bulk-upload', 
  authenticateToken,
  verifyAdmin,
  singleImageUpload('file', {
    allowedTypes: [
      'text/csv',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    maxSize: 50 * 1024 * 1024
  }),
  adminBulkUpload
);

// Upload with thumbnail generation
router.post('/admin/photo/with-thumbnail', 
  authenticateToken,
  verifyAdmin,
  uploadPhotoWithThumbnail
);

// ==================== UTILITY ROUTES ====================

// Health check for upload service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'upload-service',
    storage: process.env.STORAGE_TYPE || 'local',
    maxFileSize: 50 * 1024 * 1024,
    allowedTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/tiff',
      'application/pdf',
      'text/csv',
      'application/json'
    ]
  });
});

// Get upload configuration
router.get('/config', authenticateToken, (req, res) => {
  const config = {
    maxFileSize: 50 * 1024 * 1024,
    maxFiles: 50,
    allowedImageTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/tiff'
    ],
    allowedDocumentTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/json'
    ],
    storage: {
      type: process.env.STORAGE_TYPE || 'local',
      s3Bucket: process.env.AWS_S3_BUCKET_NAME,
      localPath: 'public/uploads'
    },
    imageProcessing: {
      maxWidth: 1920,
      maxHeight: 1080,
      thumbnailWidth: 400,
      thumbnailHeight: 400,
      defaultQuality: 85,
      defaultFormat: 'webp'
    }
  };
  
  res.json({
    status: 'success',
    data: config
  });
});

// Error handling middleware for upload routes
router.use(uploadErrorHandler);

export default router;