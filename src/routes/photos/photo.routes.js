import express from 'express';
import multer from 'multer';
import path from 'path';

import {
  // Photo listing and viewing
  getAllPhotos,
  getPhotoDetails,
  getPhotoFiles,
  getPhotoById,
  getPhotoByEncodedId,
  editPhoto,
  updateCoverPhoto,

  // Filtering and searching
  filterPhotos,
  searchPhotos,
  getPhotosByCategory,
  getPhotosBySubcategory,
  getPhotosByTag,
  getPhotosByAuthor,
  getPhotosByLocation,

  // User photos
  getMyPhotos,
  getUserPhotos,
  getUserUploadStats,

  // AUTO SUGGEST
  autosuggestPhotos, 

  // Photo management
  createPhoto, createUserPhoto, editPhotoAnySide, increaseDownload, downloadPhotoFile, downloadAllPhotoFiles, getRelatedPhotos, downloadMultipleGalleries,
  updatePhoto,
  deletePhoto, trashPhotoAlbum,
  togglePhotoStatus,
  restorePhoto, restorePhotoAdmin, restorePhotoFile,
  permanentlyDeletePhoto,

  // Photo files management
  addPhotoFiles, addAdminPhotoFiles,
  removePhotoFile, removePhotoFileByAdmin,
  updatePhotoFile,
  getPhotoFileDetails,

  // Tags and metadata
  addPhotoTags,
  removePhotoTag,
  getPhotoTags,
  updatePhotoMetadata,

  // Admin functions
  adminGetAllPhotos,
  adminUpdatePhotoDetails,
  adminBulkUpdatePhotos,
  adminBulkDeletePhotos,
  adminExportPhotos,

  // Statistics and analytics
  getPhotoStatistics,
  getPopularPhotos,
  getRecentPhotos,
  getPhotoTrends,

  // Photo downloads and interactions
  recordPhotoView,
  recordPhotoDownload,
  getPhotoInteractions,

  // Utility functions
  validatePhotoSlug, generatePhotoSlug, duplicatePhoto, mergePhotos,

  getAllCategories, getCategoryInfoBySlug, getPhotosByCategorySlug, getPhotosBySubcategorySlug


} from './photo.controllers.js';

import { verifyAdmin, checkPermission, optionalAuth , authenticateToken} from '../../../authMiddleware.js'
import { photoUpload, singleImageUpload, multipleImagesUpload, validateUpload } from '../../middleware/upload.js';


const router = express.Router();


// Configure multer for memory storage (for S3 uploads)
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Error: Images only!'));
  }
};

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 50, // Maximum 50 files
    fields: 100 // Maximum 100 form fields
  }
});

// ==================== PUBLIC ROUTES ====================

// Get all photos with pagination (public)
router.get('/', getAllPhotos);

// Filter photos (public)
router.get('/filter', filterPhotos);

// Search photos (public)
router.get('/search', searchPhotos);
router.get('/autosuggest', autosuggestPhotos);

// Get photo by encoded ID (public)
router.get('/encoded/:photo_id', getPhotoByEncodedId);

// Get photo details (public)
router.get('/:id', getPhotoById);

// Get photo files (public)
router.get('/:id/files', getPhotoFiles);

// Get related photos (public)
router.get('/:id/related', getRelatedPhotos);

// Get photo tags (public)
router.get('/:id/tags', getPhotoTags);

// Get photos by category (public)
router.get('/category/:categoryId', getPhotosByCategory);

// Get photos by subcategory (public)
router.get('/subcategory/:subcategoryId', getPhotosBySubcategory);

// Get photos by tag (public)
router.get('/tag/:tagName', getPhotosByTag);

// Get photos by author (public)
router.get('/author/:authorId', getPhotosByAuthor);

// Get photos by location (public)
//router.get('/location/:countryId/:stateId?/:cityId?', getPhotosByLocation);
// Location-based routes - FIXED VERSION
// router.get('/location/country/:countryId([0-9]+)', (req, res) => {
//   req.params.locationType = 'country';
//   req.params.locationId = req.params.countryId;
//   return getPhotosByLocation(req, res);
// });

// router.get('/location/state/:stateId([0-9]+)', (req, res) => {
//   req.params.locationType = 'state';
//   req.params.locationId = req.params.stateId;
//   return getPhotosByLocation(req, res);
// });

// router.get('/location/city/:cityId([0-9]+)', (req, res) => {
//   req.params.locationType = 'city';
//   req.params.locationId = req.params.cityId;
//   return getPhotosByLocation(req, res);
// });

// ==================== CATEGORY/SUBCATEGORY SLUG ROUTES ====================  api/photos/category/info
// Get all categories (public)
router.get('/categories/all', getAllCategories);
// Get category info by slug (public)
router.get('/category/info/:type/:slug', getCategoryInfoBySlug);
// Get photos by category slug (public) - URL: /category/[category-slug]
router.get('/category/slug/:category_slug', getPhotosByCategorySlug);
// Get photos by subcategory slug (public) - URL: /category/[category-slug]/[subcategory-slug]
router.get('/category/:category_slug/subcategory/:subcategory_slug', getPhotosBySubcategorySlug);
// Alternative cleaner URLs (optional - if you want direct routes without /slug/)
router.get('/by-category/:category_slug', getPhotosByCategorySlug);
router.get('/by-category/:category_slug/:subcategory_slug', getPhotosBySubcategorySlug);
//
// ==================== CATEGORY/SUBCATEGORY SLUG ROUTES ====================

