import { Prisma } from '../../../src/config/db.js';

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )
    );
};

// Get all roles with pagination and filters
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

        // Fetch without date fields first
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
                // Exclude date fields temporarily
                // admin_role_created_on: true,
                // admin_role_modified_on: true
            }
        });

        const total = await Prisma.ci_admin_roles.count({ where });

        // Format response
        const formattedRoles = roles.map(role => ({
            id: role.admin_role_id,
            title: role.admin_role_title,
            status: role.admin_role_status,
            created_by: role.admin_role_created_by,
            modified_by: role.admin_role_modified_by
            // created_on: null, // Temporary
            // modified_on: null // Temporary
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

        // Format response
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

        // Validation
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

        // Check if role with same title exists
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

        // Check if role exists
        const existingRole = await Prisma.ci_admin_roles.findUnique({
            where: { admin_role_id: roleId }
        });

        if (!existingRole) {
            return res.status(404).json({
                status: 'error',
                message: 'Role not found'
            });
        }

        // Validation
        if (title && title.length > 30) {
            return res.status(400).json({
                status: 'error',
                message: 'Title must be 30 characters or less'
            });
        }

        // Check for duplicate title (excluding current role)
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

        // Check if role exists
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

// Get active roles for dropdowns
export const getActiveRoles = async (req, res) => {
    try {
        const roles = await Prisma.ci_admin_roles.findMany({
            where: { admin_role_status: 1 },
            orderBy: { admin_role_title: 'asc' },
            select: {
                admin_role_id: true,
                admin_role_title: true,
                admin_role_status: true
            }
        });

        const formattedRoles = roles.map(role => ({
            id: role.admin_role_id,
            title: role.admin_role_title,
            status: role.admin_role_status
        }));

        res.json({
            status: 'success',
            data: formattedRoles
        });
    } catch (error) {
        console.error('Error fetching active roles:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch active roles'
        });
    }
};

// Check role title availability
export const checkRoleTitle = async (req, res) => {
    try {
        const { title } = req.params;
        const { exclude_id } = req.query;

        const where = { admin_role_title: title };

        if (exclude_id) {
            where.admin_role_id = { not: parseInt(exclude_id) };
        }

        const existingRole = await Prisma.ci_admin_roles.findFirst({
            where
        });

        res.json({
            status: 'success',
            available: !existingRole,
            message: existingRole ? 'Role title already exists' : 'Role title is available'
        });
    } catch (error) {
        console.error('Error checking role title:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to check role title availability'
        });
    }
};

// Get role statistics
export const getRoleStatistics = async (req, res) => {
    try {
        const [totalRoles, activeRoles, inactiveRoles] = await Promise.all([
            Prisma.ci_admin_roles.count(),
            Prisma.ci_admin_roles.count({ where: { admin_role_status: 1 } }),
            Prisma.ci_admin_roles.count({ where: { admin_role_status: 0 } })
        ]);

        // Get roles with user counts
        const rolesWithCounts = await Prisma.ci_admin_roles.findMany({
            select: {
                admin_role_id: true,
                admin_role_title: true,
                admin_role_status: true,
                _count: {
                    select: {
                        ci_admin: true
                    }
                }
            },
            orderBy: { admin_role_title: 'asc' }
        });

        const formattedRoles = rolesWithCounts.map(role => ({
            id: role.admin_role_id,
            title: role.admin_role_title,
            status: role.admin_role_status,
            user_count: role._count.ci_admin
        }));

        res.json({
            status: 'success',
            data: {
                total_roles: totalRoles,
                active_roles: activeRoles,
                inactive_roles: inactiveRoles,
                roles: formattedRoles
            }
        });
    } catch (error) {
        console.error('Error fetching role statistics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch role statistics'
        });
    }
};