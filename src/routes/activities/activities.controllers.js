import { Prisma } from '../../../src/config/db.js';
import { parse } from 'json2csv';

// Helper function to serialize BigInt
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
};

// Get activity logs (pam_activity_log table)
export const getActivityLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      user_id = '',
      user_type = '',
      activity_type = '',
      module = '',
      status = '',
      severity = '',
      start_date = '',
      end_date = '',
      search = ''
    } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {};

    if (user_id && !isNaN(parseInt(user_id))) {
      where.user_id = parseInt(user_id);
    }

    if (user_type) {
      where.user_type = user_type;
    }

    if (activity_type) {
      where.activity_type = activity_type;
    }

    if (module) {
      where.module = module;
    }

    if (status) {
      where.status = status;
    }

    if (severity) {
      where.severity = severity;
    }

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Search filter
    if (search) {
      const searchTerm = search.trim();
      where.OR = [
        { user_name: { contains: searchTerm } },
        { action: { contains: searchTerm } },
        { message: { contains: searchTerm } },
        { activity_code: { contains: searchTerm } }
      ];
    }

    // Get total count
    const total = await Prisma.pam_activity_log.count({ where });

    // Get logs
    const logs = await Prisma.pam_activity_log.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limitNum
    });

    res.json({
      status: 'success',
      data: serializeBigInt(logs),
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (err) {
    console.error('Get activity logs error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity logs',
      error: err.message
    });
  }
};

// Get activity log statistics (pam_activity_log table)
export const getActivityLogStats = async (req, res) => {
  try {
    const { start_date = '', end_date = '' } = req.query;

    const where = {};

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Get various counts
    const [
      totalLogs,
      successLogs,
      failedLogs,
      userLogs,
      adminLogs,
      topActivities,
      topModules,
      recentActivities
    ] = await Promise.all([
      // Total logs
      Prisma.pam_activity_log.count({ where }),

      // Success logs
      Prisma.pam_activity_log.count({ where: { ...where, status: 'success' } }),

      // Failed logs
      Prisma.pam_activity_log.count({ where: { ...where, status: 'failed' } }),

      // User logs
      Prisma.pam_activity_log.count({ where: { ...where, user_type: 'user' } }),

      // Admin logs
      Prisma.pam_activity_log.count({ where: { ...where, user_type: 'admin' } }),

      // Top activities
      Prisma.pam_activity_log.groupBy({
        by: ['activity_type'],
        where,
        _count: { activity_type: true },
        orderBy: { _count: { activity_type: 'desc' } },
        take: 10
      }),

      // Top modules
      Prisma.pam_activity_log.groupBy({
        by: ['module'],
        where,
        _count: { module: true },
        orderBy: { _count: { module: 'desc' } },
        take: 10
      }),

      // Recent activities
      Prisma.pam_activity_log.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          user_name: true,
          activity_type: true,
          module: true,
          action: true,
          created_at: true,
          status: true
        }
      })
    ]);

    res.json({
      status: 'success',
      data: {
        total_logs: totalLogs,
        success_logs: successLogs,
        failed_logs: failedLogs,
        user_logs: userLogs,
        admin_logs: adminLogs,
        top_activities: topActivities,
        top_modules: topModules,
        recent_activities: recentActivities,
        success_rate: totalLogs > 0 ? ((successLogs / totalLogs) * 100).toFixed(2) : 0
      }
    });
  } catch (err) {
    console.error('Get activity stats error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity statistics',
      error: err.message
    });
  }
};

// Get activities (pam_activities table)
export const getActivities = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      user_type = '',
      activity_type = '',
      module = '',
      status = '',
      severity = '',
      start_date = '',
      end_date = '',
      user_id = ''
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {};

    // Search filter
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { user_name: { contains: searchTerm } },
        { action: { contains: searchTerm } },
        { message: { contains: searchTerm } },
        { activity_code: { contains: searchTerm } },
        { ip_address: { contains: searchTerm } },
        { resource_name: { contains: searchTerm } }
      ];
    }

    // Filter by user type
    if (user_type) {
      where.user_type = user_type;
    }

    // Filter by activity type
    if (activity_type) {
      where.activity_type = activity_type;
    }

    // Filter by module
    if (module) {
      where.module = module;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by severity
    if (severity) {
      where.severity = severity;
    }

    // Filter by user ID
    if (user_id && !isNaN(parseInt(user_id))) {
      where.user_id = parseInt(user_id);
    }

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Get total count
    const total = await Prisma.pam_activities.count({ where });

    // Get activities
    const activities = await Prisma.pam_activities.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limitNum
    });

    res.json({
      status: 'success',
      data: serializeBigInt(activities),
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (err) {
    console.error('Get activities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activities',
      error: err.message
    });
  }
};