// Get popular photos (public)
router.get('/popular/popular', getPopularPhotos);

// Get recent photos (public)
router.get('/recent/recent', getRecentPhotos);

// Record photo view (public, but optional auth for logged-in users)
router.post('/:id/view', optionalAuth, recordPhotoView);

// Validate photo slug (public)
router.get('/validate/slug/:slug', validatePhotoSlug);

// Generate photo slug (public)
router.post('/generate-slug', generatePhotoSlug);
router.post('/download-count/:photoId', authenticateToken, increaseDownload);
router.get('/download-file/:photoId/:fileId',   downloadPhotoFile);
router.get('/download-all/:photoId',  downloadAllPhotoFiles);
router.post('/download-multiple', authenticateToken, downloadMultipleGalleries);
// ==================== AUTHENTICATED USER ROUTES ====================

// Get user's own photos
router.get('/user/my-photos', authenticateToken, getMyPhotos);

// Get user upload statistics
router.get('/user/stats', authenticateToken, getUserUploadStats);

// Create new photo
router.post('/create', authenticateToken, verifyAdmin, upload.array('files', 50),  createPhoto); // Checked 

router.post('/user/upload', authenticateToken, upload.array('files', 50),  createUserPhoto); // Checked 


router.post('/edit-admin-photo', authenticateToken, verifyAdmin, upload.array('files', 50),  editPhotoAnySide);
router.post('/edit-user-photo', authenticateToken, upload.array('files', 50),  editPhotoAnySide);


// http://localhost:8011/api/photos/edit-photos/167351
router.get('/edit-photos/:id', authenticateToken, verifyAdmin, upload.array('files', 50),  editPhoto); // Checked : used in edit photo.

router.get('/edit/:id',  upload.array('files', 50),  editPhoto);   // <- NEW
//http://localhost:8011/api/photos/edit-photos/167355

// // http://localhost:8011/api/photos/set-cover-image/167351
router.put('/set-cover-image/:id', authenticateToken, verifyAdmin, updateCoverPhoto); // Checked : used in edit photo.

// router.put('/set-cover-image/:id', authenticateToken, updateCoverPhoto); 
// Update user's own photo
router.put('/:id/update', authenticateToken, verifyAdmin, updatePhoto); // Checked

router.put('/:id/webupdate', authenticateToken,  updatePhoto); // FOR WEBSITE

// Delete user's own photo (soft delete)
router.delete('/:id/delete', authenticateToken, verifyAdmin, deletePhoto);

// http://localhost:8011/api/photos/167358/trash
router.delete('/:id/trash-album', authenticateToken, trashPhotoAlbum);


// Add files to existing photo
router.post('/:id/files/add', authenticateToken, upload.array('files', 50), addPhotoFiles); // Checked : User need to add more file in S3
router.post('/:id/files/adminaddnew', authenticateToken, verifyAdmin, upload.array('files', 50), addAdminPhotoFiles);
// Remove file from photo
// http://localhost:8011/api/photos/167352/files/208210/remove
router.delete('/:id/files/:fileId/deleteitem', authenticateToken, verifyAdmin, removePhotoFileByAdmin);
router.delete('/:id/files/:fileId/remove', authenticateToken, verifyAdmin, removePhotoFile); // Checked
router.delete('/:id/files/:fileId/webremove', authenticateToken, removePhotoFile); // Checked

//http://localhost:8011/api/photos/167358/files/208232/restore-image
router.put('/:id/files/:file_id/restore-image', authenticateToken, restorePhotoFile);

// Update photo file details
router.put('/:id/files/:fileId/update', authenticateToken, updatePhotoFile);

// Add tags to photo
router.post('/:id/tags/add', authenticateToken, addPhotoTags);

// Remove tag from photo
router.delete('/:id/tags/:tagId/remove', authenticateToken, removePhotoTag);

// Update photo metadata
router.put('/:id/metadata/update', authenticateToken, updatePhotoMetadata);

// Duplicate photo
router.post('/:id/duplicate', authenticateToken, duplicatePhoto);

// Record photo download (authenticated only)
router.post('/:eid/files/:pid/download', authenticateToken, recordPhotoDownload);

// Get photo interactions
router.get('/:id/interactions', authenticateToken, getPhotoInteractions);

// Restore soft-deleted photo
router.post('/:id/restore', authenticateToken, restorePhoto);
router.post('/:id/files/:file_id/restoreitem', authenticateToken, verifyAdmin, restorePhotoAdmin);

// ==================== ADMIN ROUTES ====================
// Bulk activate photos
// http://localhost:8011/api/photos/admin/bulk-action/activate
// router.get('/admin/bulk-action/activate',  adminBulkUpdatePhotos);
// router.get('/admin/bulk-action/activate22',  adminBulkUpdatePhotos);
// http://localhost:8011/api/photos/admin/bulk-action/activate
// i/photos/admin/bulk-action/activate

