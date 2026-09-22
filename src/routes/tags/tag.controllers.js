import { Prisma } from '../../../src/config/db.js';

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

// Get all tags
export const getTags = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 25,
      sortBy = 'tag_id',
      sortOrder = 'desc',
      search = ''
    } = req.query;
    //if(req.query.limit)
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (search) {
      where.OR = [
        { photo_tag: { contains: search, mode: 'insensitive' } },
        { photo_slug: { contains: search, mode: 'insensitive' } }
      ];
    }

    const total = await Prisma.pam_tags.count({ where });

    const tags = await Prisma.pam_tags.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: {
        [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc'
      },
      select: {
        tag_id: true,
        photo_tag: true,
        photo_slug: true,
        //created_at: true
      },
    });

    res.json({
      status: 'success',
      count: tags.length,
      total: total,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        items_per_page: limitNum
      },
      results: tags.map(tag => ({
        ...tag,
        tag_id: tag.tag_id.toString(), // BigInt safe for JSON
      })),
    });
  } catch (err) {
    console.error('Get tags error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch tags',
    });
  }
};

// Search tags
export const searchTags = async (req, res) => {
  console.log("~~~ searchTags ~~~~");
  try {
    const q = (req.query.q || '').trim();
    const limit = parseInt(req.query.limit) || 50;
    if (!q) {
      return res.json({
        status: 'success',
        count: 0,
        results: [],
      });
    }
    const tags = await Prisma.pam_tags.findMany({
      where: {
        OR: [
          { photo_tag: { contains: q  } },
          { photo_slug: { contains: q  } },
        ],
      },
      take: limit,
      orderBy: { photo_tag: 'asc' },
      select: {
        tag_id: true,
        photo_tag: true,
        photo_slug: true,
      },
    });
    res.json({
      status: 'success',
      count: tags.length,
      results: tags.map(tag => ({
        ...tag,
        tag_id: tag.tag_id.toString(), // BigInt safe
      })),
    });
  } catch (err) {
    console.error('Search tags error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to search tags',
    });
  }
};

export const searchTagsByLetter = async (req, res) => {
  console.log("~~~ searchTagsByLetter ~~~~");
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    const limit = parseInt(req.query.limit) || 250;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    let whereClause = {};
    
    if (q) {
      // Search for tags starting with the letter (case-insensitive)
      whereClause = {
        OR: [
          { photo_tag: { startsWith: q  } }, //, mode: 'insensitive'
          { photo_slug: { startsWith: q } }, // , mode: 'insensitive'
        ],
      };
    }

    // Get total count
    const totalCount = await Prisma.pam_tags.count({
      where: whereClause,
    });

    // Get paginated results
    const tags = await Prisma.pam_tags.findMany({
      where: whereClause,
      take: limit,
      skip: skip,
      orderBy: { photo_tag: 'asc' },
      select: {
        tag_id: true,
        photo_tag: true,
        photo_slug: true,
      },
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    res.json({
      status: 'success',
      count: tags.length,
      total: totalCount,
      page: page,
      limit: limit,
      totalPages: totalPages,
      hasMore: hasMore,
      results: tags.map(tag => ({
        ...tag,
        tag_id: tag.tag_id.toString(), // BigInt safe
      })),
    });

  } catch (err) {
    console.error('Search tags error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to search tags',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

// Create new tag
export const createTag = async (req, res) => {
  try {
    let { photo_tag } = req.body;
    
    if (!photo_tag || !photo_tag.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'photo_tag is required',
      });
    }
    
    photo_tag = photo_tag.trim();
    
    // Create slug (SEO friendly)
    const photo_slug = photo_tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if tag already exists (by slug)
    const existingTag = await Prisma.pam_tags.findFirst({
      where: {
        photo_slug,
      },
    });

    if (existingTag) {
      return res.json({
        status: 'success',
        message: 'Tag already exists',
        data: {
          tag_id: existingTag.tag_id.toString(),
          photo_tag: existingTag.photo_tag,
          photo_slug: existingTag.photo_slug,
        },
      });
    }

    // Create new tag
    const tag = await Prisma.pam_tags.create({
      data: {
        photo_tag,
        photo_slug,
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Tag created successfully',
      data: {
        tag_id: tag.tag_id.toString(), // BigInt safe
        photo_tag: tag.photo_tag,
        photo_slug: tag.photo_slug,
      },
    });
  } catch (err) {
    console.error('Create tag error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create tag',
    });
  }
};

// Update tag
export const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { photo_tag } = req.body;
    
    if (!photo_tag || !photo_tag.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'photo_tag is required',
      });
    }

    const tagId = BigInt(id);
    
    // Check if tag exists
    const existingTag = await Prisma.pam_tags.findUnique({
      where: { tag_id: tagId }
    });

    if (!existingTag) {
      return res.status(404).json({
        status: 'error',
        message: 'Tag not found',
      });
    }

    const newPhotoTag = photo_tag.trim();
    const newPhotoSlug = newPhotoTag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if new slug already exists (excluding current tag)
    const slugExists = await Prisma.pam_tags.findFirst({
      where: {
        photo_slug: newPhotoSlug,
        tag_id: { not: tagId }
      }
    });

    if (slugExists) {
      return res.status(400).json({
        status: 'error',
        message: 'Tag with this name already exists',
      });
    }

    const updatedTag = await Prisma.pam_tags.update({
      where: { tag_id: tagId },
      data: {
        photo_tag: newPhotoTag,
        photo_slug: newPhotoSlug,
      },
    });

    res.json({
      status: 'success',
      message: 'Tag updated successfully',
      data: {
        tag_id: updatedTag.tag_id.toString(),
        photo_tag: updatedTag.photo_tag,
        photo_slug: updatedTag.photo_slug,
      },
    });
  } catch (err) {
    console.error('Update tag error:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Tag not found',
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to update tag',
    });
  }
};