// Get activity statistics (pam_activities table)
export const getActivityStats = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const where = {
      created_at: {
        gte: startDate
      }
    };

    const [
      total,
      success,
      failed,
      topActivities,
      topModules,
      topUsers
    ] = await Promise.all([
      // Total activities
      Prisma.pam_activities.count({ where }),

      // Success count
      Prisma.pam_activities.count({
        where: { ...where, status: 'success' }
      }),

      // Failed count
      Prisma.pam_activities.count({
        where: { ...where, status: 'failed' }
      }),

      // Top activities
      Prisma.pam_activities.groupBy({
        by: ['activity_type'],
        where,
        _count: { activity_type: true },
        orderBy: { _count: { activity_type: 'desc' } },
        take: 5
      }),

      // Top modules
      Prisma.pam_activities.groupBy({
        by: ['module'],
        where,
        _count: { module: true },
        orderBy: { _count: { module: 'desc' } },
        take: 5
      }),

      // Top users
      Prisma.pam_activities.groupBy({
        by: ['user_id', 'user_name'],
        where: {
          ...where,
          user_id: { not: null }
        },
        _count: { user_id: true },
        orderBy: { _count: { user_id: 'desc' } },
        take: 5
      })
    ]);

    res.json({
      status: 'success',
      data: {
        total,
        success,
        failed,
        success_rate: total > 0 ? ((success / total) * 100).toFixed(2) : 0,
        top_activities: topActivities,
        top_modules: topModules,
        top_users: topUsers
      }
    });
  } catch (err) {
    console.error('Get activity stats error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity statistics',
      error: err.message
    });
  }
};

// Get single activity by ID
export const getActivityById = async (req, res) => {
  try {
    const { id } = req.params;
    const activityId = parseInt(id);

    if (isNaN(activityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid activity ID'
      });
    }

    const activity = await Prisma.pam_activities.findUnique({
      where: { id: activityId }
    });

    if (!activity) {
      return res.status(404).json({
        status: 'error',
        message: 'Activity not found'
      });
    }

    res.json({
      status: 'success',
      data: serializeBigInt(activity)
    });
  } catch (err) {
    console.error('Get activity error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity',
      error: err.message
    });
  }
};

// Get comprehensive activity statistics
export const getActivityStatistics = async (req, res) => {
  try {
    const { 
      start_date = '', 
      end_date = '', 
      user_type = '', 
      module = '' 
    } = req.query;

    const where = {};

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // User type filter
    if (user_type) {
      where.user_type = user_type;
    }

    // Module filter
    if (module) {
      where.module = module;
    }

    const [
      totalActivities,
      todayActivities,
      thisWeekActivities,
      thisMonthActivities,
      activityTypes,
      userActivities,
      hourlyDistribution,
      dailyTrend
    ] = await Promise.all([
      // Total activities
      Prisma.pam_activities.count({ where }),

      // Today's activities
      Prisma.pam_activities.count({
        where: {
          ...where,
          created_at: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),

      // This week's activities
      Prisma.pam_activities.count({
        where: {
          ...where,
          created_at: {
            gte: new Date(new Date().setDate(new Date().getDate() - 7))
          }
        }
      }),

      // This month's activities
      Prisma.pam_activities.count({
        where: {
          ...where,
          created_at: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30))
          }
        }
      }),

      // Activity types distribution
      Prisma.pam_activities.groupBy({
        by: ['activity_type'],
        where,
        _count: { activity_type: true },
        orderBy: { _count: { activity_type: 'desc' } },
        take: 8
      }),

      // Top users by activity count
      Prisma.pam_activities.groupBy({
        by: ['user_id', 'user_name'],
        where: { ...where, user_id: { not: null } },
        _count: { user_id: true },
        orderBy: { _count: { user_id: 'desc' } },
        take: 8
      }),

      // Hourly distribution (last 24 hours)
      (async () => {
        const last24Hours = new Date();
        last24Hours.setHours(last24Hours.getHours() - 24);

        const hourlyData = await Prisma.$queryRaw`
          SELECT 
            EXTRACT(HOUR FROM created_at) as hour,
            COUNT(*) as count
          FROM pam_activities
          WHERE created_at >= ${last24Hours}
          GROUP BY EXTRACT(HOUR FROM created_at)
          ORDER BY hour
        `;

        return hourlyData;
      })(),

      // Daily trend (last 30 days)
      (async () => {
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);

        const dailyData = await Prisma.$queryRaw`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as count
          FROM pam_activities
          WHERE created_at >= ${last30Days}
          GROUP BY DATE(created_at)
          ORDER BY date
        `;

        return dailyData;
      })()
    ]);

    res.json({
      status: 'success',
      data: {
        summary: {
          total: totalActivities,
          today: todayActivities,
          this_week: thisWeekActivities,
          this_month: thisMonthActivities
        },
        activity_types: activityTypes,
        top_users: userActivities,
        hourly_distribution: hourlyDistribution,
        daily_trend: dailyTrend
      }
    });
  } catch (err) {
    console.error('Get activity statistics error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity statistics',
      error: err.message
    });
  }
};