router.patch('/admin/bulk-action/activate', authenticateToken, verifyAdmin, adminBulkUpdatePhotos);
router.patch('/admin/bulk-action/deactivate', authenticateToken, verifyAdmin, adminBulkUpdatePhotos);
router.patch('/admin/bulk-action/trash', authenticateToken, verifyAdmin, adminBulkUpdatePhotos); //soft delete
router.patch('/admin/bulk-action/restore', authenticateToken, verifyAdmin, adminBulkUpdatePhotos);
router.patch('/admin/bulk-action/delete', authenticateToken, verifyAdmin, adminBulkDeletePhotos);


// end Bulk =========
// Admin: Bulk delete photos
//router.delete('/admin/bulk-action/delete', authenticateToken, verifyAdmin, adminBulkDeletePhotos);

// http://localhost:8011/api/photos/admin/bulk-activate


// Admin: Get all photos with advanced filtering
router.get('/admin/all',  adminGetAllPhotos); //authenticateToken, verifyAdmin, &sortBy=created_at&sortOrder=desc&is_trash=0

// Admin: Update any photo details
router.put('/admin/:id/update', authenticateToken, verifyAdmin, adminUpdatePhotoDetails);

// Admin: Toggle photo status (active/inactive)
router.patch('/admin/:id/toggle-status', authenticateToken, verifyAdmin, togglePhotoStatus); // Checked (Toggle)

// Admin: Permanently delete photo
router.delete('/admin/:id/permanent-delete', authenticateToken, verifyAdmin, permanentlyDeletePhoto);

// Admin: Export photos data
router.get('/admin/export', authenticateToken, verifyAdmin, adminExportPhotos);

// Admin: Get photo statistics
router.get('/admin/statistics', authenticateToken, verifyAdmin, getPhotoStatistics);

// Admin: Get photo trends
router.get('/admin/trends', authenticateToken, verifyAdmin, getPhotoTrends);

// Admin: Merge photos
router.post('/admin/merge', authenticateToken, verifyAdmin, mergePhotos);

// ==================== UPLOAD ROUTES ====================

// Upload new photo with files (using our upload middleware)
router.post('/upload/new',
  authenticateToken,
  photoUpload(10), // Allow up to 10 files
  (req, res, next) => {
    // Attach upload configuration
    req.uploadConfig = {
      type: 'photo',
      prefix: 'photos',
      resize: true,
      maxWidth: 1920,
      maxHeight: 1080,
      generateThumbnail: true,
      quality: 85
    };
    next();
  },
  createPhoto
);

// Upload files to existing photo
router.post('/:id/upload/files', authenticateToken, multipleImagesUpload('files', 20, { maxSize: 50 * 1024 * 1024 }), addPhotoFiles );

// ==================== STATISTICS AND ANALYTICS ROUTES ====================

// Get overall photo statistics (public)
router.get('/statistics/overall', getPhotoStatistics);

// Get photo trends over time
// router.get('/trends/over-time/:period?', getPhotoTrends);

// Get most viewed photos
router.get('/statistics/most-viewed', getPopularPhotos);

// Get most downloaded photos
router.get('/statistics/most-downloaded', (req, res) => {
  // This would be implemented in the controller
  res.json({ message: 'Most downloaded photos endpoint' });
});

// Get photo activity
router.get('/:id/activity', authenticateToken, getPhotoInteractions);

// ==================== API DOCUMENTATION ROUTES ====================

// API documentation
router.get('/api/docs', (req, res) => {
  res.json({
    name: 'Photo Management API',
    version: '1.0.0',
    endpoints: {
      public: {
        'GET /api/photos': 'Get all photos with pagination',
        'GET /api/photos/filter': 'Filter photos by various criteria',
        'GET /api/photos/search': 'Search photos',
        'GET /api/photos/:id': 'Get photo details',
        'GET /api/photos/category/:categoryId': 'Get photos by category',
        'GET /api/photos/popular': 'Get popular photos',
        'GET /api/photos/recent': 'Get recent photos'
      },
      authenticated: {
        'GET /api/photos/user/my-photos': 'Get user\'s own photos',
        'POST /api/photos/create': 'Create new photo',
        'PUT /api/photos/:id/update': 'Update photo',
        'POST /api/photos/:id/files/add': 'Add files to photo',
        'POST /api/photos/:id/tags/add': 'Add tags to photo'
      },
      admin: {
        'GET /api/photos/admin/all': 'Admin: Get all photos',
        'PUT /api/photos/admin/:id/update': 'Admin: Update any photo',
        'DELETE /api/photos/admin/bulk-delete': 'Admin: Bulk delete photos',
        'GET /api/photos/admin/statistics': 'Admin: Get photo statistics'
      }
    }
  });
});

// Health check for photo service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'photo-service',
    timestamp: new Date().toISOString(),
    endpoints: {
      total: 40,
      public: 15,
      authenticated: 12,
      admin: 8,
      upload: 2,
      statistics: 3
    }
  });
});

export default router;