import express from 'express';

import dashboardRoutes  from './dashboard/dashboard.routes.js';
import userRoutes from './users/user.routes.js';
import photoRoutes from './photos/photo.routes.js';
import adminRoutes from './admin/admin.routes.js';
import categoryRoutes from './categories/category.routes.js';
import uploadRoutes from './uploads/upload.routes.js';
import subcategoryRoutes from './subcategories/subcategory.routes.js';
//import countryRoutes from './countries/country.routes.js';
//import stateRoutes from './states/state.routes.js';
//import cityRoutes from './cities/city.routes.js';
import activityRoutes from './activities/activity.routes.js';
import roleRoutes from './roles/role.routes.js';
import tagRoutes from './tags/tag.routes.js';
import creditRoutes from './credits/credit.routes.js';
import countriesRoutes from './location/countries.routes.js';
import statesRoutes from './location/states.routes.js';
import cityRouter from './location/cities.routes.js';
 
import favoritesRoutes from './favorites/favorites.routes.js';
import pdfRoutes from './pdfs/pdf.routes.js'

const router = express.Router();

// API routes

router.use('/dashboard', dashboardRoutes);
router.use('/users', userRoutes);
router.use('/photos', photoRoutes);
router.use('/admin', adminRoutes);
router.use('/categories', categoryRoutes);
router.use('/subcategories', subcategoryRoutes);
//router.use('/countries', countryRoutes);
//router.use('/states', stateRoutes);
//router.use('/cities', cityRoutes);
router.use('/activity-logs', activityRoutes);
router.use('/roles', roleRoutes);
router.use('/tags', tagRoutes);
router.use('/credits', creditRoutes);
router.use('/upload', uploadRoutes);
router.use('/countries', countriesRoutes);
router.use('/states', statesRoutes);
router.use('/cities', cityRouter);
router.use('/city', cityRouter); // Note: This handles /api/city/* routes
router.use('/favorites', favoritesRoutes); 
router.use('/pdfs', pdfRoutes); 

// General routes
router.get('/api', (req, res) => {
  res.json({ "status": "error", message: "Direct access not allowed" });
});

// router.get('/menus', async (req, res) => {
//   // ... existing menu logic
// });

export default router;