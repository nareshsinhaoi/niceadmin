// dashboard.routes.js
import express from 'express';

import {
    getCategories,
    getStats,
    getRecentActivity,
    getTopPhotos,
    getSystemStatus,
    getCategoryDistribution
} from './dashboard.controllers.js';

import { verifyAdmin, checkPermission, optionalAuth } from '../../../authMiddleware.js'

const router = express.Router();

//
// Helper function to serialize BigInt
//

const serializeBigInt = (obj) => {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )
    );
};

router.get('/all-categories', getCategories);
router.get('/stats', getStats);
router.get('/recent-activity', getRecentActivity);
router.get('/top-photos', getTopPhotos);
router.get('/category-distribution', getCategoryDistribution);
router.get('/system-status', getSystemStatus);

export default router;