// Delete tag
export const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tagId = BigInt(id);

    // Check if tag exists
    const existingTag = await Prisma.pam_tags.findUnique({
      where: { tag_id: tagId }
    });

    if (!existingTag) {
      return res.status(404).json({
        status: 'error',
        message: 'Tag not found',
      });
    }

    // Check if tag is being used in photos
    const tagUsage = await Prisma.pam_photo_tags.count({
      where: { tag_id: tagId }
    });

    if (tagUsage > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete tag that is being used in photos',
      });
    }

    await Prisma.pam_tags.delete({
      where: { tag_id: tagId }
    });

    res.json({
      status: 'success',
      message: 'Tag deleted successfully',
    });
  } catch (err) {
    console.error('Delete tag error:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Tag not found',
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete tag',
    });
  }
};

// Get tag by ID
export const getTagById = async (req, res) => {
  try {
    const { id } = req.params;
    const tagId = BigInt(id);

    const tag = await Prisma.pam_tags.findUnique({
      where: { tag_id: tagId },
      include: {
        _count: {
          select: {
            pam_photo_tags: true
          }
        }
      }
    });

    if (!tag) {
      return res.status(404).json({
        status: 'error',
        message: 'Tag not found',
      });
    }

    res.json({
      status: 'success',
      data: {
        ...tag,
        tag_id: tag.tag_id.toString(),
        usage_count: tag._count.pam_photo_tags
      }
    });
  } catch (err) {
    console.error('Get tag by ID error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch tag',
    });
  }
};

// Get popular tags (most used)
export const getPopularTags = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const popularTags = await Prisma.pam_tags.findMany({
      include: {
        _count: {
          select: {
            pam_photo_tags: true
          }
        }
      },
      orderBy: {
        pam_photo_tags: {
          _count: 'desc'
        }
      },
      take: limit
    });

    res.json({
      status: 'success',
      results: popularTags.map(tag => ({
        tag_id: tag.tag_id.toString(),
        photo_tag: tag.photo_tag,
        photo_slug: tag.photo_slug,
        usage_count: tag._count.pam_photo_tags
      }))
    });
  } catch (err) {
    console.error('Get popular tags error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch popular tags',
    });
  }
};

// Get tag statistics
export const getTagStatistics = async (req, res) => {
  try {
    const [totalTags, totalUsedTags, unusedTags, mostUsedTags] = await Promise.all([
      // Total tags count
      Prisma.pam_tags.count(),
      
      // Tags that are being used
      Prisma.pam_tags.count({
        where: {
          pam_photo_tags: {
            some: {}
          }
        }
      }),
      
      // Tags not being used
      Prisma.pam_tags.count({
        where: {
          pam_photo_tags: {
            none: {}
          }
        }
      }),
      
      // Top 10 most used tags
      Prisma.pam_tags.findMany({
        include: {
          _count: {
            select: {
              pam_photo_tags: true
            }
          }
        },
        orderBy: {
          pam_photo_tags: {
            _count: 'desc'
          }
        },
        take: 10
      })
    ]);

    res.json({
      status: 'success',
      data: {
        total_tags: totalTags,
        used_tags: totalUsedTags,
        unused_tags: unusedTags,
        usage_percentage: totalTags > 0 ? ((totalUsedTags / totalTags) * 100).toFixed(2) : 0,
        most_used_tags: mostUsedTags.map(tag => ({
          id: tag.tag_id.toString(),
          name: tag.photo_tag,
          slug: tag.photo_slug,
          usage_count: tag._count.pam_photo_tags
        }))
      }
    });
  } catch (err) {
    console.error('Get tag statistics error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch tag statistics',
    });
  }
};

