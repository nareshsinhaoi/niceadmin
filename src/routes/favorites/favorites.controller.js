//import { Prisma } from '../../config/db.js';

import { Prisma } from '../../config/db.js';

// Add asset to favorites
export const addToFavorites = async (req, res) => {
  console.log('--- addToFavorites ---');

  try {
    const userId = req.user?.id; // From auth middleware
    const { assetId, assetType } = req.body;

    // Validation
    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated',
      });
    }

    if (!assetId) {
      return res.status(400).json({
        status: 'error',
        message: 'Asset ID is required',
      });
    }

    // Check if already in favorites
    const existingFavorite = await Prisma.pam_user_favorites.findFirst({
      where: {
        user_id: userId,
        asset_id: assetId,
      },
    });

    if (existingFavorite) {
      return res.status(400).json({
        status: 'error',
        message: 'Asset already in favorites',
      });
    }

    // Add to favorites
    const favorite = await Prisma.pam_user_favorites.create({
      data: {
        user_id: userId,
        asset_id: assetId,
        asset_type: assetType || 'photo',
        created_at: new Date(),
      },
    });

    console.log(`Asset ${assetId} added to favorites for user ${userId}`);

    return res.status(200).json({
      status: 'success',
      message: 'Asset added to favorites successfully',
      data: favorite,
    });

  } catch (err) {
    console.error('addToFavorites error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to add to favorites',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};

// Remove asset from favorites
export const removeFromFavorites = async (req, res) => {
  console.log('--- removeFromFavorites ---');

  try {
    const userId = req.user?.id;
    const { assetId } = req.params;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated',
      });
    }

    if (!assetId) {
      return res.status(400).json({
        status: 'error',
        message: 'Asset ID is required',
      });
    }

    // Remove from favorites
    const deleted = await Prisma.pam_user_favorites.deleteMany({
      where: {
        user_id: userId,
        asset_id: assetId,
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Asset not found in favorites',
      });
    }

    console.log(`Asset ${assetId} removed from favorites for user ${userId}`);

    return res.status(200).json({
      status: 'success',
      message: 'Asset removed from favorites successfully',
    });

  } catch (err) {
    console.error('removeFromFavorites error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to remove from favorites',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};

// Get user's favorites
export const getUserFavorites = async (req, res) => {
  console.log('--- getUserFavorites ---');

  try {
    const userId = req.user?.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated',
      });
    }

    const [favorites, total] = await Promise.all([
      Prisma.pam_user_favorites.findMany({
        where: {
          user_id: userId,
        },
        include: {
          // Include asset details if you have a relation
          // asset: true,
        },
        skip,
        take: limit,
        orderBy: {
          created_at: 'desc',
        },
      }),
      Prisma.pam_user_favorites.count({
        where: {
          user_id: userId,
        },
      }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: favorites,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.error('getUserFavorites error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch favorites',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};

// Check if asset is in user's favorites
export const checkFavoriteStatus = async (req, res) => {
  console.log('--- checkFavoriteStatus ---');

  try {
    const userId = req.user?.id;
    const { assetId } = req.params;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated',
      });
    }

    if (!assetId) {
      return res.status(400).json({
        status: 'error',
        message: 'Asset ID is required',
      });
    }

    const favorite = await Prisma.pam_user_favorites.findFirst({
      where: {
        user_id: userId,
        asset_id: assetId,
      },
    });

    return res.status(200).json({
      status: 'success',
      isFavorite: !!favorite,
    });

  } catch (err) {
    console.error('checkFavoriteStatus error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to check favorite status',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
};

