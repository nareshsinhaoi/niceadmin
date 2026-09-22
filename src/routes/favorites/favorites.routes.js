import express from 'express';

//import {addToFavorites,removeFromFavorites,getUserFavorites,checkFavoriteStatus} from '../controllers/favorites.controller.js';
//import * as userController from './user.controllers.js';

import { addToFavorites, removeFromFavorites, getUserFavorites, checkFavoriteStatus } from '../favorites/favorites.controller.js'
import { verifyAdmin, checkPermission, optionalAuth, authenticateToken } from '../../../authMiddleware.js'

const router = express.Router();




router.post('/add', authenticateToken, addToFavorites);
router.post('/remove/:assetId', authenticateToken, removeFromFavorites);
router.get('/my-favorites', authenticateToken, getUserFavorites);
router.get('/check/:assetId', authenticateToken , checkFavoriteStatus);

export default router;