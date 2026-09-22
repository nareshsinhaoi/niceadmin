import express from 'express';
import {
    getRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole,
    toggleRoleStatus,
    bulkUpdateRoleStatus,
    getActiveRoles
} from './role.controllers.js';
//import { verifyAdmin } from '../../middleware/auth.js';
import { verifyAdmin, checkPermission, optionalAuth } from '../../../authMiddleware.js'
const router = express.Router();

// Public routes (some might need admin protection depending on your requirements)
router.get('/', getRoles);
router.get('/active', getActiveRoles);
router.get('/:id', getRoleById);

// Admin protected routes
router.post('/', verifyAdmin, createRole);
router.put('/:id', verifyAdmin, updateRole);
router.delete('/:id', verifyAdmin, deleteRole);
router.patch('/:id/toggle-status', verifyAdmin, toggleRoleStatus);
router.patch('/bulk/update-status', verifyAdmin, bulkUpdateRoleStatus);

export default router;