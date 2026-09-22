import express from 'express';
import {
    getActiveCredits,
    getAllCredits,
    getCreditById,
    createCredit,
    updateCredit,
    deleteCredit,
    toggleCreditStatus,
    searchCredits,
    getCreditStatistics,
    bulkUpdateCreditStatus
} from './credit.controllers.js';

import { verifyAdmin, checkPermission, optionalAuth } from '../../../authMiddleware.js'

const router = express.Router();

// Public routes
router.get('/active', getActiveCredits);
router.get('/search', searchCredits);
router.get('/:id', getCreditById);

// Admin routes
router.get('/', verifyAdmin, getAllCredits);
router.post('/', verifyAdmin, createCredit);
router.put('/:id', verifyAdmin, updateCredit);
router.delete('/:id', verifyAdmin, deleteCredit);
router.patch('/:id/toggle-status', verifyAdmin, toggleCreditStatus);
router.patch('/bulk/update-status', verifyAdmin, bulkUpdateCreditStatus);
router.get('/statistics/summary', verifyAdmin, getCreditStatistics); 

export default router;