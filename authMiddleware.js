// middleware/authMiddleware.js
// const { PrismaClient } = require('@prisma/client');
// const prisma = new PrismaClient();

import jwt from 'jsonwebtoken';
import { Prisma } from './src/config/db.js';

/**
 * JWT Authentication Middleware
 */
// export const authenticateToken = (req, res, next) => {
//   const authHeader = req.headers['authorization'];
//   const token = authHeader && authHeader.split(' ')[1];
//   console.error('JWT token:', token);
//   if (!token) {
//     return res.status(401).json({
//       status: 'error',
//       message: 'Access token required'
//     });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     console.error('JWT verification error:', err.message);
//     return res.status(403).json({
//       status: 'error',
//       message: 'Invalid or expired token'
//     });
//   }
// };

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  // console.log('Authorization header:', authHeader);
  // console.log('Token extracted:', token ? 'Yes' : 'No');
  
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Access token required'
    });
  }

  try {
    // Decode without verification first to check payload
    const decodedWithoutVerify = jwt.decode(token);
    // console.log('Decoded token payload:', decodedWithoutVerify);
    
    // Check if token is from future
    const currentTime = Math.floor(Date.now() / 1000);
    // console.log('Current time:', currentTime);
    
    // if (decodedWithoutVerify.iat > currentTime) {
    //   console.error('Token issued in the future!');
    //   console.error('Token iat:', decodedWithoutVerify.iat);
    //   console.error('Current time:', currentTime);
    //   console.error('Difference:', decodedWithoutVerify.iat - currentTime, 'seconds');
    // }
    
    // Now verify with secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // console.error('JWT verification error:', err.message);
    // console.error('Error name:', err.name);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({
        status: 'error',
        message: 'Token has expired',
        expiredAt: err.expiredAt
      });
    } else if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({
        status: 'error',
        message: 'Invalid token'
      });
    }
    
    return res.status(403).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
  }
};

/**
 * Verify admin role
 */
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

/**
 * Check specific permission
 * Optional: Middleware to check admin role/permissions
 */
 
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

/**
 * Optional authentication
 * Optional: Public routes that don't require authentication
 */ 
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