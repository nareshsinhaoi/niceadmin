import { Prisma } from '../../../src/config/db.js';

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )
    );
};

// Get active credits (for dropdowns)
export const getActiveCredits = async (req, res) => {
    console.log("--- getActiveCredits ---");
    try {
        const credits = await Prisma.pam_credit.findMany({
            where: { is_active: 1, },
            orderBy: { id: 'desc', },
        });
        const otherOption = {
            id: 0,
            firstname: "Other",
            lastname: "",
            email: "",
            mobile_no: "",
            address: "",
            is_active: 1,
            created_at: null,
            updated_at: null,
        };
        //const results = [otherOption, ...credits];
        const results = [...credits, otherOption];
        res.json({
            status: 'success',
            totalRecords: credits.length,
            results,
        });
    } catch (err) {
        console.error('Get active credits error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch active credits',
        });
    }
};

// Get all credits with pagination and filters (admin only)
export const getAllCredits = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            status = '',
            sortBy = 'created_at',
            sortOrder = 'desc'
        } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const where = {};

        // Search filter
        if (search) {
            where.OR = [
                { firstname: { contains: search, mode: 'insensitive' } },
                { lastname: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { mobile_no: { contains: search, mode: 'insensitive' } }
            ];
        }

        // Status filter
        if (status !== '') {
            where.is_active = parseInt(status);
        }

        const total = await Prisma.pam_credit.count({ where });

        const credits = await Prisma.pam_credit.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: {
                [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc'
            },
            select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                mobile_no: true,
                address: true,
                is_active: true,
                created_at: true,
                updated_at: true
            }
        });

        res.json({
            status: 'success',
            data: credits,
            pagination: {
                current_page: pageNum,
                total_pages: Math.ceil(total / limitNum),
                total_items: total,
                items_per_page: limitNum
            }
        });
    } catch (err) {
        console.error('Get all credits error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch credits',
        });
    }
};

// Get credit by ID
export const getCreditById = async (req, res) => {
    try {
        const { id } = req.params;
        const creditId = parseInt(id);

        if (isNaN(creditId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid credit ID'
            });
        }

        // Handle "Other" option (id: 0)
        if (creditId === 0) {
            return res.json({
                status: 'success',
                data: {
                    id: 0,
                    firstname: "Other",
                    lastname: "",
                    email: "",
                    mobile_no: "",
                    address: "",
                    is_active: 1,
                    created_at: null,
                    updated_at: null
                }
            });
        }

        const credit = await Prisma.pam_credit.findUnique({
            where: { id: creditId }
        });

        if (!credit) {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        res.json({
            status: 'success',
            data: credit
        });
    } catch (err) {
        console.error('Get credit by ID error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch credit',
        });
    }
};

// Create new credit
export const createCredit = async (req, res) => {
    try {
        const {
            firstname,
            lastname,
            email,
            mobile_no,
            address,
            is_active = 1
        } = req.body;

        // Validation
        if (!firstname || !lastname) {
            return res.status(400).json({
                status: 'error',
                message: 'First name and last name are required'
            });
        }

        // Check if email already exists (if provided)
        if (email) {
            const existingEmail = await Prisma.pam_credit.findFirst({
                where: { email }
            });

            if (existingEmail) {
                return res.status(409).json({
                    status: 'error',
                    message: 'Email already exists'
                });
            }
        }

        const newCredit = await Prisma.pam_credit.create({
            data: {
                firstname: firstname.trim(),
                lastname: lastname.trim(),
                email: email ? email.trim() : '',
                mobile_no: mobile_no ? mobile_no.trim() : '',
                address: address ? address.trim() : '',
                is_active: parseInt(is_active),
                created_at: new Date(),
                updated_at: new Date()
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'Credit created successfully',
            data: newCredit
        });
    } catch (err) {
        console.error('Create credit error:', err);

        if (err.code === 'P2002') {
            return res.status(409).json({
                status: 'error',
                message: 'Duplicate entry found'
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to create credit',
        });
    }
};

// Update credit
export const updateCredit = async (req, res) => {
    try {
        const { id } = req.params;
        const creditId = parseInt(id);

        const {
            firstname,
            lastname,
            email,
            mobile_no,
            address,
            is_active
        } = req.body;

        if (isNaN(creditId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid credit ID'
            });
        }

        // Check if credit exists
        const existingCredit = await Prisma.pam_credit.findUnique({
            where: { id: creditId }
        });

        if (!existingCredit) {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        // Check if email already exists (if changing email)
        if (email && email !== existingCredit.email) {
            const emailExists = await Prisma.pam_credit.findFirst({
                where: {
                    email,
                    id: { not: creditId }
                }
            });

            if (emailExists) {
                return res.status(409).json({
                    status: 'error',
                    message: 'Email already exists'
                });
            }
        }

        const updateData = {
            updated_at: new Date()
        };

        if (firstname !== undefined) updateData.firstname = firstname.trim();
        if (lastname !== undefined) updateData.lastname = lastname.trim();
        if (email !== undefined) updateData.email = email.trim();
        if (mobile_no !== undefined) updateData.mobile_no = mobile_no.trim();
        if (address !== undefined) updateData.address = address.trim();
        if (is_active !== undefined) updateData.is_active = parseInt(is_active);

        const updatedCredit = await Prisma.pam_credit.update({
            where: { id: creditId },
            data: updateData
        });

        res.json({
            status: 'success',
            message: 'Credit updated successfully',
            data: updatedCredit
        });
    } catch (err) {
        console.error('Update credit error:', err);

        if (err.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        if (err.code === 'P2002') {
            return res.status(409).json({
                status: 'error',
                message: 'Duplicate entry found'
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to update credit',
        });
    }
};

// Delete credit
export const deleteCredit = async (req, res) => {
    try {
        const { id } = req.params;
        const creditId = parseInt(id);

        if (isNaN(creditId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid credit ID'
            });
        }

        const existingCredit = await Prisma.pam_credit.findUnique({
            where: { id: creditId }
        });

        if (!existingCredit) {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        // Check if credit is being used in photos
        const creditUsage = await Prisma.pam_photos.count({
            where: { credit: creditId }
        });

        if (creditUsage > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete credit that is being used in photos'
            });
        }

        await Prisma.pam_credit.delete({
            where: { id: creditId }
        });

        res.json({
            status: 'success',
            message: 'Credit deleted successfully'
        });
    } catch (err) {
        console.error('Delete credit error:', err);

        if (err.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to delete credit',
        });
    }
};

// Toggle credit status
export const toggleCreditStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const creditId = parseInt(id);

        if (isNaN(creditId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid credit ID'
            });
        }

        const credit = await Prisma.pam_credit.findUnique({
            where: { id: creditId }
        });

        if (!credit) {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        const updatedCredit = await Prisma.pam_credit.update({
            where: { id: creditId },
            data: {
                is_active: credit.is_active === 1 ? 0 : 1,
                updated_at: new Date()
            }
        });

        res.json({
            status: 'success',
            message: `Credit ${updatedCredit.is_active === 1 ? 'activated' : 'deactivated'} successfully`,
            data: updatedCredit
        });
    } catch (err) {
        console.error('Toggle credit status error:', err);

        if (err.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Credit not found'
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to toggle credit status',
        });
    }
};

