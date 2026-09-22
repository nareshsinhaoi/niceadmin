import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '../../../src/config/db.js';

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

// Admin Login
export const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required'
      });
    }

    const admin = await Prisma.ci_admin.findFirst({
      where: {
        email: email,
        is_active: 1
      }
    });

    if (!admin) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid credentials'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      {
        admin_id: admin.admin_id,
        role_id: admin.admin_role_id,
        is_admin: admin.is_admin,
        is_supper: admin.is_supper
      },
      process.env.JWT_SECRET || 'SECRET_KEY',
      { expiresIn: '1d' }
    );

    // Update login info
    await Prisma.ci_admin.update({
      where: { admin_id: admin.admin_id },
      data: {
        last_login: new Date(),
        token
      }
    });

    res.json({
      status: 'success',
      message: 'Login successful',
      token,
      admin: {
        admin_id: admin.admin_id,
        username: admin.username,
        firstname: admin.firstname,
        lastname: admin.lastname,
        email: admin.email,
        is_admin: admin.is_admin,
        is_supper: admin.is_supper
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

// Get admin list
export const getAdminList = async (req, res) => {
  try {
    const {
      search = '',
      role,
      status,
      page = 1,
      limit = 10
    } = req.query;

    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    const whereClause = {
      AND: [
        search
          ? {
            OR: [
              { firstname: { contains: search } },
              { lastname: { contains: search } },
              { email: { contains: search } }
            ]
          }
          : {},
        role ? { admin_role_id: parseInt(role) } : {},
        status !== undefined ? { is_active: parseInt(status) } : {}
      ]
    };

    const [admins, totalRecords] = await Promise.all([
      Prisma.ci_admin.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        orderBy: { admin_id: 'desc' },
        select: {
          admin_id: true,
          firstname: true,
          lastname: true,
          email: true,
          admin_role_id: true,
          is_active: true,
          is_supper: true,
          created_at: true
        }
      }),
      Prisma.ci_admin.count({ where: whereClause })
    ]);

    res.json({
      status: 'success',
      data: admins,
      pagination: {
        totalRecords,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalRecords / pageSize)
      }
    });

  } catch (error) {
    console.error('Get admin list error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

// Delete admin
export const deleteAdmin = async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);

    if (!adminId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid admin ID",
      });
    }

    const admin = await Prisma.ci_admin.findUnique({
      where: { admin_id: adminId },
    });

    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
      });
    }

    if (admin.is_supper === 1) {
      return res.status(403).json({
        status: "error",
        message: "Super admin cannot be deleted",
      });
    }

    // Soft delete
    await Prisma.ci_admin.update({
      where: { admin_id: adminId },
      data: {
        is_active: 0,
        updated_at: new Date(),
      },
    });

    return res.json({
      status: "success",
      message: "Admin disabled successfully",
    });

  } catch (error) {
    console.error("DELETE ADMIN ERROR:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

// Create admin
export const createAdmin = async (req, res) => {
  console.log("**createAdmin**")
  try {
    const { 
      firstname,
      lastname,
      email,
      mobile_no,
      password,
      admin_role_id,
      is_active,
    } = req.body;
    console.log( req.body )

    if (!email || !password) {
      return res.status(400).json({ 
        status: "error",
        message: "Email and password are required" 
      });
    }

    const exists = await Prisma.ci_admin.findFirst({
      where: { email },
    });

    if (exists) {
      return res.status(409).json({ 
        status: "error",
        message: "Email already exists" 
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const newAdmin = await Prisma.ci_admin.create({
      data: {
        username : "",
        image: "",
        firstname,
        lastname,
        email,
        mobile_no: mobile_no || '',
        password: hashed,
        admin_role_id: parseInt(admin_role_id) || 1,
        is_active: is_active ? parseInt(is_active) : 1,
        created_at: new Date(),
        updated_at: new Date(),
        last_login: new Date(),
        token: "",
        password_reset_code: "",
        last_ip: "",
      },
    });

    res.status(201).json({
      status: "success",
      message: "Admin created successfully",
      data: {
        admin_id: newAdmin.admin_id,
        firstname: newAdmin.firstname,
        lastname: newAdmin.lastname,
        email: newAdmin.email
      }
    });

  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ 
      status: "error",
      message: "Server error" 
    });
  }
};

// Update admin
export const updateAdmin = async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    const {
      firstname,
      lastname,
      email,
      mobile_no,
      admin_role_id,
      is_active,
    } = req.body;

    if (isNaN(adminId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid admin ID"
      });
    }

    const adminExists = await Prisma.ci_admin.findUnique({
      where: { admin_id: adminId }
    });

    if (!adminExists) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found"
      });
    }

    // Check if email is being changed and if new email already exists
    if (email && email !== adminExists.email) {
      const emailExists = await Prisma.ci_admin.findFirst({
        where: { 
          email,
          admin_id: { not: adminId }
        }
      });

      if (emailExists) {
        return res.status(409).json({
          status: "error",
          message: "Email already exists"
        });
      }
    }

    const updatedAdmin = await Prisma.ci_admin.update({
      where: { admin_id: adminId },
      data: {
        firstname: firstname || adminExists.firstname,
        lastname: lastname || adminExists.lastname,
        email: email || adminExists.email,
        mobile_no: mobile_no || adminExists.mobile_no,
        admin_role_id: admin_role_id ? parseInt(admin_role_id) : adminExists.admin_role_id,
        is_active: is_active !== undefined ? parseInt(is_active) : adminExists.is_active,
        updated_at: new Date(),
      },
    });

    res.json({
      status: "success",
      message: "Admin updated successfully",
      data: {
        admin_id: updatedAdmin.admin_id,
        firstname: updatedAdmin.firstname,
        lastname: updatedAdmin.lastname,
        email: updatedAdmin.email
      }
    });

  } catch (err) {
    console.error('Update admin error:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: "error",
        message: "Admin not found"
      });
    }
    
    res.status(500).json({ 
      status: "error",
      message: "Server error" 
    });
  }
};

