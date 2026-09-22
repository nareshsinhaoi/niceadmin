import express from 'express';
import {
  getCities,
  getCity,
  createCity,
  updateCity,
  deleteCity,
  getCityDetails,
  getCityStatus,
  updateCityStatus,
  searchCities, searchCitiesByName,
  getCitiesByState,
  getActiveCities,
  getCitiesCount,
  validateCitySlug,
  bulkUpdateCityStatus,
  bulkDeleteCities,
  toggleCityStatus
} from '../location/location.controllers.js';

import {verifyAdmin, checkPermission, optionalAuth} from '../../../authMiddleware.js'

const router = express.Router();

// Note: We need to handle both /api/cities and /api/city endpoints
// This router will handle /api/cities prefix Public routes

router.get('/', getCities);
router.get('/:id', getCity);
router.get('/active', getActiveCities);
router.get('/count', getCitiesCount);
router.get('/search', searchCities);
router.get('/by-state/:state_id', getCitiesByState);
router.patch('/:id/toggle-status', verifyAdmin, toggleCityStatus);
router.get('/validate-slug/:slug', validateCitySlug);
router.get('/view/:id', getCityDetails);
router.get('/status/:id', getCityStatus);
router.post('/create', verifyAdmin, createCity);
router.put('/update/:id', verifyAdmin, updateCity);
router.delete('/delete/:id', verifyAdmin, deleteCity);
router.patch('/status/update/:id', verifyAdmin, updateCityStatus);
router.post('/bulk-status-update', verifyAdmin, bulkUpdateCityStatus);
router.post('/bulk-delete', verifyAdmin, bulkDeleteCities);
router.get('/search/city', searchCitiesByName);


// City-specific routes (will be mounted under /city in main router)
// const cityRouter = express.Router();
// Public city routes
// cityRouter.get('/', (req, res) => res.redirect('/api/cities')); // Redirect to cities 
// cityRouter.get('/:id', getCity);

// cityRouter.get('/search', searchCities);
// cityRouter.get('/by-state/:state_id', getCitiesByState);
// cityRouter.get('/active', getActiveCities);   // api/cities/active
// cityRouter.get('/count', getCitiesCount);     // api/cities/count
// Admin protected city routes
// export { router as citiesRouter, cityRouter };

export default router;