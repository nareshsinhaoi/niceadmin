import { Prisma } from '../../../src/config/db.js';

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )
    );
};

// ======================================
// COUNTRY CONTROLLERS
// ======================================

// Get all countries with pagination and filters
export const getCountries = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            sortBy = 'name',
            sortOrder = 'asc',
            status = ''
        } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const where = {};

        if (search) {
            where.OR = [
                { name: { contains: search } },
                { sortname: { contains: search } },
                { slug: { contains: search } }
            ];
        }

        if (status !== '') {
            where.status = parseInt(status);
        }

        const orderByClause = {};
        orderByClause[sortBy] = sortOrder;

        const total = await Prisma.pam_countries.count({ where });

        const countries = await Prisma.pam_countries.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: { [sortBy]: sortOrder },
        });

        res.json({
            status: 'success',
            data: serializeBigInt(countries),
            pagination: {
                current_page: pageNum,
                total_pages: Math.ceil(total / limitNum),
                total_items: total,
                items_per_page: limitNum
            }
        });
    } catch (err) {
        console.error('Get countries error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch countries',
        });
    }
};

// Get single country by ID
export const getCountry = async (req, res) => {
    try {
        const { id } = req.params;
        const country = await Prisma.pam_countries.findUnique({
            where: { id: parseInt(id) },
        });

        if (!country) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        res.json({
            status: 'success',
            data: serializeBigInt(country),
        });
    } catch (err) {
        console.error('Get country error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch country',
        });
    }
};

// Create new country
export const createCountry = async (req, res) => {
    try {
        const { sortname, name, slug, phonecode, status = 1 } = req.body;

        if (!sortname || !name || !slug || !phonecode) {
            return res.status(400).json({
                status: 'error',
                message: 'Sortname, name, slug, and phonecode are required',
            });
        }

        if (sortname.length > 3) {
            return res.status(400).json({
                status: 'error',
                message: 'Sortname must be 3 characters or less',
            });
        }

        if (isNaN(parseInt(phonecode))) {
            return res.status(400).json({
                status: 'error',
                message: 'Phonecode must be a valid number',
            });
        }

        const existingCountry = await Prisma.pam_countries.findFirst({
            where: { slug },
        });

        if (existingCountry) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug already exists. Please use a different slug.',
            });
        }

        const existingSortname = await Prisma.pam_countries.findFirst({
            where: { sortname },
        });

        if (existingSortname) {
            return res.status(400).json({
                status: 'error',
                message: 'Sortname already exists. Please use a different sortname.',
            });
        }

        const country = await Prisma.pam_countries.create({
            data: {
                sortname: sortname.toUpperCase(),
                name: name.trim(),
                slug: slug.trim(),
                phonecode: parseInt(phonecode),
                status: parseInt(status),
            },
        });

        res.status(201).json({
            status: 'success',
            message: 'Country created successfully',
            data: serializeBigInt(country),
        });
    } catch (err) {
        console.error('Create country error:', err);

        if (err.code === 'P2002') {
            return res.status(400).json({
                status: 'error',
                message: 'A country with this slug or sortname already exists',
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to create country',
        });
    }
};

// Update country
export const updateCountry = async (req, res) => {
    try {
        const { id } = req.params;
        const { sortname, name, slug, phonecode, status } = req.body;

        const existingCountry = await Prisma.pam_countries.findUnique({
            where: { id: parseInt(id) },
        });

        if (!existingCountry) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        if (sortname && sortname.length > 3) {
            return res.status(400).json({
                status: 'error',
                message: 'Sortname must be 3 characters or less',
            });
        }

        if (phonecode && isNaN(parseInt(phonecode))) {
            return res.status(400).json({
                status: 'error',
                message: 'Phonecode must be a valid number',
            });
        }

        if (slug && slug !== existingCountry.slug) {
            const slugExists = await Prisma.pam_countries.findFirst({
                where: {
                    slug,
                    id: { not: parseInt(id) }
                },
            });

            if (slugExists) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Slug already exists. Please use a different slug.',
                });
            }
        }

        if (sortname && sortname !== existingCountry.sortname) {
            const sortnameExists = await Prisma.pam_countries.findFirst({
                where: {
                    sortname: sortname.toUpperCase(),
                    id: { not: parseInt(id) }
                },
            });

            if (sortnameExists) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Sortname already exists. Please use a different sortname.',
                });
            }
        }

        const updateData = {};

        if (sortname !== undefined) updateData.sortname = sortname.toUpperCase();
        if (name !== undefined) updateData.name = name.trim();
        if (slug !== undefined) updateData.slug = slug.trim();
        if (phonecode !== undefined) updateData.phonecode = parseInt(phonecode);
        if (status !== undefined) updateData.status = parseInt(status);

        const updatedCountry = await Prisma.pam_countries.update({
            where: { id: parseInt(id) },
            data: updateData,
        });

        res.json({
            status: 'success',
            message: 'Country updated successfully',
            data: serializeBigInt(updatedCountry),
        });
    } catch (err) {
        console.error('Update country error:', err);

        if (err.code === 'P2002') {
            return res.status(400).json({
                status: 'error',
                message: 'A country with this slug or sortname already exists',
            });
        }

        if (err.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to update country',
        });
    }
};

