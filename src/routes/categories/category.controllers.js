import { Prisma } from '../../../src/config/db.js';

// Get all categories with pagination and filters
export const getCategories = async (req, res) => {
  console.log("~~~ getCategories ~~~");
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'name',
      sortOrder = 'asc',
      status
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { sortname: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status !== undefined && status !== '') {
      where.status = Number(status);
    }

    const orderBy = {
      [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc',
    };

    const total = await Prisma.pam_category.count({ where });

    const categories = await Prisma.pam_category.findMany({
      where,
      skip,
      take: limitNum,
      orderBy,
    });

    res.json({
      status: 'success',
      data: categories,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum,
      },
    });
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch categories',
    });
  }
};

// Get single category by ID
export const getCategory = async (req, res) => {
  try {
    const categoryId = Number(req.params.id);

    if (isNaN(categoryId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }

    const category = await Prisma.pam_category.findUnique({
      where: { category_id: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        status: 'error',
        message: 'Category not found',
      });
    }

    res.json({
      status: 'success',
      data: category,
    });
  } catch (err) {
    console.error('Get category error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch category',
    });
  }
};

// Create new category
export const createCategory = async (req, res) => {
  try {
    const { sortname, name, slug, status = 1 } = req.body;

    if (!sortname || !name || !slug) {
      return res.status(400).json({
        status: 'error',
        message: 'Sortname, name, and slug are required',
      });
    }

    const existingCategory = await Prisma.pam_category.findUnique({
      where: { slug },
    });

    if (existingCategory) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug already exists',
      });
    }

    const category = await Prisma.pam_category.create({
      data: {
        sortname,
        name,
        slug,
        status: parseInt(status),
        created_at: new Date(),
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Category created successfully',
      data: category,
    });
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create category',
    });
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    const categoryId = Number(req.params.id);
    const { sortname, name, slug, status } = req.body;

    if (isNaN(categoryId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }

    const existingCategory = await Prisma.pam_category.findUnique({
      where: { category_id: categoryId },
    });

    if (!existingCategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Category not found',
      });
    }

    if (slug && slug !== existingCategory.slug) {
      const slugExists = await Prisma.pam_category.findFirst({
        where: {
          slug,
          category_id: { not: categoryId },
        },
      });

      if (slugExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Slug already exists',
        });
      }
    }

    const updateData = {};

    if (sortname !== undefined) updateData.sortname = sortname;
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (status !== undefined) updateData.status = Number(status);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No fields provided for update',
      });
    }

    updateData.updated_at = new Date();

    const category = await Prisma.pam_category.update({
      where: { category_id: categoryId },
      data: updateData,
    });

    res.json({
      status: 'success',
      message: 'Category updated successfully',
      data: category,
    });
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update category',
    });
  }
};

// Delete category
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const subcategoriesCount = await Prisma.pam_sub_category.count({
      where: { category_id: parseInt(id) },
    });

    if (subcategoriesCount > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete category with existing subcategories',
      });
    }

    await Prisma.pam_category.delete({
      where: { category_id: parseInt(id) },
    });

    res.json({
      status: 'success',
      message: 'Category deleted successfully',
    });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete category',
    });
  }
};

// Toggle category status
export const toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Prisma.pam_category.findUnique({
      where: { category_id: parseInt(id) },
    });

    if (!category) {
      return res.status(404).json({
        status: 'error',
        message: 'Category not found',
      });
    }

    const updatedCategory = await Prisma.pam_category.update({
      where: { category_id: parseInt(id) },
      data: {
        status: category.status === 1 ? 0 : 1,
        updated_at: new Date(),
      },
    });

    res.json({
      status: 'success',
      message: `Category ${updatedCategory.status === 1 ? 'activated' : 'deactivated'} successfully`,
      data: updatedCategory,
    });
  } catch (err) {
    console.error('Toggle category status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to toggle category status',
    });
  }
};

// Get subcategories by category ID
export const getCategorySubcategories = async (req, res) => {
  try {
    const { category_id } = req.params;
    const { status = '1' } = req.query;

    const category = await Prisma.pam_category.findUnique({
      where: { category_id: parseInt(category_id) },
    });

    if (!category) {
      return res.status(404).json({
        status: 'error',
        message: 'Category not found',
      });
    }

    const where = {
      category_id: parseInt(category_id),
    };

    if (status !== '') {
      where.status = parseInt(status);
    }

    const subcategories = await Prisma.pam_sub_category.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        sub_category_id: true,
        name: true,
        slug: true,
        status: true
      }
    });

    res.json({
      status: 'success',
      data: subcategories,
      category: {
        name: category.name,
        sortname: category.sortname
      }
    });
  } catch (err) {
    console.error('Get subcategories by category error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subcategories',
    });
  }
};

// Get active subcategories count by category
export const getSubcategoriesCount = async (req, res) => {
  try {
    const { category_id } = req.params;
    const count = await Prisma.pam_sub_category.count({
      where: {
        category_id: parseInt(category_id),
        status: 1
      }
    });

    res.json({
      status: 'success',
      data: { count }
    });
  } catch (err) {
    console.error('Get subcategories count error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subcategories count',
    });
  }
};


export const getMenu = async (req, res) => {
  try {
    /* (1) Fetch categories */
    const categories = await Prisma.pam_category.findMany({
      where: {
        status: 1
      },
      orderBy: {
        name: 'asc'
      }
    });
    /* (2) Fetch sub-categories */
    const subCategories = await Prisma.pam_sub_category.findMany({
      where: {
        status: 1
      },
      orderBy: {
        name: 'asc'
      }
    });
    /* (3) Group sub-categories by category_id */
    const subMap = {};
    subCategories.forEach(sub => {
      if (!subMap[sub.category_id]) {
        subMap[sub.category_id] = [];
      }
      subMap[sub.category_id].push({
        sub_category_id: sub.sub_category_id,
        name: sub.name,
        slug: sub.slug
      });
    });
    /* (4) Attach sub-categories to categories */
    const menu = categories.map(cat => ({
      category_id: cat.category_id,
      name: cat.name,
      slug: cat.slug,
      sub_categories: subMap[cat.category_id] || []
    }));
    res.json({
      status: "success",
      menu
    });
  } catch (err) {
    console.error('Menu API Error:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to load menu"
    });
  }
};
