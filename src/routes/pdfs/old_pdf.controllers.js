import { Prisma } from '../../config/db.js';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { uploadToS3Direct } from '../../utils/s3.js';
import poppler from 'pdf-poppler';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// Helper functions
const serializeBigInt = (obj) => {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )
    );
};

const errorResponse = (message, error = null, code = null) => ({
    status: 'error',
    message,
    ...(code && { code }),
    ...(error && process.env.NODE_ENV === 'development' && { error: error.message })
});

const successResponse = (message, data = null, meta = null) => ({
    status: 'success',
    message,
    ...(data && { data }),
    ...(meta && { meta })
});

const generatePdfThumbnail = async (pdfBuffer, outputDir, fileName) => {
    try {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save PDF buffer to temp file
        const tempPdfPath = path.join(tempDir, `${fileName}.pdf`);
        fs.writeFileSync(tempPdfPath, pdfBuffer);

        // Generate thumbnail path
        const thumbnailPath = path.join(outputDir, `thumb_${fileName}.png`);

        // Configure poppler options for first page only
        const options = {
            format: 'png',
            out_dir: outputDir,
            out_prefix: `thumb_${fileName}`,
            page: 1, // Only first page
            scale: 1024, // Scale to 1024px width
            overwrite: true
        };

        // Convert PDF to image
        await poppler.convert(tempPdfPath, options);

        // Clean up temp PDF file
        fs.unlinkSync(tempPdfPath);

        // Check if thumbnail was created
        const expectedThumbnailPath = path.join(outputDir, `thumb_${fileName}-1.png`);
        if (fs.existsSync(expectedThumbnailPath)) {
            // Rename to remove page number suffix
            fs.renameSync(expectedThumbnailPath, thumbnailPath);
            return thumbnailPath;
        }

        return null;
    } catch (error) {
        console.error('Error generating PDF thumbnail:', error);
        throw new Error(`Failed to generate PDF thumbnail: ${error.message}`);
    }
};

// Function to generate thumbnail for all pages (optional - for multi-page thumbnails)
const generateAllPageThumbnails = async (pdfBuffer, outputDir, fileName) => {
    try {
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const tempPdfPath = path.join(tempDir, `${fileName}.pdf`);
        fs.writeFileSync(tempPdfPath, pdfBuffer);

        const options = {
            format: 'png',
            out_dir: outputDir,
            out_prefix: `page_${fileName}`,
            scale: 1024,
            overwrite: true
        };

        await poppler.convert(tempPdfPath, options);

        fs.unlinkSync(tempPdfPath);

        // Get all generated thumbnails
        const files = fs.readdirSync(outputDir);
        const thumbnails = files
            .filter(file => file.startsWith(`page_${fileName}`) && file.endsWith('.png'))
            .map(file => path.join(outputDir, file));

        return thumbnails;
    } catch (error) {
        console.error('Error generating all page thumbnails:', error);
        return [];
    }
};