// Delete country
export const deleteCountry = async (req, res) => {
    try {
        const { id } = req.params;

        const country = await Prisma.pam_countries.findUnique({
            where: { id: parseInt(id) },
        });

        if (!country) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        await Prisma.pam_countries.delete({
            where: { id: parseInt(id) },
        });

        res.json({
            status: 'success',
            message: 'Country deleted successfully',
        });
    } catch (err) {
        console.error('Delete country error:', err);

        if (err.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to delete country',
        });
    }
};

// Toggle country status
export const toggleCountryStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const country = await Prisma.pam_countries.findUnique({
            where: { id: parseInt(id) },
        });

        if (!country) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        const newStatus = country.status === 1 ? 0 : 1;

        const updatedCountry = await Prisma.pam_countries.update({
            where: { id: parseInt(id) },
            data: {
                status: newStatus,
            },
        });

        res.json({
            status: 'success',
            message: `Country ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`,
            data: serializeBigInt(updatedCountry),
        });
    } catch (err) {
        console.error('Toggle country status error:', err);

        if (err.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found',
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to toggle country status',
        });
    }
};

// Bulk update countries status
export const bulkUpdateCountryStatus = async (req, res) => {
    try {
        const { country_ids, status } = req.body;

        if (!Array.isArray(country_ids) || country_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Please provide country IDs',
            });
        }

        if (status === undefined || (status !== 0 && status !== 1)) {
            return res.status(400).json({
                status: 'error',
                message: 'Please provide valid status (0 or 1)',
            });
        }

        const updated = await Prisma.pam_countries.updateMany({
            where: {
                id: { in: country_ids.map(id => parseInt(id)) }
            },
            data: {
                status: parseInt(status),
            },
        });

        res.json({
            status: 'success',
            message: `${updated.count} countr${updated.count === 1 ? 'y' : 'ies'} ${status === 1 ? 'activated' : 'deactivated'} successfully`,
            count: updated.count,
        });
    } catch (err) {
        console.error('Bulk update countries status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update countries status',
        });
    }
};

// Check slug availability
export const checkSlugAvailability = async (req, res) => {
    try {
        const { slug } = req.params;
        const { exclude_id } = req.query;

        const where = { slug };

        if (exclude_id) {
            where.id = { not: parseInt(exclude_id) };
        }

        const existing = await Prisma.pam_countries.findFirst({
            where,
        });

        res.json({
            status: 'success',
            available: !existing,
            message: existing ? 'Slug already exists' : 'Slug is available'
        });
    } catch (err) {
        console.error('Check slug error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to check slug availability',
        });
    }
};

// Check sortname availability
export const checkSortnameAvailability = async (req, res) => {
    try {
        const { sortname } = req.params;
        const { exclude_id } = req.query;

        const where = { sortname: sortname.toUpperCase() };

        if (exclude_id) {
            where.id = { not: parseInt(exclude_id) };
        }

        const existing = await Prisma.pam_countries.findFirst({
            where,
        });

        res.json({
            status: 'success',
            available: !existing,
            message: existing ? 'Sortname already exists' : 'Sortname is available'
        });
    } catch (err) {
        console.error('Check sortname error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to check sortname availability',
        });
    }
};

// Get active countries list (for dropdowns)
export const getActiveCountries = async (req, res) => {
    try {
        const countries = await Prisma.pam_countries.findMany({
            where: { status: 1 },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                sortname: true,
                name: true,
                phonecode: true
            }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(countries),
        });
    } catch (err) {
        console.error('Get active countries error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch active countries',
        });
    }
};

// ======================================
// STATE CONTROLLERS
// ======================================

