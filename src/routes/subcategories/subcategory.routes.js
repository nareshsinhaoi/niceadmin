import express from 'express';
import {
  getSubcategories,
  getSubcategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  toggleSubcategoryStatus,
  bulkUpdateSubcategoryStatus,
  checkSlugAvailability
} from './subcategory.controllers.js';
import { verifyAdmin } from '../../../authMiddleware.js';

const router = express.Router();

// Public routes
router.get('/all', getSubcategories);
router.get('/:id', getSubcategory);
router.get('/check-slug/:slug', checkSlugAvailability);

// Protected routes (admin only)
router.post('/', verifyAdmin, createSubcategory);
router.put('/:id', verifyAdmin, updateSubcategory);
router.delete('/:id', verifyAdmin, deleteSubcategory);
router.patch('/:id/toggle-status', verifyAdmin, toggleSubcategoryStatus);
router.patch('/bulk/update-status', verifyAdmin, bulkUpdateSubcategoryStatus);

export default router;
