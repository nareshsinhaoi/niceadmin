// dashboard.controllers.js
import { Prisma } from '../../../src/config/db.js';


export const getCategories = async (req, res) => {
    console.log("~~~ getCategories ~~~");
    try {
        const categories = await Prisma.pam_category.findMany({
            where: { status: 1 },
            include: {
                photos: {
                    where: {
                        is_active: 1,
                        is_trash: 0
                    }
                }
            }
        });

        res.status(200).json({
            status: 'success',
            data: categories
        });
    } catch (err) {
        console.error('Get categories error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch categories',
        });
    }
};

export const getTopPhotos = async (req, res) => {
    console.log("--- Photos Status --- ");
    try {
        // FIX: Uncomment photo_title in select
        const topPhotos = await Prisma.pam_photos.findMany({
            where: {
                is_active: 1,
                is_trash: 0
            },
            take: 5,
            orderBy: [
                { download: 'desc' }
            ],
            select: {
                photo_id: true,
                photo_title: true,  // UNCOMMENT this line
                download: true,
                price: true,
            }
        });

        console.log('Top photos fetched:', topPhotos.length); // Add debug log

        const formattedPhotos = topPhotos.map((photo, index) => ({
            id: photo.photo_id.toString(),
            title: photo.photo_title || 'Untitled',  // Add fallback
            views: (photo.download || 0) * 10,
            downloads: photo.download || 0,
            revenue: Number(photo.price || 0) * (photo.download || 0),
            rating: 4.5 + (Math.random() * 0.5)
        }));

        const weeklyRevenue = formattedPhotos.reduce((sum, photo) => sum + photo.revenue, 0);
        const newDownloads = formattedPhotos.reduce((sum, photo) => sum + photo.downloads, 0);

        return res.status(200).json({
            photos: formattedPhotos,
            summary: {
                weeklyRevenue: weeklyRevenue.toFixed(2),
                newDownloads: newDownloads.toLocaleString()
            }
        });
    } catch (error) {
        console.error('Top photos error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
};

export const getSystemStatus = async (req, res) => {
    console.log("--- System Status --- ");
    console.log("Request received at:", new Date().toISOString()); // Add timestamp

    try {
        // Mock data since these are infrastructure metrics
        const status = [
            { name: 'Web Server', status: 'up', uptime: '99.9%', response: '45ms' },
            { name: 'Database', status: 'up', uptime: '99.8%', response: '12ms' },
            { name: 'CDN', status: 'up', uptime: '100%', response: '5ms' },
            { name: 'API', status: 'up', uptime: '99.7%', response: '28ms' },
            { name: 'Storage', status: 'warning', uptime: '99.5%', response: '65ms' }
        ];

        console.log('Sending system status response'); // Add debug log
        return res.status(200).json(status);
    } catch (error) {
        console.error('System status error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
};

export const getStats = async (req, res) => {
    console.log("--- Dashboard Stats --- ");
    try {
        const { timeRange = 'week' } = req.query;

        // Get total users
        const totalUsers = await Prisma.pam_users.count();

        // Get total photos
        const totalPhotos = await Prisma.pam_photos.count({
            where: { is_trash: 0 }
        });

        // Get total downloads
        const totalDownloads = await Prisma.pam_photos.aggregate({
            _sum: { download: true }
        });

        res.status(200).json({
            status: 'success',
            data: {
                totalUsers,
                totalPhotos,
                totalDownloads: totalDownloads._sum.download || 0
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch stats' });
    }
};

export const getRecentActivity = async (req, res) => {
    console.log("--- Recent Activity --- ");
    try {
        const activities = await Prisma.pam_activities.findMany({
            take: 10,
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                user_name: true,
                action: true,
                resource_name: true,
                created_at: true,
                activity_type: true,
                status: true
            }
        });

        res.status(200).json(activities);
    } catch (error) {
        console.error('Recent activity error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch activities' });
    }
};

export const getCategoryDistribution = async (req, res) => {
    console.log("--- Category Distribution --- ");
    try {
        const categories = await Prisma.pam_category.findMany({
            where: { status: 1 },
            include: {
                photos: {
                    where: { is_active: 1, is_trash: 0 }
                }
            }
        });

        const colors = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444'];

        const categoryData = categories.slice(0, 5).map((category, index) => ({
            name: category.name,
            value: category.photos.length,
            color: colors[index % colors.length]
        }));

        res.status(200).json(categoryData);
    } catch (error) {
        console.error('Category distribution error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories' });
    }
};