// Get recent activities
export const getRecentActivities = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const activities = await Prisma.pam_activities.findMany({
      orderBy: { created_at: 'desc' },
      take: parseInt(limit) || 20,
      select: {
        id: true,
        user_id: true,
        user_name: true,
        activity_type: true,
        module: true,
        action: true,
        status: true,
        severity: true,
        created_at: true,
        ip_address: true
      }
    });

    res.json({
      status: 'success',
      data: serializeBigInt(activities)
    });
  } catch (err) {
    console.error('Get recent activities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch recent activities',
      error: err.message
    });
  }
};

// Get top activities
export const getTopActivities = async (req, res) => {
  try {
    const { days = 30, limit = 10 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const topActivities = await Prisma.pam_activities.groupBy({
      by: ['activity_type'],
      where: {
        created_at: {
          gte: startDate
        }
      },
      _count: { activity_type: true },
      orderBy: { _count: { activity_type: 'desc' } },
      take: parseInt(limit) || 10
    });

    res.json({
      status: 'success',
      data: topActivities
    });
  } catch (err) {
    console.error('Get top activities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch top activities',
      error: err.message
    });
  }
};

// Get top modules
export const getTopModules = async (req, res) => {
  try {
    const { days = 30, limit = 10 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const topModules = await Prisma.pam_activities.groupBy({
      by: ['module'],
      where: {
        created_at: {
          gte: startDate
        }
      },
      _count: { module: true },
      orderBy: { _count: { module: 'desc' } },
      take: parseInt(limit) || 10
    });

    res.json({
      status: 'success',
      data: topModules
    });
  } catch (err) {
    console.error('Get top modules error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch top modules',
      error: err.message
    });
  }
};

// Get user activity summary
export const getUserActivitySummary = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { days = 30 } = req.query;

    if (!user_id || isNaN(parseInt(user_id))) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid user ID is required'
      });
    }

    const userId = parseInt(user_id);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const where = {
      user_id: userId,
      created_at: {
        gte: startDate
      }
    };

    const [
      totalActivities,
      successActivities,
      failedActivities,
      activityTypes,
      modules,
      recentActivities
    ] = await Promise.all([
      // Total activities
      Prisma.pam_activities.count({ where }),

      // Success count
      Prisma.pam_activities.count({
        where: { ...where, status: 'success' }
      }),

      // Failed count
      Prisma.pam_activities.count({
        where: { ...where, status: 'failed' }
      }),

      // Activity types
      Prisma.pam_activities.groupBy({
        by: ['activity_type'],
        where,
        _count: { activity_type: true },
        orderBy: { _count: { activity_type: 'desc' } },
        take: 5
      }),

      // Modules
      Prisma.pam_activities.groupBy({
        by: ['module'],
        where,
        _count: { module: true },
        orderBy: { _count: { module: 'desc' } },
        take: 5
      }),

      // Recent activities
      Prisma.pam_activities.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          activity_type: true,
          module: true,
          action: true,
          status: true,
          created_at: true
        }
      })
    ]);

    // Get user info if available
    let userInfo = null;
    try {
      userInfo = await Prisma.pam_users.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          role: true
        }
      });
    } catch (userError) {
      console.log('User info not available:', userError.message);
    }

    res.json({
      status: 'success',
      data: {
        user: userInfo,
        summary: {
          total: totalActivities,
          success: successActivities,
          failed: failedActivities,
          success_rate: totalActivities > 0 ? ((successActivities / totalActivities) * 100).toFixed(2) : 0
        },
        activity_types: activityTypes,
        modules: modules,
        recent_activities: recentActivities
      }
    });
  } catch (err) {
    console.error('Get user activity summary error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user activity summary',
      error: err.message
    });
  }
};

// Export activity logs to CSV
export const exportActivityLogs = async (req, res) => {
  try {
    const {
      start_date = '',
      end_date = '',
      user_type = '',
      activity_type = '',
      status = ''
    } = req.query;

    const where = {};

    // Date range filter
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // Filters
    if (user_type) where.user_type = user_type;
    if (activity_type) where.activity_type = activity_type;
    if (status) where.status = status;

    // Get logs for export
    const logs = await Prisma.pam_activities.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        user_id: true,
        user_name: true,
        user_type: true,
        activity_type: true,
        module: true,
        action: true,
        message: true,
        status: true,
        severity: true,
        ip_address: true,
        resource_name: true,
        activity_code: true,
        created_at: true
      }
    });

    if (logs.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No activity logs found for export'
      });
    }

    // Convert to CSV
    const csv = parse(serializeBigInt(logs));

    // Set headers for CSV download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `activity-logs-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('Export activity logs error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to export activity logs',
      error: err.message
    });
  }
};