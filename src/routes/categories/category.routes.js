import express from 'express';
import {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  getCategorySubcategories,
  getSubcategoriesCount,
  getMenu
} from './category.controllers.js';
// import {
//   getSubcategories,
//   getSubcategory,
//   createSubcategory,
//   updateSubcategory,
//   deleteSubcategory,
//   toggleSubcategoryStatus,
//   bulkUpdateSubcategoryStatus,
//   checkSlugAvailability
// } from './subcategory.controllers.js';

 
import { verifyAdmin, checkPermission, optionalAuth } from '../../../authMiddleware.js'

const router = express.Router();

router.get('/menu', getMenu);    // api/categories/menu 


// Category CRUD operations
router.get('/', getCategories);
router.get('/:id', getCategory);
router.post('/add', verifyAdmin, createCategory);
router.put('/:id', verifyAdmin, updateCategory);
router.delete('/:id', verifyAdmin, deleteCategory);
router.patch('/:id/toggle-status', verifyAdmin, toggleCategoryStatus);

// Subcategory operations
router.get('/:category_id/subcategories', getCategorySubcategories);
router.get('/:category_id/subcategories/count', getSubcategoriesCount);

// Subcategory-specific routes
// router.get('/subcategories/all', getSubcategories);
// router.get('/subcategories/:id', getSubcategory);
// router.post('/subcategories', verifyAdmin, createSubcategory);
// router.put('/subcategories/:id', verifyAdmin, updateSubcategory);
// router.delete('/subcategories/:id', verifyAdmin, deleteSubcategory);
// router.patch('/subcategories/:id/toggle-status', verifyAdmin, toggleSubcategoryStatus);
// router.patch('/subcategories/bulk/update-status', verifyAdmin, bulkUpdateSubcategoryStatus);
// router.get('/subcategories/check-slug/:slug', checkSlugAvailability);


export default router;