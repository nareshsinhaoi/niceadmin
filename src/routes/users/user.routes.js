
//import { authenticateToken } from '../../middleware/auth.js';
//import {verifyAdmin, checkPermission, optionalAuth} from '../../../authMiddleware.js'
import express from 'express';
import multer from 'multer';
import path from 'path';


import * as userController from './user.controllers.js';
//import { authenticateToken } from '../../middleware/auth.js';
import { verifyAdmin, checkPermission, optionalAuth, authenticateToken } from '../../../authMiddleware.js'


const router = express.Router();

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
// Helper middleware to parse body for multipart/form-data
const parseMultipartBody = (req, res, next) => {
  // If body is empty or not an object, try to parse it
  if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
    // For multipart/form-data, multer already populates req.body
    // But sometimes it comes as string, so we need to parse it
    if (req.body && typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
        console.log("Parsed body from string:", req.body);
      } catch (e) {
        console.log("Could not parse body as JSON, keeping as is");
      }
    }
  }
  next();
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


// Public routes
router.post('/login', userController.login);
//router.post('/create',  upload.single('photo') , userController.createUser);
router.post('/create', userController.createUser);
router.get('/verify-email', userController.verifyEmail);
router.put('/update/:id', authenticateToken, upload.single('photo'), parseMultipartBody, userController.updateUser);
router.put('/updateprofile/:id', authenticateToken, upload.single('photo'), userController.updateOwnAccount);
router.post('/change-password', authenticateToken, userController.changePassword);

router.post('/forgot-password', userController.forgotPassword);
router.post('/reset-password', userController.resetPassword);
router.post('/photos/share', authenticateToken, userController.photoShare);
router.post('/photos/share-bulk', authenticateToken, userController.bulkShareAssets);


// Protected routes (require authentication)
router.get('/allusers', authenticateToken, userController.getAllUsers);
router.get('/webusers', userController.getWebUsers); // authenticateToken,verifyAdmin, 
router.get('/:id', authenticateToken, userController.getUserById);
router.patch('/update-status/:id', authenticateToken, userController.updateUserStatus);
router.post('/', authenticateToken, userController.createTmpUser);


// Note: The PUT /update/:id route requires file upload middleware
// We'll handle this route separately in the main server file or create a middleware
// For now, we'll keep the route definition but the actual implementation might need adjustments

export default router;