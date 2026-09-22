import express from 'express';
import {
  getActivityLogs,
  getActivityLogStats,
  getActivities,
  getActivityStats,
  getActivityById,
  getActivityStatistics,
  getRecentActivities,
  getTopActivities,
  getTopModules,
  getUserActivitySummary,
  exportActivityLogs
} from './activities.controllers.js';
//import { verifyAdmin } from '../../middleware/auth.js';
import { verifyAdmin, checkPermission, optionalAuth } from '../../../authMiddleware.js'
const router = express.Router();

// Activity Logs (pam_activity_log table)
router.get('/activity-logs', verifyAdmin, getActivityLogs);
router.get('/activity-logs/stats', verifyAdmin, getActivityLogStats);

// Activities (pam_activities table)
router.get('/', verifyAdmin, getActivities);
router.get('/stats', verifyAdmin, getActivityStats);
router.get('/:id', verifyAdmin, getActivityById);
router.get('/statistics/summary', verifyAdmin, getActivityStatistics);
router.get('/recent/list', verifyAdmin, getRecentActivities);
router.get('/top/activities', verifyAdmin, getTopActivities);
router.get('/top/modules', verifyAdmin, getTopModules);
router.get('/user/:user_id/summary', verifyAdmin, getUserActivitySummary);
router.get('/export/csv', verifyAdmin, exportActivityLogs);

export default router;