// Get all states with pagination and filters
export const getStates = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            sortBy = 'name',
            sortOrder = 'asc',
            status = '',
            country_id = ''
        } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        const where = {};

        if (search && search.trim() !== '') {
            const searchTerm = search.trim();
            where.OR = [
                { name: { contains: searchTerm } },
                { slug: { contains: searchTerm } }
            ];
        }

        if (status !== '' && !isNaN(parseInt(status))) {
            where.status = parseInt(status);
        }

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.country_id = parseInt(country_id);
        }

        const validSortColumns = ['id', 'name', 'slug', 'country_id', 'status'];
        const actualSortBy = validSortColumns.includes(sortBy) ? sortBy : 'name';

        const orderBy = {};
        orderBy[actualSortBy] = sortOrder.toLowerCase() === 'desc' ? 'desc' : 'asc';

        const total = await Prisma.pam_states.count({ where });

        const states = await Prisma.pam_states.findMany({
            where,
            include: {
                country: {
                    select: {
                        id: true,
                        name: true,
                        sortname: true
                    }
                }
            },
            skip,
            take: limitNum,
            orderBy
        });

        res.json({
            status: 'success',
            data: serializeBigInt(states),
            pagination: {
                current_page: pageNum,
                total_pages: Math.ceil(total / limitNum),
                total_items: total,
                items_per_page: limitNum
            }
        });
    } catch (err) {
        console.error('Get states error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch states',
            error: err.message
        });
    }
};

// Get single state by ID
export const getState = async (req, res) => {
    try {
        const { id } = req.params;
        const stateId = parseInt(id);

        if (isNaN(stateId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid state ID'
            });
        }

        const state = await Prisma.pam_states.findUnique({
            where: { id: stateId },
            include: {
                country: {
                    select: {
                        id: true,
                        name: true,
                        sortname: true
                    }
                }
            }
        });

        if (!state) {
            return res.status(404).json({
                status: 'error',
                message: 'State not found'
            });
        }

        res.json({
            status: 'success',
            data: serializeBigInt(state)
        });
    } catch (err) {
        console.error('Get state by ID error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch state',
            error: err.message
        });
    }
};

// Create new state
export const createState = async (req, res) => {
    try {
        const { name, slug, country_id, status = 1 } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'State name is required'
            });
        }

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug is required'
            });
        }

        if (!country_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Country is required'
            });
        }

        const countryExists = await Prisma.pam_countries.findUnique({
            where: { id: parseInt(country_id) }
        });

        if (!countryExists) {
            return res.status(400).json({
                status: 'error',
                message: 'Country does not exist'
            });
        }

        const existingState = await Prisma.pam_states.findFirst({
            where: {
                name: name.trim(),
                country_id: parseInt(country_id)
            }
        });

        if (existingState) {
            return res.status(400).json({
                status: 'error',
                message: 'State with this name already exists in this country'
            });
        }

        const existingSlug = await Prisma.pam_states.findFirst({
            where: { slug: slug.trim().toLowerCase() }
        });

        if (existingSlug) {
            return res.status(400).json({
                status: 'error',
                message: 'State with this slug already exists'
            });
        }

        const state = await Prisma.pam_states.create({
            data: {
                name: name.trim(),
                slug: slug.trim().toLowerCase(),
                country_id: parseInt(country_id),
                status: parseInt(status)
            },
            include: {
                country: {
                    select: {
                        id: true,
                        name: true,
                        sortname: true
                    }
                }
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'State created successfully',
            data: serializeBigInt(state)
        });
    } catch (err) {
        console.error('Create state error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create state',
            error: err.message
        });
    }
};

// Update state
export const updateState = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug, country_id, status } = req.body;
        const stateId = parseInt(id);

        if (isNaN(stateId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid state ID'
            });
        }

        const existingState = await Prisma.pam_states.findUnique({
            where: { id: stateId }
        });

        if (!existingState) {
            return res.status(404).json({
                status: 'error',
                message: 'State not found'
            });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'State name is required'
            });
        }

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug is required'
            });
        }

        if (!country_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Country is required'
            });
        }

        const countryExists = await Prisma.pam_countries.findUnique({
            where: { id: parseInt(country_id) }
        });

        if (!countryExists) {
            return res.status(400).json({
                status: 'error',
                message: 'Country does not exist'
            });
        }

        const duplicateName = await Prisma.pam_states.findFirst({
            where: {
                name: name.trim(),
                country_id: parseInt(country_id),
                id: { not: stateId }
            }
        });

        if (duplicateName) {
            return res.status(400).json({
                status: 'error',
                message: 'Another state with this name already exists in this country'
            });
        }

        const duplicateSlug = await Prisma.pam_states.findFirst({
            where: {
                slug: slug.trim().toLowerCase(),
                id: { not: stateId }
            }
        });

        if (duplicateSlug) {
            return res.status(400).json({
                status: 'error',
                message: 'Another state with this slug already exists'
            });
        }

        const updatedState = await Prisma.pam_states.update({
            where: { id: stateId },
            data: {
                name: name.trim(),
                slug: slug.trim().toLowerCase(),
                country_id: parseInt(country_id),
                status: status !== undefined ? parseInt(status) : existingState.status
            },
            include: {
                country: {
                    select: {
                        id: true,
                        name: true,
                        sortname: true
                    }
                }
            }
        });

        res.json({
            status: 'success',
            message: 'State updated successfully',
            data: serializeBigInt(updatedState)
        });
    } catch (err) {
        console.error('Update state error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update state',
            error: err.message
        });
    }
};

