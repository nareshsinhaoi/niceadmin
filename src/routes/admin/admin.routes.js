import express from 'express';
import { 
  loginAdmin,
  getAdminList,
  deleteAdmin,
  createAdmin,
  updateAdmin,
  getAdminDetail,
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  toggleRoleStatus,
  bulkUpdateRoleStatus
} from './admin.controllers.js';

//import { verifyAdmin, checkPermission } from '../../middleware/auth.js';
import {verifyAdmin, checkPermission, optionalAuth} from '../../../authMiddleware.js'
const router = express.Router();

// Admin authentication
router.post('/login', loginAdmin);

// Admin CRUD operations
router.get('/adminlist', verifyAdmin, getAdminList);
router.delete('/delete/:id', verifyAdmin, deleteAdmin);
router.post('/create', verifyAdmin, createAdmin);
router.put('/update/:id', verifyAdmin, updateAdmin);
router.get('/detail/:id', verifyAdmin, getAdminDetail);

// Role management
router.get('/roles', verifyAdmin, getRoles);
router.get('/roles/:id', verifyAdmin, getRoleById);
router.post('/roles/create', verifyAdmin, createRole);
router.put('/roles/:id/edit', verifyAdmin, updateRole);
router.delete('/roles/:id/delete', verifyAdmin, deleteRole);
router.patch('/roles/:id/toggle-status', verifyAdmin, toggleRoleStatus);
router.patch('/roles/bulk/update-status', verifyAdmin, bulkUpdateRoleStatus);

export default router;