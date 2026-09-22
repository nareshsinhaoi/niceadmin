import { Prisma } from '../../../src/config/db.js';

// Get all subcategories with pagination and filters
export const getSubcategories = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
      status = '',
      category_id = ''
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status !== '') {
      where.status = parseInt(status);
    }

    if (category_id !== '') {
      where.category_id = parseInt(category_id);
    }

    const total = await Prisma.pam_sub_category.count({ where });

    const subcategories = await Prisma.pam_sub_category.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { [sortBy]: sortOrder },
      include: {
        category: {
          select: {
            name: true,
            sortname: true,
            status: true
          }
        }
      }
    });

    res.json({
      status: 'success',
      data: subcategories,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (err) {
    console.error('Get subcategories error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subcategories.',
    });
  }
};

// Get single subcategory by ID
export const getSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    const subcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            sortname: true
          }
        }
      }
    });

    if (!subcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    res.json({
      status: 'success',
      data: subcategory,
    });
  } catch (err) {
    console.error('Get subcategory error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subcategory',
    });
  }
};

// Create new subcategory
export const createSubcategory = async (req, res) => {
  try {
    const { category_id, name, slug, status = 1 } = req.body;

    if (!category_id || !name || !slug) {
      return res.status(400).json({
        status: 'error',
        message: 'Category ID, name, and slug are required',
      });
    }

    const category = await Prisma.pam_category.findUnique({
      where: { category_id: parseInt(category_id) },
    });

    if (!category) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category',
      });
    }

    if (category.status !== 1) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot add subcategory to inactive category',
      });
    }

    const existingSubcategory = await Prisma.pam_sub_category.findUnique({
      where: { slug },
    });

    if (existingSubcategory) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug already exists. Please use a different slug.',
      });
    }

    const subcategory = await Prisma.pam_sub_category.create({
      data: {
        category_id: parseInt(category_id),
        name,
        slug,
        status: parseInt(status),
        created_at: new Date(),
      },
      include: {
        category: {
          select: {
            name: true,
            sortname: true
          }
        }
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'Subcategory created successfully',
      data: subcategory,
    });
  } catch (err) {
    console.error('Create subcategory error:', err);

    if (err.code === 'P2002') {
      return res.status(400).json({
        status: 'error',
        message: 'Subcategory with this slug already exists',
      });
    }

    if (err.code === 'P2003') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to create subcategory',
    });
  }
};

// Update subcategory
export const updateSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, name, slug, status } = req.body;

    const existingSubcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
    });

    if (!existingSubcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    if (category_id && parseInt(category_id) !== existingSubcategory.category_id) {
      const category = await Prisma.pam_category.findUnique({
        where: { category_id: parseInt(category_id) },
      });

      if (!category) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid category ID',
        });
      }

      if (category.status !== 1) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot move subcategory to inactive category',
        });
      }
    }

    if (slug && slug !== existingSubcategory.slug) {
      const slugExists = await Prisma.pam_sub_category.findFirst({
        where: {
          slug,
          sub_category_id: { not: parseInt(id) }
        },
      });

      if (slugExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Slug already exists. Please use a different slug.',
        });
      }
    }

    const updateData = {
      updated_at: new Date(),
    };

    if (category_id !== undefined) updateData.category_id = parseInt(category_id);
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (status !== undefined) updateData.status = parseInt(status);

    const updatedSubcategory = await Prisma.pam_sub_category.update({
      where: { sub_category_id: parseInt(id) },
      data: updateData,
      include: {
        category: {
          select: {
            name: true,
            sortname: true
          }
        }
      }
    });

    res.json({
      status: 'success',
      message: 'Subcategory updated successfully',
      data: updatedSubcategory,
    });
  } catch (err) {
    console.error('Update subcategory error:', err);

    if (err.code === 'P2002') {
      return res.status(400).json({
        status: 'error',
        message: 'Subcategory with this slug already exists',
      });
    }

    if (err.code === 'P2003') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update subcategory',
    });
  }
};

// Delete subcategory
export const deleteSubcategory = async (req, res) => {
  try {
    const { id } = req.params;

    const subcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
    });

    if (!subcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    await Prisma.pam_sub_category.delete({
      where: { sub_category_id: parseInt(id) },
    });

    res.json({
      status: 'success',
      message: 'Subcategory deleted successfully',
    });
  } catch (err) {
    console.error('Delete subcategory error:', err);

    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to delete subcategory',
    });
  }
};

// Toggle subcategory status
export const toggleSubcategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const subcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
    });

    if (!subcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    if (subcategory.status === 0) {
      const category = await Prisma.pam_category.findUnique({
        where: { category_id: subcategory.category_id },
      });

      if (category && category.status !== 1) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot activate subcategory when parent category is inactive',
        });
      }
    }

    const newStatus = subcategory.status === 1 ? 0 : 1;
    const updatedSubcategory = await Prisma.pam_sub_category.update({
      where: { sub_category_id: parseInt(id) },
      data: {
        status: newStatus,
        updated_at: new Date(),
      },
      include: {
        category: {
          select: {
            name: true,
            sortname: true
          }
        }
      }
    });

    res.json({
      status: 'success',
      message: `Subcategory ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`,
      data: updatedSubcategory,
    });
  } catch (err) {
    console.error('Toggle subcategory status error:', err);

    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to toggle subcategory status',
    });
  }
};

// Bulk update subcategories status
export const bulkUpdateSubcategoryStatus = async (req, res) => {
  try {
    const { subcategory_ids, status } = req.body;

    if (!Array.isArray(subcategory_ids) || subcategory_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide subcategory IDs',
      });
    }

    if (status === undefined || (status !== 0 && status !== 1)) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide valid status (0 or 1)',
      });
    }

    if (status === 1) {
      const subcategories = await Prisma.pam_sub_category.findMany({
        where: {
          sub_category_id: { in: subcategory_ids.map(id => parseInt(id)) }
        },
        include: {
          category: true
        }
      });

      const inactiveParent = subcategories.find(
        subcat => subcat.category.status !== 1
      );

      if (inactiveParent) {
        return res.status(400).json({
          status: 'error',
          message: `Cannot activate subcategory "${inactiveParent.name}" because parent category "${inactiveParent.category.name}" is inactive`,
        });
      }
    }

    const updated = await Prisma.pam_sub_category.updateMany({
      where: {
        sub_category_id: { in: subcategory_ids.map(id => parseInt(id)) }
      },
      data: {
        status: parseInt(status),
        updated_at: new Date(),
      },
    });

    res.json({
      status: 'success',
      message: `${updated.count} subcategor${updated.count === 1 ? 'y' : 'ies'} ${status === 1 ? 'activated' : 'deactivated'} successfully`,
      count: updated.count,
    });
  } catch (err) {
    console.error('Bulk update subcategories status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update subcategories status',
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
      where.sub_category_id = { not: parseInt(exclude_id) };
    }

    const existing = await Prisma.pam_sub_category.findFirst({
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