// Delete state
export const deleteState = async (req, res) => {
    try {
        const { id } = req.params;
        const stateId = parseInt(id);

        if (isNaN(stateId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid state ID'
            });
        }

        const state = await Prisma.pam_states.findUnique({
            where: { id: stateId },
            include: {
                cities: {
                    take: 1
                }
            }
        });

        if (!state) {
            return res.status(404).json({
                status: 'error',
                message: 'State not found'
            });
        }

        if (state.cities && state.cities.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete state. It has associated cities.'
            });
        }

        await Prisma.pam_states.delete({
            where: { id: stateId }
        });

        res.json({
            status: 'success',
            message: 'State deleted successfully'
        });
    } catch (err) {
        console.error('Delete state error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete state',
            error: err.message
        });
    }
};

// Toggle state status
export const toggleStateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const stateId = parseInt(id);

        if (isNaN(stateId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid state ID'
            });
        }

        const state = await Prisma.pam_states.findUnique({
            where: { id: stateId }
        });

        if (!state) {
            return res.status(404).json({
                status: 'error',
                message: 'State not found'
            });
        }

        const updatedState = await Prisma.pam_states.update({
            where: { id: stateId },
            data: {
                status: state.status === 1 ? 0 : 1
            },
            include: {
                country: {
                    select: {
                        id: true,
                        name: true,
                        sortname: true
                    }
                }
            }
        });

        res.json({
            status: 'success',
            message: `State ${updatedState.status === 1 ? 'activated' : 'deactivated'} successfully`,
            data: serializeBigInt(updatedState)
        });
    } catch (err) {
        console.error('Toggle state status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to toggle state status',
            error: err.message
        });
    }
};

// Bulk update state status
export const bulkUpdateStateStatus = async (req, res) => {
    try {
        const { state_ids, status } = req.body;

        if (!state_ids || !Array.isArray(state_ids) || state_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'state_ids array is required'
            });
        }

        if (status === undefined || ![0, 1].includes(parseInt(status))) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid status (0 or 1) is required'
            });
        }

        const stateIdsNum = state_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        await Prisma.pam_states.updateMany({
            where: {
                id: {
                    in: stateIdsNum
                }
            },
            data: {
                status: parseInt(status)
            }
        });

        res.json({
            status: 'success',
            message: `${stateIdsNum.length} state${stateIdsNum.length === 1 ? '' : 's'} ${status === '1' ? 'activated' : 'deactivated'} successfully`
        });
    } catch (err) {
        console.error('Bulk update state status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update state status in bulk',
            error: err.message
        });
    }
};

// Get states by country ID
export const getStatesByCountry = async (req, res) => {
    try {
        const { countryId } = req.params;
        const { status = '1' } = req.query;

        const countryIdNum = parseInt(countryId);
        if (isNaN(countryIdNum)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid country ID'
            });
        }

        const countryExists = await Prisma.pam_countries.findUnique({
            where: { id: countryIdNum }
        });

        if (!countryExists) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found'
            });
        }

        const where = {
            country_id: countryIdNum
        };

        if (status !== '' && !isNaN(parseInt(status))) {
            where.status = parseInt(status);
        }

        const states = await Prisma.pam_states.findMany({
            where,
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                country_id: true
            }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(states)
        });
    } catch (err) {
        console.error('Get states by country error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch states by country',
            error: err.message
        });
    }
};

// Get active states only
export const getActiveStates = async (req, res) => {
    try {
        const { country_id = '' } = req.query;

        const where = {
            status: 1
        };

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.country_id = parseInt(country_id);
        }

        const states = await Prisma.pam_states.findMany({
            where,
            include: {
                country: {
                    select: {
                        id: true,
                        name: true,
                        sortname: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(states)
        });
    } catch (err) {
        console.error('Get active states error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch active states',
            error: err.message
        });
    }
};

// Validate state slug
export const validateSlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const { exclude_id = '' } = req.query;

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug is required'
            });
        }

        const where = {
            slug: slug.trim().toLowerCase()
        };

        if (exclude_id !== '' && !isNaN(parseInt(exclude_id))) {
            where.id = { not: parseInt(exclude_id) };
        }

        const existingState = await Prisma.pam_states.findFirst({
            where
        });

        res.json({
            status: 'success',
            data: {
                is_unique: !existingState,
                message: existingState ? 'Slug already exists' : 'Slug is available'
            }
        });
    } catch (err) {
        console.error('Validate slug error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to validate slug',
            error: err.message
        });
    }
};