// Get admin detail
export const getAdminDetail = async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    
    if (isNaN(adminId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid admin ID"
      });
    }

    const admin = await Prisma.ci_admin.findUnique({
      where: { admin_id: adminId },
      select: {
        admin_id: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        admin_role_id: true,
        is_active: true,
        is_supper: true,
        created_at: true,
        updated_at: true
      }
    });

    if (!admin) {
      return res.status(404).json({
        status: 'error',
        message: 'Admin not found'
      });
    }

    res.json({
      status: 'success',
      data: admin
    });

  } catch (error) {
    console.error('Get admin detail error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

// Role Management Controllers

// Get all roles
export const getRoles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'admin_role_created_on',
      sortOrder = 'desc',
      status = ''
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (search) {
      where.OR = [
        { admin_role_title: { contains: search } }
      ];
    }

    if (status !== '') {
      where.admin_role_status = parseInt(status);
    }

    const roles = await Prisma.ci_admin_roles.findMany({
      where,
      orderBy: { admin_role_id: sortOrder === 'asc' ? 'asc' : 'desc' },
      skip,
      take: limitNum,
      select: {
        admin_role_id: true,
        admin_role_title: true,
        admin_role_status: true,
        admin_role_created_by: true,
        admin_role_modified_by: true,
      }
    });

    const total = await Prisma.ci_admin_roles.count({ where });

    const formattedRoles = roles.map(role => ({
      id: role.admin_role_id,
      title: role.admin_role_title,
      status: role.admin_role_status,
      created_by: role.admin_role_created_by,
      modified_by: role.admin_role_modified_by
    }));

    res.json({
      status: 'success',
      data: formattedRoles,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch roles'
    });
  }
};

// Get single role by ID
export const getRoleById = async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    const formattedRole = {
      id: role.admin_role_id,
      title: role.admin_role_title,
      status: role.admin_role_status,
      created_by: role.admin_role_created_by,
      created_on: role.admin_role_created_on,
      modified_by: role.admin_role_modified_by,
      modified_on: role.admin_role_modified_on
    };

    res.json({
      status: 'success',
      data: formattedRole
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch role'
    });
  }
};