// Upload PDFs
export const uploadPdfs00000 = async (req, res) => {
    console.log("--- Upload PDFs ---");
    try {
        const userId = req.user?.id || req.body?.userId || req.admin?.admin_id;
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json(
                errorResponse('At least one PDF file is required')
            );
        }

        const {
            category_id,
            sub_category_id,
            photo_title,
            description,
            event_name,
            source_name,
            credit,
            other_credit,
            max_downloads,
            price,
            is_active,
            enter_by,
            keywords,
            tags,
            tag_ids,
            photography_time
        } = req.body;

        // Validate required fields
        if (!photo_title || !category_id) {
            return res.status(400).json(
                errorResponse('Title and category are required')
            );
        }

        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');

        // Parse tag IDs from request
        let tagIdsArray = [];
        if (tag_ids) {
            if (Array.isArray(tag_ids)) {
                tagIdsArray = tag_ids;
            } else if (typeof tag_ids === 'string') {
                tagIdsArray = tag_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            }
        }

        const result = await Prisma.$transaction(async (tx) => {
            // 1. Create PDF record
            const pdf = await tx.pam_pdfs.create({
                data: {
                    title: String(photo_title),
                    event_name: event_name || '',
                    description: description || '',
                    category_id: parseInt(category_id),
                    sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
                    author_id: parseInt(userId),
                    source_name: source_name || '',
                    credit: credit ? parseInt(credit) : 0,
                    other_credit: other_credit || '',
                    max_download: max_downloads ? parseInt(max_downloads) : 0,
                    price: price ? parseFloat(price) : 0,
                    is_active: is_active ? parseInt(is_active) : 1,
                    is_trash: 0,
                    enter_by: parseInt(userId),
                    updated_by: parseInt(userId),
                    entered_on: new Date(),
                    updated_on: new Date(),
                    keywords: keywords || '',
                    pdf_tags: tags || '',
                    photography_time: photography_time ? new Date(photography_time) : null,
                }
            });

            const pdfId = Number(pdf.pdf_id);
            let totalFileSize = 0;
            const uploadedFiles = [];

            // 2. Process each PDF file
            for (const file of files) {
                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 15);
                const fileName = `${timestamp}_${randomString}.pdf`;
                const originalName = file.originalname || file.name;
                const fileSize = String(file.size);
                const fileBuffer = file.buffer;

                // Generate S3 key
                const fileKey = `uploads/pdfs/${year}/${month}/${day}/${fileName}`;
                const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/thumb_${fileName}.png`;

                try {
                    // Upload PDF to S3
                    const fileUrl = await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                    // For thumbnail, you'd need to use a PDF thumbnail generator
                    // For now, we'll use a placeholder
                    const thumbnailPath = `uploads/pdfs/${year}/${month}/${day}/thumb_${fileName}.png`;

                    const pdfFile = await tx.pam_pdf_files.create({
                        data: {
                            pdf_id: pdfId,
                            dir_path: `pdfs/${year}/${month}/${day}`,
                            file_size: fileSize,
                            file_name: fileName,
                            original_file_name: originalName,
                            source: source_name || 'User Upload',
                            enter_by: String(userId),
                            entered_on: new Date(),
                            updated_by: String(userId),
                            updated_on: new Date(),
                            is_trash: 'N',
                            trashed_by: '',
                            trashed_on: new Date(),
                            downloads: 0,
                            thumbnail_path: thumbnailPath,
                        }
                    });

                    totalFileSize += parseInt(fileSize);
                    uploadedFiles.push(pdfFile);

                } catch (uploadError) {
                    console.error(`Error uploading PDF ${file.originalname}:`, uploadError);
                    throw new Error(`Failed to upload PDF ${file.originalname}: ${uploadError.message}`);
                }
            }

            // 3. Update PDF with file stats
            const updatedPdf = await tx.pam_pdfs.update({
                where: { pdf_id: pdfId },
                data: {
                    file_size: String(totalFileSize),
                }
            });

            // 4. Process tags (if any) - using pam_photo_tags table
            if (tagIdsArray.length > 0) {
                const tagPromises = tagIdsArray.map(tagId =>
                    tx.pam_photo_tags.create({
                        data: {
                            photo_id: pdfId,
                            tag_id: parseInt(tagId)
                        }
                    })
                );
                await Promise.all(tagPromises);
            }

            return {
                pdf: updatedPdf,
                files: uploadedFiles,
                tagsProcessed: tagIdsArray.length
            };
        }, {
            timeout: 60000 // 60 seconds timeout for large uploads
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'create',
                module: 'pdfs',
                action: 'pdf_upload',
                message: `Uploaded ${files.length} PDF(s): "${result.pdf.title}"`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: result.pdf.title,
                resource_id: Number(result.pdf.pdf_id),
                created_at: new Date(),
                activity_code: 'PDF_UPLOAD_001'
            }
        });

        return res.status(201).json(
            successResponse('PDF(s) uploaded successfully', {
                pdf: {
                    id: result.pdf.pdf_id.toString(),
                    title: result.pdf.title,
                    total_files: result.files.length,
                    total_pages: result.pdf.total_pages || 0,
                    file_size: result.pdf.file_size
                },
                files: result.files.map(f => ({
                    id: f.file_id.toString(),
                    name: f.file_name,
                    original_name: f.original_file_name
                }))
            })
        );

    } catch (error) {
        console.error('Upload PDFs error:', error);
        return res.status(500).json(
            errorResponse('Failed to upload PDFs', error.message)
        );
    }
};

// Get all PDFs
export const getPdfs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const category_id = req.query.category_id ? parseInt(req.query.category_id) : undefined;
        const is_active = req.query.is_active !== undefined ? parseInt(req.query.is_active) : undefined;

        const where = {
            is_trash: 0,
            ...(search && {
                OR: [
                    { title: { contains: search } },
                    { description: { contains: search } },
                    { event_name: { contains: search } },
                    { keywords: { contains: search } }
                ]
            }),
            ...(category_id && { category_id }),
            ...(is_active !== undefined && { is_active })
        };

        const totalRecords = await Prisma.pam_pdfs.count({ where });

        const pdfs = await Prisma.pam_pdfs.findMany({
            where,
            skip,
            take: limit,
            orderBy: { pdf_id: 'desc' },
            include: {
                category: {
                    select: {
                        category_id: true,
                        name: true,
                        slug: true
                    }
                },
                sub_category: {
                    select: {
                        sub_category_id: true,
                        name: true,
                        slug: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstname: true,
                        lastname: true
                    }
                },
                files: {
                    where: { is_trash: 'N' },
                    select: {
                        file_id: true,
                        file_name: true,
                        file_size: true,
                        thumbnail_path: true,
                        downloads: true,
                        original_file_name: true
                    },
                    orderBy: { file_id: 'asc' }
                }
            }
        });

        const formattedPdfs = pdfs.map(pdf => ({
            ...pdf,
            pdf_id: pdf.pdf_id.toString(),
            cover_file: pdf.files && pdf.files.length > 0 ? pdf.files[0] : null,
            file_count: pdf.files ? pdf.files.length : 0
        }));

        return res.json({
            status: 'success',
            data: serializeBigInt(formattedPdfs),
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit)
            }
        });

    } catch (error) {
        console.error('Get PDFs error:', error);
        return res.status(500).json(
            errorResponse('Failed to fetch PDFs', error)
        );
    }
};

// Get single PDF by ID
export const getPdfById = async (req, res) => {
    try {
        const { id } = req.params;
        const pdfId = parseInt(id);

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        const pdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId },
            include: {
                category: {
                    select: {
                        category_id: true,
                        name: true,
                        slug: true
                    }
                },
                sub_category: {
                    select: {
                        sub_category_id: true,
                        name: true,
                        slug: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstname: true,
                        lastname: true
                    }
                },
                files: {
                    where: { is_trash: 'N' },
                    orderBy: { file_id: 'asc' }
                }
            }
        });

        if (!pdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        return res.json({
            status: 'success',
            data: serializeBigInt(pdf)
        });

    } catch (error) {
        console.error('Get PDF by ID error:', error);
        return res.status(500).json(
            errorResponse('Failed to fetch PDF', error)
        );
    }
};

// Update PDF
export const updatePdf = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        const {
            title,
            description,
            event_name,
            author,
            photo_credit_id,
            category_id,
            sub_category_id,
            source_name,
            max_download,
            price,
            keywords,
            is_active,
            tags,
            photography_time
        } = req.body;

        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        const updatedPdf = await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                title: title || existingPdf.title,
                description: description !== undefined ? description : existingPdf.description,
                event_name: event_name !== undefined ? event_name : existingPdf.event_name,
                category_id: category_id ? parseInt(category_id) : existingPdf.category_id,
                sub_category_id: sub_category_id ? parseInt(sub_category_id) : existingPdf.sub_category_id,
                author_id: author ? parseInt(author) : existingPdf.author_id,
                source_name: source_name !== undefined ? source_name : existingPdf.source_name,
                credit: photo_credit_id ? parseInt(photo_credit_id) : existingPdf.credit,
                max_download: max_download !== undefined ? parseInt(max_download) : existingPdf.max_download,
                price: price !== undefined ? parseFloat(price) : existingPdf.price,
                keywords: keywords !== undefined ? keywords : existingPdf.keywords,
                pdf_tags: tags !== undefined ? tags : existingPdf.pdf_tags,
                is_active: is_active !== undefined ? parseInt(is_active) : existingPdf.is_active,
                photography_time: photography_time ? new Date(photography_time) : existingPdf.photography_time,
                updated_on: new Date(),
                updated_by: parseInt(userId)
            }
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'update',
                module: 'pdfs',
                action: 'pdf_update',
                message: `Updated PDF: "${updatedPdf.title}" (ID: ${pdfId})`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: updatedPdf.title,
                resource_id: pdfId,
                created_at: new Date(),
                activity_code: 'PDF_UPDATE_001'
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF updated successfully',
            data: serializeBigInt(updatedPdf)
        });

    } catch (error) {
        console.error('Update PDF error:', error);
        return res.status(500).json(
            errorResponse('Failed to update PDF===', error)
        );
    }
};

// Delete PDF (soft delete)
export const deletePdf = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        // Check if already trashed
        if (existingPdf.is_trash === 1) {
            return res.status(400).json(
                errorResponse('PDF is already in trash')
            );
        }

        await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                is_trash: 1,
                updated_on: new Date(),
                updated_by: parseInt(userId)
            }
        });

        await Prisma.pam_pdf_files.updateMany({
            where: { pdf_id: pdfId },
            data: {
                is_trash: 'Y',
                trashed_by: String(userId),
                trashed_on: new Date()
            }
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'delete',
                module: 'pdfs',
                action: 'pdf_delete',
                message: `Moved PDF to trash: "${existingPdf.title}" (ID: ${pdfId})`,
                status: 'success',
                severity: 'warning',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: existingPdf.title,
                resource_id: pdfId,
                created_at: new Date(),
                activity_code: 'PDF_DELETE_001'
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF moved to trash successfully',
            data: {
                pdf_id: pdfId,
                title: existingPdf.title,
                is_trash: 1
            }
        });

    } catch (error) {
        console.error('Delete PDF error:', error);
        return res.status(500).json(
            errorResponse('Failed to delete PDF', error)
        );
    }
};

// Restore PDF from trash
export const restorePdf = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        if (existingPdf.is_trash !== 1) {
            return res.status(400).json(
                errorResponse('PDF is not in trash')
            );
        }

        await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                is_trash: 0,
                updated_on: new Date(),
                updated_by: parseInt(userId)
            }
        });

        await Prisma.pam_pdf_files.updateMany({
            where: { pdf_id: pdfId },
            data: {
                is_trash: 'N',
                trashed_by: '',
                trashed_on: new Date()
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF restored successfully',
            data: {
                pdf_id: pdfId,
                title: existingPdf.title,
                is_trash: 0
            }
        });

    } catch (error) {
        console.error('Restore PDF error:', error);
        return res.status(500).json(
            errorResponse('Failed to restore PDF', error)
        );
    }
};

// Get PDF statistics
export const getPdfStats = async (req, res) => {
    try {
        const [
            total,
            active,
            trashed,
            totalDownloads
        ] = await Promise.all([
            Prisma.pam_pdfs.count({ where: { is_trash: 0 } }),
            Prisma.pam_pdfs.count({ where: { is_trash: 0, is_active: 1 } }),
            Prisma.pam_pdfs.count({ where: { is_trash: 1 } }),
            Prisma.pam_pdf_files.aggregate({
                where: { is_trash: 'N' },
                _sum: { downloads: true }
            })
        ]);

        return res.json({
            status: 'success',
            data: {
                total_pdfs: total,
                active_pdfs: active,
                trashed_pdfs: trashed,
                total_downloads: totalDownloads._sum.downloads || 0
            }
        });

    } catch (error) {
        console.error('Get PDF stats error:', error);
        return res.status(500).json(
            errorResponse('Failed to get PDF statistics', error)
        );
    }
};

// Delete a specific PDF file (not the entire PDF)
export const deletePdfFile000000 = async (req, res) => {
    console.log(`==== deleted pdf ====`)
    try {
        const { id, file_id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);
        const fileId = parseInt(file_id);

        if (isNaN(pdfId) || isNaN(fileId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID or File ID')
            );
        }

        // Check if PDF exists
        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        // Check if file exists and belongs to this PDF
        const existingFile = await Prisma.pam_pdf_files.findFirst({
            where: {
                file_id: fileId,
                pdf_id: pdfId,
                is_trash: 'N'
            }
        });

        if (!existingFile) {
            return res.status(404).json(
                errorResponse('File not found')
            );
        }

        // Soft delete the file
        await Prisma.pam_pdf_files.update({
            where: { file_id: fileId },
            data: {
                is_trash: 'Y',
                trashed_by: parseInt(userId),
                trashed_on: new Date()
            }
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'delete',
                module: 'pdfs',
                action: 'pdf_file_delete',
                message: `Deleted PDF file: "${existingFile.file_name}" from PDF ID: ${pdfId}`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: existingFile.file_name,
                resource_id: fileId,
                created_at: new Date(),
                activity_code: 'PDF_FILE_DELETE_001'
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF file deleted successfully',
            data: {
                file_id: fileId,
                file_name: existingFile.file_name
            }
        });

    } catch (error) {
        console.error('Delete PDF file error:', error);
        return res.status(500).json(
            errorResponse('Failed to delete PDF file', error)
        );
    }
};

export const deletePdfFile = async (req, res) => {
    try {
        const { id, file_id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);
        const fileId = parseInt(file_id);

        if (isNaN(pdfId) || isNaN(fileId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID or File ID')
            );
        }

        // Check if PDF exists
        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        // Check if file exists and belongs to this PDF
        const existingFile = await Prisma.pam_pdf_files.findFirst({
            where: {
                file_id: fileId,
                pdf_id: pdfId,
                is_trash: 'N'
            }
        });

        if (!existingFile) {
            return res.status(404).json(
                errorResponse('File not found')
            );
        }

        // Soft delete the file
        await Prisma.pam_pdf_files.update({
            where: { file_id: fileId },
            data: {
                is_trash: 'Y',
                trashed_by: String(userId),
                trashed_on: new Date()
            }
        });

        // ✅ Update PDF with new file size
        // Get remaining files
        const remainingFiles = await Prisma.pam_pdf_files.findMany({
            where: {
                pdf_id: pdfId,
                is_trash: 'N'
            }
        });

        let totalFileSize = 0;
        for (const file of remainingFiles) {
            totalFileSize += parseInt(file.file_size || '0');
        }

        // ✅ Update PDF with new file size and updated_by
        await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                file_size: String(totalFileSize),
                updated_on: new Date(),
                updated_by: parseInt(userId) // ✅ Make sure this is provided
            }
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'delete',
                module: 'pdfs',
                action: 'pdf_file_delete',
                message: `Deleted PDF file: "${existingFile.file_name}" from PDF ID: ${pdfId}`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: existingFile.file_name,
                resource_id: fileId,
                created_at: new Date(),
                activity_code: 'PDF_FILE_DELETE_001'
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF file deleted successfully',
            data: {
                file_id: fileId,
                file_name: existingFile.file_name
            }
        });

    } catch (error) {
        console.error('Delete PDF file error:', error);
        return res.status(500).json(
            errorResponse('Failed to delete PDF file', error)
        );
    }
};

// Add more PDF files to existing PDF
export const addPdfFiles00000 = async (req, res) => {
    console.log("--- Add PDF Files to Existing PDF ---");

    try {
        const { id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);
        const files = req.files || [];

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        if (files.length === 0) {
            return res.status(400).json(
                errorResponse('No PDF files uploaded')
            );
        }

        // Check if PDF exists
        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');

        const uploadedFiles = [];

        for (const file of files) {
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const fileName = `${timestamp}_${randomString}.pdf`;
            const originalName = file.originalname || file.name;
            const fileSize = String(file.size);
            const fileBuffer = file.buffer;

            const fileKey = `uploads/pdfs/${year}/${month}/${day}/${fileName}`;
            const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/thumb_${fileName}.png`;

            try {
                // Upload PDF to S3
                const fileUrl = await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                const thumbnailPath = `uploads/pdfs/${year}/${month}/${day}/thumb_${fileName}.png`;

                const pdfFile = await Prisma.pam_pdf_files.create({
                    data: {
                        pdf_id: pdfId,
                        dir_path: `pdfs/${year}/${month}/${day}`,
                        file_size: fileSize,
                        file_name: fileName,
                        original_file_name: originalName,
                        source: existingPdf.source_name || 'User Upload',
                        enter_by: String(userId),
                        entered_on: new Date(),
                        updated_by: String(userId),
                        updated_on: new Date(),
                        is_trash: 'N',
                        trashed_by: '',
                        trashed_on: new Date(),
                        downloads: 0,
                        thumbnail_path: thumbnailPath,
                    }
                });

                uploadedFiles.push(pdfFile);

            } catch (uploadError) {
                console.error(`Error uploading PDF ${file.originalname}:`, uploadError);
                throw new Error(`Failed to upload PDF ${file.originalname}: ${uploadError.message}`);
            }
        }

        // Update PDF total pages and file size
        let totalFileSize = parseInt(existingPdf.file_size || '0');
        for (const file of files) {
            totalFileSize += parseInt(file.size);
        }

        // ✅ FIX: Provide all required fields including updated_by
        await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                file_size: String(totalFileSize),
                updated_on: new Date(),
                updated_by: parseInt(userId) // ✅ Make sure this is provided
            }
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'update',
                module: 'pdfs',
                action: 'pdf_files_add',
                message: `Added ${uploadedFiles.length} file(s) to PDF: "${existingPdf.title}" (ID: ${pdfId})`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: existingPdf.title,
                resource_id: pdfId,
                created_at: new Date(),
                activity_code: 'PDF_FILES_ADD_001'
            }
        });

        return res.json({
            status: 'success',
            message: `${uploadedFiles.length} PDF file(s) added successfully`,
            data: {
                pdf_id: pdfId,
                added_files: uploadedFiles.map(f => ({
                    file_id: f.file_id.toString(),
                    file_name: f.file_name,
                    original_file_name: f.original_file_name,
                    file_size: f.file_size
                })),
                total_files: uploadedFiles.length
            }
        });

    } catch (error) {
        console.error('Add PDF files error:', error);
        return res.status(500).json(
            errorResponse('Failed to add PDF files', error.message)
        );
    }
};