// Count total states
export const countStates = async (req, res) => {
    try {
        const { status = '' } = req.query;
        const where = {};
        if (status !== '' && !isNaN(parseInt(status))) {
            where.status = parseInt(status);
        }
        const total = await Prisma.pam_states.count({ where });
        const active = await Prisma.pam_states.count({ where: { status: 1 } });
        const inactive = await Prisma.pam_states.count({ where: { status: 0 } });
        res.json({
            status: 'success',
            data: {
                total,
                active,
                inactive
            }
        });
    } catch (err) {
        console.error('Count states error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to count states',
            error: err.message
        });
    }
};

// Search states by name (autocomplete)
export const searchStates = async (req, res) => {
    try {
        const { q = '', limit = 10, country_id = '' } = req.query;

        if (!q || q.trim() === '') {
            return res.json({
                status: 'success',
                data: []
            });
        }

        const where = {
            OR: [
                { name: { contains: q.trim() } },
                { slug: { contains: q.trim() } }
            ],
            status: 1
        };

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.country_id = parseInt(country_id);
        }

        const states = await Prisma.pam_states.findMany({
            where,
            take: parseInt(limit) || 10,
            select: {
                id: true,
                name: true,
                slug: true,
                country_id: true
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(states)
        });
    } catch (err) {
        console.error('Search states autocomplete error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to search states',
            error: err.message
        });
    }
};

// Get states count (alias for backward compatibility)
export const getStatesCount = countStates;

// ======================================
// CITY CONTROLLERS
// ======================================

// Get all cities with pagination and filters
export const getCities = async (req, res) => {
    console.log("I am in getCities");
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            sortBy = 'name',
            sortOrder = 'asc',
            status = '',
            state_id = '',
            country_id = ''
        } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        const where = {}; 

        // Add condition: state_id > 42
        where.state_id = {
            lt: 42
        };

        if (search && search.trim() !== '') {
            const searchTerm = search.trim();
            where.OR = [
                { name: { contains: searchTerm } },
                { slug: { contains: searchTerm } }
            ];
        }

        if (status !== '' && !isNaN(parseInt(status))) {
            where.status = parseInt(status);
        }

        if (state_id !== '' && !isNaN(parseInt(state_id))) {
            where.state_id = parseInt(state_id);
        }

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.state = {
                country_id: parseInt(country_id)
            };
        }

        const total = await Prisma.pam_cities.count({ where });

        const cities = await Prisma.pam_cities.findMany({
            where,
            include: {
                state: {
                    include: {
                        country: {
                            select: {
                                id: true,
                                name: true,
                                sortname: true
                            }
                        }
                    }
                }
            },
            skip,
            take: limitNum,
            orderBy: { [sortBy]: sortOrder }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(cities),
            pagination: {
                current_page: pageNum,
                total_pages: Math.ceil(total / limitNum),
                total_items: total,
                items_per_page: limitNum
            }
        });
    } catch (err) {
        console.error('Get cities error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch cities',
            error: err.message
        });
    }
};

// Get single city by ID
export const getCity = async (req, res) => {
    console.log("getCity location Controller")
    try {
        const { id } = req.params;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        const city = await Prisma.pam_cities.findUnique({
            where: { id: cityId },
            include: {
                state: {
                    include: {
                        country: {
                            select: {
                                id: true,
                                name: true,
                                sortname: true
                            }
                        }
                    }
                }
            }
        });

        if (!city) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        res.json({
            status: 'success',
            data: serializeBigInt(city)
        });
    } catch (err) {
        console.error('Get city for edit error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch city data',
            error: err.message
        });
    }
};