// Search credits
export const searchCredits = async (req, res) => {
    try {
        const { q = '', limit = 20 } = req.query;

        if (!q || q.trim() === '') {
            return res.json({
                status: 'success',
                data: []
            });
        }

        const searchTerm = q.trim();

        const credits = await Prisma.pam_credit.findMany({
            where: {
                is_active: 1,
                OR: [
                    { firstname: { contains: searchTerm, mode: 'insensitive' } },
                    { lastname: { contains: searchTerm, mode: 'insensitive' } },
                    { email: { contains: searchTerm, mode: 'insensitive' } }
                ]
            },
            take: parseInt(limit),
            orderBy: {
                firstname: 'asc',
                lastname: 'asc'
            },
            select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                mobile_no: true
            }
        });

        res.json({
            status: 'success',
            data: credits
        });
    } catch (err) {
        console.error('Search credits error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to search credits',
        });
    }
};

// Get credit statistics
export const getCreditStatistics = async (req, res) => {
    try {
        const [totalCredits, activeCredits, inactiveCredits] = await Promise.all([
            Prisma.pam_credit.count(),
            Prisma.pam_credit.count({ where: { is_active: 1 } }),
            Prisma.pam_credit.count({ where: { is_active: 0 } })
        ]);

        // Get recently added credits
        const recentCredits = await Prisma.pam_credit.findMany({
            where: { is_active: 1 },
            orderBy: { created_at: 'desc' },
            take: 10,
            select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                created_at: true
            }
        });

        res.json({
            status: 'success',
            data: {
                total_credits: totalCredits,
                active_credits: activeCredits,
                inactive_credits: inactiveCredits,
                active_percentage: totalCredits > 0 ? ((activeCredits / totalCredits) * 100).toFixed(2) : 0,
                recent_credits: recentCredits
            }
        });
    } catch (err) {
        console.error('Get credit statistics error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch credit statistics',
        });
    }
};

// Bulk update credit status
export const bulkUpdateCreditStatus = async (req, res) => {
    try {
        const { credit_ids, status } = req.body;

        if (!Array.isArray(credit_ids) || credit_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'credit_ids array is required'
            });
        }

        if (status === undefined || (status !== 0 && status !== 1)) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid status (0 or 1) is required'
            });
        }

        const creditIds = credit_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        const updated = await Prisma.pam_credit.updateMany({
            where: { id: { in: creditIds } },
            data: {
                is_active: parseInt(status),
                updated_at: new Date()
            }
        });

        res.json({
            status: 'success',
            message: `${updated.count} credit${updated.count === 1 ? '' : 's'} ${status === '1' ? 'activated' : 'deactivated'} successfully`
        });
    } catch (err) {
        console.error('Bulk update credit status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update credit status in bulk',
        });
    }
};