// Check tag availability
export const checkTagAvailability = async (req, res) => {
  try {
    const { slug } = req.params;
    const { exclude_id } = req.query;

    if (!slug) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    const where = {
      photo_slug: slug.toLowerCase()
    };

    if (exclude_id) {
      where.tag_id = { not: BigInt(exclude_id) };
    }

    const existingTag = await Prisma.pam_tags.findFirst({
      where
    });

    res.json({
      status: 'success',
      available: !existingTag,
      message: existingTag ? 'Tag already exists' : 'Tag is available'
    });
  } catch (err) {
    console.error('Check tag availability error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check tag availability',
    });
  }
};

// Bulk create tags
export const bulkCreateTags = async (req, res) => {
  try {
    const { tags } = req.body; // Expecting array of tag strings

    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Tags array is required'
      });
    }

    const createdTags = [];
    const existingTags = [];
    const errors = [];

    for (const tagName of tags) {
      try {
        if (!tagName || !tagName.trim()) {
          errors.push(`Empty tag name skipped`);
          continue;
        }

        const cleanTag = tagName.trim();
        const tagSlug = cleanTag
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');

        // Check if tag already exists
        const existingTag = await Prisma.pam_tags.findFirst({
          where: { photo_slug: tagSlug }
        });

        if (existingTag) {
          existingTags.push({
            name: cleanTag,
            existing: {
              id: existingTag.tag_id.toString(),
              name: existingTag.photo_tag
            }
          });
          continue;
        }

        // Create new tag
        const newTag = await Prisma.pam_tags.create({
          data: {
            photo_tag: cleanTag,
            photo_slug: tagSlug
          }
        });

        createdTags.push({
          id: newTag.tag_id.toString(),
          name: newTag.photo_tag,
          slug: newTag.photo_slug
        });

      } catch (tagError) {
        errors.push(`Failed to process tag "${tagName}": ${tagError.message}`);
      }
    }

    res.json({
      status: 'success',
      message: 'Bulk tag creation completed',
      data: {
        created: createdTags.length,
        existing: existingTags.length,
        errors: errors.length,
        details: {
          created_tags: createdTags,
          existing_tags: existingTags,
          errors: errors
        }
      }
    });
  } catch (err) {
    console.error('Bulk create tags error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create tags in bulk',
    });
  }
};

// Get tags by photo ID
export const getTagsByPhoto = async (req, res) => {
  try {
    const { photo_id } = req.params;

    const photoTags = await Prisma.pam_photo_tags.findMany({
      where: {
        photo_id: parseInt(photo_id)
      },
      include: {
        pam_tags: {
          select: {
            tag_id: true,
            photo_tag: true,
            photo_slug: true
          }
        }
      }
    });

    res.json({
      status: 'success',
      data: photoTags.map(pt => ({
        tag_id: pt.pam_tags.tag_id.toString(),
        photo_tag: pt.pam_tags.photo_tag,
        photo_slug: pt.pam_tags.photo_slug
      }))
    });
  } catch (err) {
    console.error('Get tags by photo error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch tags for photo',
    });
  }
};

// Get tag by slug
export const getTagBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    const tag = await Prisma.pam_tags.findFirst({
      where: {
        photo_slug: slug.toLowerCase().trim()
      },
      select: {
        tag_id: true,
        photo_tag: true,
        photo_slug: true
      }
    });

    if (!tag) {
      return res.status(404).json({
        status: 'error',
        message: 'Tag not found'
      });
    }

    res.json({
      status: 'success',
      data: {
        tag_id: tag.tag_id.toString(),
        photo_tag: tag.photo_tag,
        photo_slug: tag.photo_slug
      }
    });
  } catch (err) {
    console.error('Get tag by slug error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch tag',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};