// Create new city
export const createCity = async (req, res) => {
    try {
        const { name, slug, state_id, status = 1 } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'City name is required'
            });
        }

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug is required'
            });
        }

        if (!state_id) {
            return res.status(400).json({
                status: 'error',
                message: 'State is required'
            });
        }

        const stateExists = await Prisma.pam_states.findUnique({
            where: { id: parseInt(state_id) }
        });

        if (!stateExists) {
            return res.status(400).json({
                status: 'error',
                message: 'State does not exist'
            });
        }

        const existingCity = await Prisma.pam_cities.findFirst({
            where: {
                name: name.trim(),
                state_id: parseInt(state_id)
            }
        });

        if (existingCity) {
            return res.status(400).json({
                status: 'error',
                message: 'City with this name already exists in this state'
            });
        }

        const existingSlug = await Prisma.pam_cities.findFirst({
            where: { slug: slug.trim().toLowerCase() }
        });

        if (existingSlug) {
            return res.status(400).json({
                status: 'error',
                message: 'City with this slug already exists'
            });
        }

        const city = await Prisma.pam_cities.create({
            data: {
                name: name.trim(),
                slug: slug.trim().toLowerCase(),
                state_id: parseInt(state_id),
                status: parseInt(status)
            },
            include: {
                state: {
                    include: {
                        country: {
                            select: {
                                id: true,
                                name: true,
                                sortname: true
                            }
                        }
                    }
                }
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'City created successfully',
            data: serializeBigInt(city)
        });
    } catch (err) {
        console.error('Create city error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create city',
            error: err.message
        });
    }
};

// Update city
export const updateCity = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug, state_id, status } = req.body;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        const existingCity = await Prisma.pam_cities.findUnique({
            where: { id: cityId }
        });

        if (!existingCity) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'City name is required'
            });
        }

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug is required'
            });
        }

        if (!state_id) {
            return res.status(400).json({
                status: 'error',
                message: 'State is required'
            });
        }

        const stateExists = await Prisma.pam_states.findUnique({
            where: { id: parseInt(state_id) }
        });

        if (!stateExists) {
            return res.status(400).json({
                status: 'error',
                message: 'State does not exist'
            });
        }

        const duplicateName = await Prisma.pam_cities.findFirst({
            where: {
                name: name.trim(),
                state_id: parseInt(state_id),
                id: { not: cityId }
            }
        });

        if (duplicateName) {
            return res.status(400).json({
                status: 'error',
                message: 'Another city with this name already exists in this state'
            });
        }

        const duplicateSlug = await Prisma.pam_cities.findFirst({
            where: {
                slug: slug.trim().toLowerCase(),
                id: { not: cityId }
            }
        });

        if (duplicateSlug) {
            return res.status(400).json({
                status: 'error',
                message: 'Another city with this slug already exists'
            });
        }

        const updatedCity = await Prisma.pam_cities.update({
            where: { id: cityId },
            data: {
                name: name.trim(),
                slug: slug.trim().toLowerCase(),
                state_id: parseInt(state_id),
                status: status !== undefined ? parseInt(status) : existingCity.status
            },
            include: {
                state: {
                    include: {
                        country: {
                            select: {
                                id: true,
                                name: true,
                                sortname: true
                            }
                        }
                    }
                }
            }
        });

        res.json({
            status: 'success',
            message: 'City updated successfully',
            data: serializeBigInt(updatedCity)
        });
    } catch (err) {
        console.error('Update city error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update city',
            error: err.message
        });
    }
};

// Delete city
export const deleteCity = async (req, res) => {
    try {
        const { id } = req.params;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        const city = await Prisma.pam_cities.findUnique({
            where: { id: cityId }
        });

        if (!city) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        await Prisma.pam_cities.delete({
            where: { id: cityId }
        });

        res.json({
            status: 'success',
            message: 'City deleted successfully'
        });
    } catch (err) {
        console.error('Delete city error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete city',
            error: err.message
        });
    }
};

// Get city details (view)
export const getCityDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        const city = await Prisma.pam_cities.findUnique({
            where: { id: cityId },
            include: {
                state: {
                    include: {
                        country: {
                            select: {
                                id: true,
                                name: true,
                                sortname: true,
                                phonecode: true
                            }
                        }
                    }
                }
            }
        });

        if (!city) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        res.json({
            status: 'success',
            data: serializeBigInt(city)
        });
    } catch (err) {
        console.error('Get city details error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch city details',
            error: err.message
        });
    }
};

// Get city status only
export const getCityStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        const city = await Prisma.pam_cities.findUnique({
            where: { id: cityId },
            select: {
                id: true,
                name: true,
                status: true
            }
        });

        if (!city) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        res.json({
            status: 'success',
            data: {
                id: city.id,
                name: city.name,
                status: city.status,
                status_text: city.status === 1 ? 'Active' : 'Inactive'
            }
        });
    } catch (err) {
        console.error('Get city status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch city status',
            error: err.message
        });
    }
};