// Upload PDFs
export const uploadPdfs = async (req, res) => {
    console.log("--- Upload PDFs ---");
    try {
        const userId = req.user?.id || req.body?.userId || req.admin?.admin_id;
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json(
                errorResponse('At least one PDF file is required')
            );
        }

        const {
            category_id,
            sub_category_id,
            photo_title,
            description,
            event_name,
            source_name,
            credit,
            other_credit,
            max_downloads,
            price,
            is_active,
            enter_by,
            keywords,
            tags,
            tag_ids,
            photography_time
        } = req.body;

        // Validate required fields
        if (!photo_title || !category_id) {
            return res.status(400).json(
                errorResponse('Title and category are required')
            );
        }

        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');

        // Parse tag IDs from request
        let tagIdsArray = [];
        if (tag_ids) {
            if (Array.isArray(tag_ids)) {
                tagIdsArray = tag_ids;
            } else if (typeof tag_ids === 'string') {
                tagIdsArray = tag_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            }
        }

        const result = await Prisma.$transaction(async (tx) => {
            // 1. Create PDF record
            const pdf = await tx.pam_pdfs.create({
                data: {
                    title: String(photo_title),
                    event_name: event_name || '',
                    description: description || '',
                    category_id: parseInt(category_id),
                    sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
                    author_id: parseInt(userId),
                    source_name: source_name || '',
                    credit: credit ? parseInt(credit) : 0,
                    other_credit: other_credit || '',
                    max_download: max_downloads ? parseInt(max_downloads) : 0,
                    price: price ? parseFloat(price) : 0,
                    is_active: is_active ? parseInt(is_active) : 1,
                    is_trash: 0,
                    enter_by: parseInt(userId),
                    updated_by: parseInt(userId),
                    entered_on: new Date(),
                    updated_on: new Date(),
                    keywords: keywords || '',
                    pdf_tags: tags || '',
                    photography_time: photography_time ? new Date(photography_time) : null,
                }
            });

            const pdfId = Number(pdf.pdf_id);
            let totalFileSize = 0;
            const uploadedFiles = [];

            // 2. Process each PDF file
            for (const file of files) {
                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 15);
                const fileName = `${timestamp}_${randomString}`;
                const pdfFileName = `${fileName}.pdf`;
                const originalName = file.originalname || file.name;
                const fileSize = String(file.size);
                const fileBuffer = file.buffer;

                // Generate S3 key
                const fileKey = `uploads/pdfs/${year}/${month}/${day}/${pdfFileName}`;
                const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/thumb_${fileName}.png`;

                try {
                    // Upload PDF to S3
                    const fileUrl = await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                    // Generate PDF thumbnail
                    let thumbnailPath = thumbnailKey;
                    try {
                        // Create local temp directory for thumbnail generation
                        const localOutputDir = path.join(__dirname, '../../temp/thumbnails', `${year}/${month}/${day}`);

                        // Generate thumbnail
                        const generatedThumbnail = await generatePdfThumbnail(fileBuffer, localOutputDir, fileName);

                        if (generatedThumbnail && fs.existsSync(generatedThumbnail)) {
                            // Read the generated thumbnail
                            const thumbnailBuffer = fs.readFileSync(generatedThumbnail);

                            // Upload thumbnail to S3
                            await uploadToS3Direct(thumbnailBuffer, thumbnailKey, 'image/png', false);

                            // Clean up local thumbnail
                            fs.unlinkSync(generatedThumbnail);

                            // Check if parent directory is empty and remove it
                            const parentDir = path.dirname(generatedThumbnail);
                            const filesInDir = fs.readdirSync(parentDir);
                            if (filesInDir.length === 0) {
                                fs.rmdirSync(parentDir);
                            }
                        } else {
                            console.warn(`Thumbnail generation failed for ${fileName}, using placeholder`);
                            // Upload a placeholder thumbnail or leave as is
                            // You can upload a default placeholder image here if needed
                        }
                    } catch (thumbnailError) {
                        console.error(`Error generating/uploading thumbnail for ${fileName}:`, thumbnailError);
                        // Continue with upload even if thumbnail fails
                    }

                    // Create PDF file record in database
                    const pdfFile = await tx.pam_pdf_files.create({
                        data: {
                            pdf_id: pdfId,
                            dir_path: `pdfs/${year}/${month}/${day}`,
                            file_size: fileSize,
                            file_name: pdfFileName,
                            original_file_name: originalName,
                            source: source_name || 'User Upload',
                            enter_by: String(userId),
                            entered_on: new Date(),
                            updated_by: String(userId),
                            updated_on: new Date(),
                            is_trash: 'N',
                            trashed_by: '',
                            trashed_on: new Date(),
                            downloads: 0,
                            thumbnail_path: thumbnailPath,
                        }
                    });

                    totalFileSize += parseInt(fileSize);
                    uploadedFiles.push(pdfFile);

                } catch (uploadError) {
                    console.error(`Error uploading PDF ${file.originalname}:`, uploadError);
                    throw new Error(`Failed to upload PDF ${file.originalname}: ${uploadError.message}`);
                }
            }

            // 3. Update PDF with file stats
            const updatedPdf = await tx.pam_pdfs.update({
                where: { pdf_id: pdfId },
                data: {
                    file_size: String(totalFileSize),
                }
            });

            // 4. Process tags (if any) - using pam_photo_tags table
            if (tagIdsArray.length > 0) {
                const tagPromises = tagIdsArray.map(tagId =>
                    tx.pam_photo_tags.create({
                        data: {
                            photo_id: pdfId,
                            tag_id: parseInt(tagId)
                        }
                    })
                );
                await Promise.all(tagPromises);
            }

            return {
                pdf: updatedPdf,
                files: uploadedFiles,
                tagsProcessed: tagIdsArray.length
            };
        }, {
            timeout: 120000 // 120 seconds timeout for large uploads (increased for thumbnail generation)
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'create',
                module: 'pdfs',
                action: 'pdf_upload',
                message: `Uploaded ${files.length} PDF(s): "${result.pdf.title}"`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: result.pdf.title,
                resource_id: Number(result.pdf.pdf_id),
                created_at: new Date(),
                activity_code: 'PDF_UPLOAD_001'
            }
        });

        return res.status(201).json(
            successResponse('PDF(s) uploaded successfully', {
                pdf: {
                    id: result.pdf.pdf_id.toString(),
                    title: result.pdf.title,
                    total_files: result.files.length,
                    total_pages: result.pdf.total_pages || 0,
                    file_size: result.pdf.file_size
                },
                files: result.files.map(f => ({
                    id: f.file_id.toString(),
                    name: f.file_name,
                    original_name: f.original_file_name,
                    thumbnail_path: f.thumbnail_path
                }))
            })
        );

    } catch (error) {
        console.error('Upload PDFs error:', error);
        return res.status(500).json(
            errorResponse('Failed to upload PDFs', error.message)
        );
    }
};

// Add more PDF files to existing PDF
export const addPdfFiles = async (req, res) => {
    console.log("--- Add PDF Files to Existing PDF ---");

    try {
        const { id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);
        const files = req.files || [];

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        if (files.length === 0) {
            return res.status(400).json(
                errorResponse('No PDF files uploaded')
            );
        }

        // Check if PDF exists
        const existingPdf = await Prisma.pam_pdfs.findUnique({
            where: { pdf_id: pdfId }
        });

        if (!existingPdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');

        const uploadedFiles = [];

        for (const file of files) {
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const fileName = `${timestamp}_${randomString}`;
            const pdfFileName = `${fileName}.pdf`;
            const originalName = file.originalname || file.name;
            const fileSize = String(file.size);
            const fileBuffer = file.buffer;

            const fileKey = `uploads/pdfs/${year}/${month}/${day}/${pdfFileName}`;
            const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/thumb_${fileName}.png`;

            try {
                // Upload PDF to S3
                const fileUrl = await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                // Generate and upload thumbnail
                let thumbnailPath = thumbnailKey;
                try {
                    const localOutputDir = path.join(__dirname, '../../temp/thumbnails', `${year}/${month}/${day}`);

                    // Generate thumbnail
                    const generatedThumbnail = await generatePdfThumbnail(fileBuffer, localOutputDir, fileName);

                    if (generatedThumbnail && fs.existsSync(generatedThumbnail)) {
                        const thumbnailBuffer = fs.readFileSync(generatedThumbnail);
                        await uploadToS3Direct(thumbnailBuffer, thumbnailKey, 'image/png', false);
                        fs.unlinkSync(generatedThumbnail);

                        const parentDir = path.dirname(generatedThumbnail);
                        const filesInDir = fs.readdirSync(parentDir);
                        if (filesInDir.length === 0) {
                            fs.rmdirSync(parentDir);
                        }
                    }
                } catch (thumbnailError) {
                    console.error(`Error generating/uploading thumbnail for ${fileName}:`, thumbnailError);
                }

                const pdfFile = await Prisma.pam_pdf_files.create({
                    data: {
                        pdf_id: pdfId,
                        dir_path: `pdfs/${year}/${month}/${day}`,
                        file_size: fileSize,
                        file_name: pdfFileName,
                        original_file_name: originalName,
                        source: existingPdf.source_name || 'User Upload',
                        enter_by: String(userId),
                        entered_on: new Date(),
                        updated_by: String(userId),
                        updated_on: new Date(),
                        is_trash: 'N',
                        trashed_by: '',
                        trashed_on: new Date(),
                        downloads: 0,
                        thumbnail_path: thumbnailPath,
                    }
                });

                uploadedFiles.push(pdfFile);

            } catch (uploadError) {
                console.error(`Error uploading PDF ${file.originalname}:`, uploadError);
                throw new Error(`Failed to upload PDF ${file.originalname}: ${uploadError.message}`);
            }
        }

        // Update PDF total pages and file size
        let totalFileSize = parseInt(existingPdf.file_size || '0');
        for (const file of files) {
            totalFileSize += parseInt(file.size);
        }

        await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                file_size: String(totalFileSize),
                updated_on: new Date(),
                updated_by: parseInt(userId)
            }
        });

        // Log activity
        await Prisma.pam_activities.create({
            data: {
                user_id: parseInt(userId),
                user_name: req.user?.username || 'Admin',
                user_type: 'admin',
                activity_type: 'update',
                module: 'pdfs',
                action: 'pdf_files_add',
                message: `Added ${uploadedFiles.length} file(s) to PDF: "${existingPdf.title}" (ID: ${pdfId})`,
                status: 'success',
                severity: 'info',
                ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
                resource_name: existingPdf.title,
                resource_id: pdfId,
                created_at: new Date(),
                activity_code: 'PDF_FILES_ADD_001'
            }
        });

        return res.json({
            status: 'success',
            message: `${uploadedFiles.length} PDF file(s) added successfully`,
            data: {
                pdf_id: pdfId,
                added_files: uploadedFiles.map(f => ({
                    file_id: f.file_id.toString(),
                    file_name: f.file_name,
                    original_file_name: f.original_file_name,
                    file_size: f.file_size,
                    thumbnail_path: f.thumbnail_path
                })),
                total_files: uploadedFiles.length
            }
        });

    } catch (error) {
        console.error('Add PDF files error:', error);
        return res.status(500).json(
            errorResponse('Failed to add PDF files', error.message)
        );
    }
};