import express from 'express';
import {
  getCountries,
  getCountry,
  createCountry,
  updateCountry,
  deleteCountry,
  toggleCountryStatus,
  bulkUpdateCountryStatus,
  checkSlugAvailability,
  checkSortnameAvailability,
  getActiveCountries
} from '../location/location.controllers.js';
//import { verifyAdmin } from '../../middleware/auth.js';
import {verifyAdmin, checkPermission, optionalAuth} from '../../../authMiddleware.js'

const router = express.Router();

// Public routes
router.get('/', getCountries);
router.get('/active', getActiveCountries);
router.get('/:id', getCountry);
router.get('/check-slug/:slug', checkSlugAvailability);
router.get('/check-sortname/:sortname', checkSortnameAvailability);

// Admin protected routes
router.post('/', verifyAdmin, createCountry);
router.put('/:id', verifyAdmin, updateCountry);
router.delete('/:id', verifyAdmin, deleteCountry);
router.patch('/:id/toggle-status', verifyAdmin, toggleCountryStatus);
router.patch('/bulk/update-status', verifyAdmin, bulkUpdateCountryStatus);

export default router;