import express from 'express';
import {
  getStates,
  getState,
  createState,
  updateState,
  deleteState,
  toggleStateStatus,
  bulkUpdateStateStatus,
  getStatesByCountry,
  getActiveStates,
  validateSlug,
  countStates,
  searchStates,
  getStatesCount
} from '../location/location.controllers.js';
//import { verifyAdmin } from '../../middleware/auth.js';
import {verifyAdmin, checkPermission, optionalAuth} from '../../../authMiddleware.js'

const router = express.Router();

// Public routes
router.get('/', getStates);
router.get('/active/list', getActiveStates);
router.get('/:id', getState);
router.get('/country/:countryId', getStatesByCountry);
router.get('/validate/slug/:slug', validateSlug);
router.get('/count/total', getStatesCount);
router.get('/search/autocomplete', searchStates);
router.get('/stats/count', countStates);

// Admin protected routes
router.post('/', verifyAdmin, createState);
router.put('/:id', verifyAdmin, updateState);
router.delete('/:id', verifyAdmin, deleteState);
router.patch('/:id/toggle-status', verifyAdmin, toggleStateStatus);
router.patch('/bulk/update-status', verifyAdmin, bulkUpdateStateStatus);

export default router;