// middleware/authMiddleware.js
// const { PrismaClient } = require('@prisma/client');
// const prisma = new PrismaClient();

import { Prisma } from './src/config/db.js';

export const verifyAdmin = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication token required. Format: Bearer <token>'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Token is missing'
      });
    }

    // Find admin by token
    const admin = await Prisma.ci_admin.findFirst({
      where: { 
        token: token,
        is_active: 1 // Only active admins
      }
    });

    if (!admin) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token. Please login again.'
      });
    }

    // Attach admin to request object for use in routes
    req.admin = {
      admin_id: admin.admin_id,
      username: admin.username,
      email: admin.email,
      firstname: admin.firstname,
      lastname: admin.lastname,
      admin_role_id: admin.admin_role_id,
      is_supper: admin.is_supper
    };
    
    // Continue to the next middleware/route
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    // Handle specific Prisma errors
    if (error.name === 'PrismaClientKnownRequestError') {
      return res.status(500).json({
        status: 'error',
        message: 'Database error during authentication'
      });
    }
    
    return res.status(500).json({
      status: 'error',
      message: 'Authentication failed'
    });
  }
};

// Optional: Middleware to check admin role/permissions
export const checkPermission = (requiredRole = null) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required'
      });
    }

    // Super admin has all permissions
    if (req.admin.is_supper === 1) {
      return next();
    }

    // Check specific role if required
    if (requiredRole && req.admin.admin_role_id !== requiredRole) {
      return res.status(403).json({
        status: 'error',
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Optional: Public routes that don't require authentication
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      
      const admin = await Prisma.ci_admin.findFirst({
        where: { 
          token: token,
          is_active: 1
        }
      });

      if (admin) {
        req.admin = {
          admin_id: admin.admin_id,
          username: admin.username,
          email: admin.email,
          firstname: admin.firstname,
          lastname: admin.lastname,
          admin_role_id: admin.admin_role_id,
          is_supper: admin.is_supper
        };
      }
    }
    
    next();
  } catch (error) {
    // Don't block request for optional auth
    console.error('Optional auth error:', error);
    next();
  }
};

// module.exports = {
//   verifyAdmin,
//   checkPermission,
//   optionalAuth
// };