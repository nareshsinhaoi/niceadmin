import express from 'express';
import {
  getTags,
  searchTags,
  createTag,
  updateTag,
  deleteTag,
  getTagById, getTagBySlug,
  getPopularTags,
  getTagStatistics,
  checkTagAvailability,
  bulkCreateTags,
  getTagsByPhoto,
  searchTagsByLetter
} from './tag.controllers.js';


import {verifyAdmin, checkPermission, optionalAuth} from '../../../authMiddleware.js'
const router = express.Router();

// Public routes
router.get('/', getTags);

router.get('/searchbyletter', searchTagsByLetter);
router.get('/search', searchTags);
router.get('/popular', getPopularTags);
router.get('/:id', getTagById);
router.get('/slug/:slug', getTagBySlug);
router.get('/check/:slug', checkTagAvailability);
router.get('/photo/:photo_id', getTagsByPhoto);
router.get('/statistics/summary', getTagStatistics);

// Admin/authenticated routes
// api/tags/create

router.post('/create', optionalAuth, createTag);
router.post('/', optionalAuth, createTag);
router.post('/bulk', verifyAdmin, bulkCreateTags);
router.put('/:id', verifyAdmin, updateTag);
router.delete('/:id', verifyAdmin, deleteTag);

export default router;