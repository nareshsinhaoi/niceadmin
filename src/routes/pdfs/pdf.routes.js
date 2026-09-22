import express from 'express';
import {
    uploadPdfs,
    getPdfs,
    getPdfById,
    updatePdf,
    deletePdf,
    restorePdf,
    getPdfStats,
    deleteThumbnail,
    addPdfFiles,
    downloadPdfFile,
    getMyPdfs,
    getThumbnail, getPdfThumbnails
} from './pdf.controllers.js';
import multer from 'multer';
import { authenticateToken, verifyAdmin } from '../../../authMiddleware.js';

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit per file
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// ==============================
// PUBLIC ROUTES (no authentication required)
// ==============================
router.get('/', getPdfs);
router.get('/stats', getPdfStats);
router.get('/:id', getPdfById);
router.get('/files/:file_id/download', downloadPdfFile);
router.get('/thumbnails/:uuid/:page', getThumbnail);
router.get('/:id/thumbnails', getPdfThumbnails); 
// ==============================
// USER ROUTES (authentication required)
// ==============================
router.get('/user/my-pdfs', authenticateToken, getMyPdfs);
router.get('/user/:id', authenticateToken, getPdfById);
router.post('/user/upload', authenticateToken, upload.array('files', 20), uploadPdfs);
router.put('/user/update/:id', authenticateToken, updatePdf);
router.delete('/user/delete/:id', authenticateToken, deletePdf);
router.put('/user/:id/restore', authenticateToken, restorePdf);
router.get('/user/files/:file_id/download', authenticateToken, downloadPdfFile);

// Thumbnail management (user)
router.delete('/user/:id/thumbnails/:thumbnail_id', authenticateToken, deleteThumbnail);

// ==============================
// ADMIN ROUTES (authentication + admin verification required)
// ==============================
router.post('/upload', authenticateToken, verifyAdmin, upload.array('files', 20), uploadPdfs);
router.put('/update/:id', authenticateToken, verifyAdmin, updatePdf);
router.delete('/delete/:id', authenticateToken, verifyAdmin, deletePdf);
router.put('/:id/restore', authenticateToken, verifyAdmin, restorePdf);

// Thumbnail management (admin)
router.delete('/:id/thumbnails/:thumbnail_id', authenticateToken, verifyAdmin, deleteThumbnail);

// ==============================
// DEPRECATED ROUTES (kept for compatibility)
// ==============================
router.post('/:id/files/add', authenticateToken, verifyAdmin, upload.array('files', 20), addPdfFiles);
router.delete('/:id/files/:file_id', authenticateToken, verifyAdmin, deleteThumbnail);

export default router;