// Update city status
export const updateCityStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        if (status === undefined || ![0, 1].includes(parseInt(status))) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid status (0 or 1) is required'
            });
        }

        const city = await Prisma.pam_cities.findUnique({
            where: { id: cityId }
        });

        if (!city) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        const updatedCity = await Prisma.pam_cities.update({
            where: { id: cityId },
            data: {
                status: parseInt(status)
            },
            include: {
                state: {
                    select: {
                        id: true,
                        name: true,
                        country: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });

        res.json({
            status: 'success',
            message: `City ${updatedCity.status === 1 ? 'activated' : 'deactivated'} successfully`,
            data: serializeBigInt(updatedCity)
        });
    } catch (err) {
        console.error('Update city status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update city status',
            error: err.message
        });
    }
};

// Search cities
export const searchCities = async (req, res) => {
    try {
        const { q = '', limit = 10, state_id = '', country_id = '' } = req.query;

        if (!q || q.trim() === '') {
            return res.json({
                status: 'success',
                data: []
            });
        }

        const where = {
            OR: [
                { name: { contains: q.trim() } },
                { slug: { contains: q.trim() } }
            ],
            status: 1
        };

        if (state_id !== '' && !isNaN(parseInt(state_id))) {
            where.state_id = parseInt(state_id);
        }

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.state = {
                country_id: parseInt(country_id)
            };
        }

        const cities = await Prisma.pam_cities.findMany({
            where,
            take: parseInt(limit) || 10,
            select: {
                id: true,
                name: true,
                slug: true,
                state_id: true,
                state: {
                    select: {
                        name: true,
                        country: {
                            select: {
                                name: true
                            }
                        }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(cities)
        });
    } catch (err) {
        console.error('Search cities error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to search cities',
            error: err.message
        });
    }
};

export const searchCitiesByName = async (req, res) => {
    console.log("----- searchCitiesByName (User) -----");
    try {
        const { q = '', limit = 10, state_id = '', country_id = '' } = req.query;
        // If no search query, return empty result
        if (!q || q.trim() === '') {
            return res.json({
                status: 'success',
                data: []
            });
        }
        const searchTerm = q.trim();
        // Build where clause
        const where = {
            OR: [
                { name: { contains: searchTerm } },
                { slug: { contains: searchTerm } }
            ],
            status: 1,
             state_id: {
                lt: 42  // Default: only include cities with state_id < 42
            }
        };
        // Filter by state_id if provided
        if (state_id && state_id !== '' && !isNaN(parseInt(state_id))) {
            //where.state_id = parseInt(state_id);
            where.state_id < 42;
        }
        // Filter by country_id if provided (through state relation)
        // if (country_id && country_id !== '' && !isNaN(parseInt(country_id))) {
        //     where.state = {
        //         country_id: parseInt(country_id)
        //     };
        // }
        // Fetch cities from database - only select required fields
        const cities = await Prisma.pam_cities.findMany({
            where,
            take: parseInt(limit) || 10,
            select: {
                id: true,
                name: true,
                slug: true,
                state_id: true
            },
            orderBy: { name: 'asc' }
        });
        return res.json({
            status: 'success',
            data: serializeBigInt(cities)
        });
    } catch (err) {
        console.error('Search cities error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to search cities',
            error: err.message
        });
    }
};

// Get cities by state
export const getCitiesByState = async (req, res) => {
    try {
        const { state_id } = req.params;
        const { status = '1' } = req.query;

        const stateIdNum = parseInt(state_id);
        if (isNaN(stateIdNum)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid state ID'
            });
        }

        const stateExists = await Prisma.pam_states.findUnique({
            where: { id: stateIdNum }
        });

        if (!stateExists) {
            return res.status(404).json({
                status: 'error',
                message: 'State not found'
            });
        }

        const where = {
            state_id: stateIdNum
        };

        if (status !== '' && !isNaN(parseInt(status))) {
            where.status = parseInt(status);
        }

        const cities = await Prisma.pam_cities.findMany({
            where,
            select: {
                id: true,
                name: true,
                slug: true,
                status: true
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(cities)
        });
    } catch (err) {
        console.error('Get cities by state error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch cities by state',
            error: err.message
        });
    }
};