// Create new role
export const createRole = async (req, res) => {
  try {
    const {
      title,
      status = 1,
      created_by
    } = req.body;

    if (!title || !created_by) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and created_by are required'
      });
    }

    if (title.length > 30) {
      return res.status(400).json({
        status: 'error',
        message: 'Title must be 30 characters or less'
      });
    }

    const existingRole = await Prisma.ci_admin_roles.findFirst({
      where: { admin_role_title: title }
    });

    if (existingRole) {
      return res.status(409).json({
        status: 'error',
        message: 'Role with this title already exists'
      });
    }

    const now = new Date();
    const newRole = await Prisma.ci_admin_roles.create({
      data: {
        admin_role_title: title,
        admin_role_status: parseInt(status),
        admin_role_created_by: parseInt(created_by),
        admin_role_created_on: now,
        admin_role_modified_by: parseInt(created_by),
        admin_role_modified_on: now
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'Role created successfully',
      data: {
        id: newRole.admin_role_id,
        title: newRole.admin_role_title,
        status: newRole.admin_role_status
      }
    });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create role'
    });
  }
};

// Update role
export const updateRole = async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const {
      title,
      status,
      modified_by
    } = req.body;

    const existingRole = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!existingRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    if (title && title.length > 30) {
      return res.status(400).json({
        status: 'error',
        message: 'Title must be 30 characters or less'
      });
    }

    if (title && title !== existingRole.admin_role_title) {
      const duplicateRole = await Prisma.ci_admin_roles.findFirst({
        where: {
          admin_role_title: title,
          NOT: { admin_role_id: roleId }
        }
      });

      if (duplicateRole) {
        return res.status(409).json({
          status: 'error',
          message: 'Role with this title already exists'
        });
      }
    }

    const updatedRole = await Prisma.ci_admin_roles.update({
      where: { admin_role_id: roleId },
      data: {
        admin_role_title: title || existingRole.admin_role_title,
        admin_role_status: status !== undefined ? parseInt(status) : existingRole.admin_role_status,
        admin_role_modified_by: parseInt(modified_by),
        admin_role_modified_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Role updated successfully',
      data: {
        id: updatedRole.admin_role_id,
        title: updatedRole.admin_role_title,
        status: updatedRole.admin_role_status
      }
    });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update role'
    });
  }
};

// Delete role
export const deleteRole = async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const existingRole = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!existingRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    // Check if role is being used
    const userCount = await Prisma.ci_admin.count({
      where: { admin_role_id: roleId }
    });

    if (userCount > 0) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Cannot delete role that is assigned to users' 
      });
    }

    await Prisma.ci_admin_roles.delete({
      where: { admin_role_id: roleId }
    });

    res.json({
      status: 'success',
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete role'
    });
  }
};

// Toggle role status
export const toggleRoleStatus = async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    const updatedRole = await Prisma.ci_admin_roles.update({
      where: { admin_role_id: roleId },
      data: {
        admin_role_status: role.admin_role_status === 1 ? 0 : 1,
        admin_role_modified_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: `Role ${updatedRole.admin_role_status === 1 ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: updatedRole.admin_role_id,
        status: updatedRole.admin_role_status
      }
    });
  } catch (error) {
    console.error('Error toggling role status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update role status'
    });
  }
};

// Bulk update role status
export const bulkUpdateRoleStatus = async (req, res) => {
  try {
    const { role_ids, status } = req.body;

    if (!Array.isArray(role_ids) || role_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'role_ids array is required'
      });
    }

    if (status === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'status is required'
      });
    }

    const roleIds = role_ids.map(id => parseInt(id));
    const statusValue = parseInt(status);

    await Prisma.ci_admin_roles.updateMany({
      where: { admin_role_id: { in: roleIds } },
      data: {
        admin_role_status: statusValue,
        admin_role_modified_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: `Bulk status update completed for ${roleIds.length} role(s)`
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to perform bulk update'
    });
  }
};