// Get active cities only
export const getActiveCities = async (req, res) => {
    try {
        const { state_id = '', country_id = '', limit = 100 } = req.query;

        const where = {
            status: 1
        };

        if (state_id !== '' && !isNaN(parseInt(state_id))) {
            where.state_id = parseInt(state_id);
        }

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.state = {
                country_id: parseInt(country_id)
            };
        }

        const cities = await Prisma.pam_cities.findMany({
            where,
            take: parseInt(limit) || 100,
            include: {
                state: {
                    select: {
                        id: true,
                        name: true,
                        country: {
                            select: {
                                id: true,
                                name: true,
                                sortname: true
                            }
                        }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            status: 'success',
            data: serializeBigInt(cities)
        });
    } catch (err) {
        console.error('Get active cities error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch active cities',
            error: err.message
        });
    }
};

// Get city counts
export const getCitiesCount = async (req, res) => {
    try {
        const { state_id = '', country_id = '' } = req.query;

        const where = {};

        if (state_id !== '' && !isNaN(parseInt(state_id))) {
            where.state_id = parseInt(state_id);
        }

        if (country_id !== '' && !isNaN(parseInt(country_id))) {
            where.state = {
                country_id: parseInt(country_id)
            };
        }

        const total = await Prisma.pam_cities.count({ where });
        const active = await Prisma.pam_cities.count({
            where: { ...where, status: 1 }
        });
        const inactive = await Prisma.pam_cities.count({
            where: { ...where, status: 0 }
        });

        res.json({
            status: 'success',
            data: {
                total,
                active,
                inactive
            }
        });
    } catch (err) {
        console.error('Count cities error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to count cities',
            error: err.message
        });
    }
};

// Validate city slug
export const validateCitySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const { exclude_id = '' } = req.query;

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Slug is required'
            });
        }

        const where = {
            slug: slug.trim().toLowerCase()
        };

        if (exclude_id !== '' && !isNaN(parseInt(exclude_id))) {
            where.id = { not: parseInt(exclude_id) };
        }

        const existingCity = await Prisma.pam_cities.findFirst({
            where
        });

        res.json({
            status: 'success',
            data: {
                is_unique: !existingCity,
                message: existingCity ? 'Slug already exists' : 'Slug is available'
            }
        });
    } catch (err) {
        console.error('Validate slug error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to validate slug',
            error: err.message
        });
    }
};

// Bulk update city status
export const bulkUpdateCityStatus = async (req, res) => {
    try {
        const { city_ids, status } = req.body;

        if (!city_ids || !Array.isArray(city_ids) || city_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'city_ids array is required'
            });
        }

        if (status === undefined || ![0, 1].includes(parseInt(status))) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid status (0 or 1) is required'
            });
        }

        const cityIdsNum = city_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        await Prisma.pam_cities.updateMany({
            where: {
                id: {
                    in: cityIdsNum
                }
            },
            data: {
                status: parseInt(status)
            }
        });

        res.json({
            status: 'success',
            message: `${cityIdsNum.length} cit${cityIdsNum.length === 1 ? 'y' : 'ies'} ${status === '1' ? 'activated' : 'deactivated'} successfully`
        });
    } catch (err) {
        console.error('Bulk update city status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update city status in bulk',
            error: err.message
        });
    }
};

// Bulk delete cities
export const bulkDeleteCities = async (req, res) => {
    try {
        const { city_ids } = req.body;

        if (!city_ids || !Array.isArray(city_ids) || city_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'city_ids array is required'
            });
        }

        const cityIdsNum = city_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        await Prisma.pam_cities.deleteMany({
            where: {
                id: {
                    in: cityIdsNum
                }
            }
        });

        res.json({
            status: 'success',
            message: `${cityIdsNum.length} cit${cityIdsNum.length === 1 ? 'y' : 'ies'} deleted successfully`
        });
    } catch (err) {
        console.error('Bulk delete cities error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete cities in bulk',
            error: err.message
        });
    }
};

export const toggleCityStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const cityId = parseInt(id);

        if (isNaN(cityId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid city ID'
            });
        }

        // Find the city
        const city = await Prisma.pam_cities.findUnique({
            where: { id: cityId }
        });

        if (!city) {
            return res.status(404).json({
                status: 'error',
                message: 'City not found'
            });
        }

        // Toggle status (1 -> 0, 0 -> 1)
        const newStatus = city.status === 1 ? 0 : 1;

        // Update city status
        const updatedCity = await Prisma.pam_cities.update({
            where: { id: cityId },
            data: { 
                status: newStatus 
            },
            include: {
                state: {
                    select: {
                        id: true,
                        name: true,
                        country: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });

        res.json({
            status: 'success',
            message: `City ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`,
            data: serializeBigInt({
                id: updatedCity.id,
                name: updatedCity.name,
                status: updatedCity.status,
                status_text: updatedCity.status === 1 ? 'Active' : 'Inactive',
                state: updatedCity.state
            })
        });
    } catch (err) {
        console.error('Toggle city status error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to toggle city status',
            error: err.message
        });
    }
};
 