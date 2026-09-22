import { Prisma } from '../../config/db.js';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { uploadToS3Direct } from '../../utils/s3.js';
import poppler from 'pdf-poppler';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createCanvas } from 'canvas';
import sharp from 'sharp';

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

// Helper function to convert PDF pages to images using pdf-poppler
async function convertPdfToImagesPoppler(pdfBuffer, outputDir, fileName) {
    try {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save PDF buffer to temp file
        const tempPdfPath = path.join(tempDir, `${fileName}.pdf`);
        fs.writeFileSync(tempPdfPath, pdfBuffer);
        console.log(`Temp PDF saved: ${tempPdfPath}`);

        const thumbnailPaths = [];
        
        // Process pages one by one in batches
        const maxPages = 200;
        const batchSize = 5;
        let generatedCount = 0;
        
        for (let startPage = 1; startPage <= maxPages; startPage += batchSize) {
            const endPage = Math.min(startPage + batchSize - 1, maxPages);
            console.log(`Processing pages ${startPage}-${endPage}...`);
            
            for (let page = startPage; page <= endPage; page++) {
                try {
                    const options = {
                        format: 'png',
                        out_dir: outputDir,
                        out_prefix: `thumb_${fileName}`,
                        page: page,
                        scale: 600,
                        overwrite: true
                    };
                    
                    await poppler.convert(tempPdfPath, options);
                    
                    // Check if file was created
                    const expectedFile = path.join(outputDir, `thumb_${fileName}-${page}.png`);
                    if (fs.existsSync(expectedFile)) {
                        thumbnailPaths.push(expectedFile);
                        generatedCount++;
                        console.log(`✅ Converted page ${page}`);
                    } else {
                        // Try alternative naming
                        const altFile = path.join(outputDir, `thumb_${fileName}${page}.png`);
                        if (fs.existsSync(altFile)) {
                            thumbnailPaths.push(altFile);
                            generatedCount++;
                            console.log(`✅ Converted page ${page} (alt naming)`);
                        } else {
                            if (page <= 3) {
                                console.warn(`⚠️ Page ${page} not found, may have reached end of PDF`);
                            }
                            if (generatedCount > 0 && page > startPage + 2) {
                                console.log(`📄 No more pages detected, stopping at ${page}`);
                                // Clean up temp PDF file before returning
                                try {
                                    if (fs.existsSync(tempPdfPath)) {
                                        fs.unlinkSync(tempPdfPath);
                                    }
                                } catch (unlinkError) {
                                    console.warn('Could not delete temp PDF file:', unlinkError);
                                }
                                return thumbnailPaths;
                            }
                        }
                    }
                } catch (pageError) {
                    console.error(`❌ Error converting page ${page}:`, pageError.message);
                    if (page <= 3) {
                        console.warn(`⚠️ Error on page ${page}, may have reached end of PDF`);
                        try {
                            if (fs.existsSync(tempPdfPath)) {
                                fs.unlinkSync(tempPdfPath);
                            }
                        } catch (unlinkError) {
                            console.warn('Could not delete temp PDF file:', unlinkError);
                        }
                        return thumbnailPaths;
                    }
                }
            }
            
            // After each batch, check if we're still generating files
            const currentThumbnails = fs.readdirSync(outputDir)
                .filter(f => f.startsWith(`thumb_${fileName}`) && f.endsWith('.png'));
            
            if (currentThumbnails.length === thumbnailPaths.length && thumbnailPaths.length > 0) {
                console.log(`📄 No new thumbnails generated in batch ${startPage}-${endPage}, stopping`);
                break;
            }
        }

        // Clean up temp PDF file
        try {
            if (fs.existsSync(tempPdfPath)) {
                fs.unlinkSync(tempPdfPath);
            }
        } catch (unlinkError) {
            console.warn('Could not delete temp PDF file:', unlinkError);
        }

        // Find all generated thumbnails and sort them properly
        const filesInDir = fs.readdirSync(outputDir);
        const generatedFiles = filesInDir
            .filter(f => f.startsWith(`thumb_${fileName}`) && f.endsWith('.png'))
            .sort((a, b) => {
                const pageA = parseInt(a.match(/thumb_.*-(\d+)\.png$/)?.[1] || '0');
                const pageB = parseInt(b.match(/thumb_.*-(\d+)\.png$/)?.[1] || '0');
                return pageA - pageB;
            });

        // If we have more thumbnails than in our list, update the list
        if (generatedFiles.length > thumbnailPaths.length) {
            console.log(`📄 Found ${generatedFiles.length} total thumbnails, updating list`);
            thumbnailPaths.length = 0;
            for (const file of generatedFiles) {
                thumbnailPaths.push(path.join(outputDir, file));
            }
        }

        console.log(`✅ Generated ${thumbnailPaths.length} thumbnails`);
        return thumbnailPaths;

    } catch (error) {
        console.error('❌ Error in PDF to image conversion:', error.message);
        throw error;
    }
}

// Helper function to convert PDF pages to images using pdf-poppler
async function convertPdfToImagesPoppler_1(pdfBuffer, outputDir, fileName) {
    try {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save PDF buffer to temp file
        const tempPdfPath = path.join(tempDir, `${fileName}.pdf`);
        fs.writeFileSync(tempPdfPath, pdfBuffer);
        console.log(`Temp PDF saved: ${tempPdfPath}`);

        const thumbnailPaths = [];
        const imagePaths = [];
        
        // Process pages one by one in batches
        const maxPages = 200;
        const batchSize = 5;
        let generatedCount = 0;
        
        // Create subdirectories for images and thumbnails
        const imagesDir = path.join(outputDir, 'images');
        const thumbsDir = path.join(outputDir, 'thumbnails');
        
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        if (!fs.existsSync(thumbsDir)) {
            fs.mkdirSync(thumbsDir, { recursive: true });
        }
        
        for (let startPage = 1; startPage <= maxPages; startPage += batchSize) {
            const endPage = Math.min(startPage + batchSize - 1, maxPages);
            console.log(`Processing pages ${startPage}-${endPage}...`);
            
            for (let page = startPage; page <= endPage; page++) {
                try {
                    // Generate FULL SIZE image (1000x1300px)
                    const imageOptions = {
                        format: 'png',
                        out_dir: imagesDir,
                        out_prefix: `page_${fileName}`,
                        page: page,
                        scale: 1400, // Higher DPI for better quality
                        overwrite: true
                    };
                    
                    await poppler.convert(tempPdfPath, imageOptions);
                    
                    // Check if full image was created
                    let fullImagePath = path.join(imagesDir, `page_${fileName}-${page}.png`);
                    if (!fs.existsSync(fullImagePath)) {
                        // Try alternative naming
                        const altImagePath = path.join(imagesDir, `page_${fileName}${page}.png`);
                        if (fs.existsSync(altImagePath)) {
                            fullImagePath = altImagePath;
                        } else {
                            console.warn(`⚠️ Full image for page ${page} not found`);
                            continue;
                        }
                    }
                    
                    // Read the full image to create thumbnail
                    const fullImageBuffer = fs.readFileSync(fullImagePath);
                    
                    // Generate THUMBNAIL (100x130px) using sharp or gm
                    // Since we're using poppler, we'll generate thumbnail separately
                    const thumbOptions = {
                        format: 'png',
                        out_dir: thumbsDir,
                        out_prefix: `thumb_${fileName}`,
                        page: page,
                        scale: 200, // Lower scale for thumbnail (approx 100x130px)
                        overwrite: true
                    };
                    
                    await poppler.convert(tempPdfPath, thumbOptions);
                    
                    // Check if thumbnail was created
                    let thumbPath = path.join(thumbsDir, `thumb_${fileName}-${page}.png`);
                    if (!fs.existsSync(thumbPath)) {
                        const altThumbPath = path.join(thumbsDir, `thumb_${fileName}${page}.png`);
                        if (fs.existsSync(altThumbPath)) {
                            thumbPath = altThumbPath;
                        } else {
                            console.warn(`⚠️ Thumbnail for page ${page} not found`);
                            // Try to create thumbnail from full image using sharp if available
                            try {
                                const sharp = await import('sharp');
                                const thumbBuffer = await sharp(fullImageBuffer)
                                    .resize(100, 130, {
                                        fit: 'contain',
                                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                                    })
                                    .png()
                                    .toBuffer();
                                
                                thumbPath = path.join(thumbsDir, `thumb_${fileName}-${page}.png`);
                                fs.writeFileSync(thumbPath, thumbBuffer);
                                console.log(`✅ Created thumbnail for page ${page} using sharp`);
                            } catch (sharpError) {
                                console.warn(`Could not create thumbnail for page ${page}:`, sharpError.message);
                            }
                        }
                    }
                    
                    imagePaths.push(fullImagePath);
                    thumbnailPaths.push(thumbPath);
                    generatedCount++;
                    console.log(`✅ Processed page ${page} (Full: ${path.basename(fullImagePath)}, Thumb: ${path.basename(thumbPath)})`);
                    
                } catch (pageError) {
                    console.error(`❌ Error processing page ${page}:`, pageError.message);
                    if (page <= 3) {
                        console.warn(`⚠️ Error on page ${page}, may have reached end of PDF`);
                        try {
                            if (fs.existsSync(tempPdfPath)) {
                                fs.unlinkSync(tempPdfPath);
                            }
                        } catch (unlinkError) {
                            console.warn('Could not delete temp PDF file:', unlinkError);
                        }
                        return { images: imagePaths, thumbnails: thumbnailPaths };
                    }
                }
            }
            
            // After each batch, check if we're still generating files
            const currentImages = fs.readdirSync(imagesDir)
                .filter(f => f.startsWith(`page_${fileName}`) && f.endsWith('.png'));
            
            if (currentImages.length === imagePaths.length && imagePaths.length > 0) {
                console.log(`📄 No new images generated in batch ${startPage}-${endPage}, stopping`);
                break;
            }
        }

        // Clean up temp PDF file
        try {
            if (fs.existsSync(tempPdfPath)) {
                fs.unlinkSync(tempPdfPath);
            }
        } catch (unlinkError) {
            console.warn('Could not delete temp PDF file:', unlinkError);
        }

        // Find all generated images and sort them properly
        const allImages = fs.readdirSync(imagesDir)
            .filter(f => f.startsWith(`page_${fileName}`) && f.endsWith('.png'))
            .sort((a, b) => {
                const pageA = parseInt(a.match(/page_.*-(\d+)\.png$/)?.[1] || '0');
                const pageB = parseInt(b.match(/page_.*-(\d+)\.png$/)?.[1] || '0');
                return pageA - pageB;
            });

        // Find all generated thumbnails and sort them properly
        const allThumbs = fs.readdirSync(thumbsDir)
            .filter(f => f.startsWith(`thumb_${fileName}`) && f.endsWith('.png'))
            .sort((a, b) => {
                const pageA = parseInt(a.match(/thumb_.*-(\d+)\.png$/)?.[1] || '0');
                const pageB = parseInt(b.match(/thumb_.*-(\d+)\.png$/)?.[1] || '0');
                return pageA - pageB;
            });

        // Update lists if we found more files
        if (allImages.length > imagePaths.length) {
            console.log(`📄 Found ${allImages.length} total images, updating list`);
            imagePaths.length = 0;
            for (const file of allImages) {
                imagePaths.push(path.join(imagesDir, file));
            }
        }

        if (allThumbs.length > thumbnailPaths.length) {
            console.log(`📄 Found ${allThumbs.length} total thumbnails, updating list`);
            thumbnailPaths.length = 0;
            for (const file of allThumbs) {
                thumbnailPaths.push(path.join(thumbsDir, file));
            }
        }

        console.log(`✅ Generated ${imagePaths.length} full images and ${thumbnailPaths.length} thumbnails`);
        return { images: imagePaths, thumbnails: thumbnailPaths };

    } catch (error) {
        console.error('❌ Error in PDF to image conversion:', error.message);
        throw error;
    }
}

// Alternative: Using sharp for better quality image processing
async function convertPdfToImagesPopplerSharp(pdfBuffer, outputDir, fileName) {
    try {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Ensure output directories exist
        const imagesDir = path.join(outputDir, 'images');
        const thumbsDir = path.join(outputDir, 'thumbnails');
        
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        if (!fs.existsSync(thumbsDir)) {
            fs.mkdirSync(thumbsDir, { recursive: true });
        }

        // Save PDF buffer to temp file
        const tempPdfPath = path.join(tempDir, `${fileName}.pdf`);
        fs.writeFileSync(tempPdfPath, pdfBuffer);
        console.log(`Temp PDF saved: ${tempPdfPath}`);

        const imagePaths = [];
        const thumbnailPaths = [];
        
        // Process pages
        const maxPages = 200;
        const batchSize = 5;
        let generatedCount = 0;
        
        // Import sharp for image processing
        const sharp = await import('sharp');
        
        for (let startPage = 1; startPage <= maxPages; startPage += batchSize) {
            const endPage = Math.min(startPage + batchSize - 1, maxPages);
            console.log(`Processing pages ${startPage}-${endPage}...`);
            
            for (let page = startPage; page <= endPage; page++) {
                try {
                    // Generate HIGH QUALITY image using poppler
                    const imageOptions = {
                        format: 'png',
                        out_dir: imagesDir,
                        out_prefix: `page_${fileName}`,
                        page: page,
                        scale: 1800, // Very high DPI for quality
                        overwrite: true
                    };
                    
                    await poppler.convert(tempPdfPath, imageOptions);
                    
                    // Check if image was created
                    let fullImagePath = path.join(imagesDir, `page_${fileName}-${page}.png`);
                    if (!fs.existsSync(fullImagePath)) {
                        const altImagePath = path.join(imagesDir, `page_${fileName}${page}.png`);
                        if (fs.existsSync(altImagePath)) {
                            fullImagePath = altImagePath;
                        } else {
                            console.warn(`⚠️ Image for page ${page} not found`);
                            continue;
                        }
                    }
                    
                    // Read the full image
                    const fullImageBuffer = fs.readFileSync(fullImagePath);
                    
                    // Create optimized full image (1000x1300px) using sharp
                    const optimizedImagePath = path.join(imagesDir, `optimized_page_${fileName}-${page}.png`);
                    await sharp(fullImageBuffer)
                        .resize(1000, 1300, {
                            fit: 'contain',
                            background: { r: 255, g: 255, b: 255, alpha: 1 }
                        })
                        .png({
                            compressionLevel: 9,
                            adaptiveFiltering: true,
                            quality: 100
                        })
                        .toFile(optimizedImagePath);
                    
                    // Create thumbnail (100x130px) using sharp
                    const thumbPath = path.join(thumbsDir, `thumb_${fileName}-${page}.png`);
                    await sharp(fullImageBuffer)
                        .resize(100, 130, {
                            fit: 'contain',
                            background: { r: 255, g: 255, b: 255, alpha: 1 }
                        })
                        .png({
                            compressionLevel: 9,
                            adaptiveFiltering: true
                        })
                        .toFile(thumbPath);
                    
                    // Delete the temporary poppler image
                    try {
                        fs.unlinkSync(fullImagePath);
                    } catch (unlinkError) {
                        // Ignore
                    }
                    
                    imagePaths.push(optimizedImagePath);
                    thumbnailPaths.push(thumbPath);
                    generatedCount++;
                    console.log(`✅ Processed page ${page}`);
                    
                } catch (pageError) {
                    console.error(`❌ Error processing page ${page}:`, pageError.message);
                    if (page <= 3) {
                        console.warn(`⚠️ Error on page ${page}, may have reached end of PDF`);
                        try {
                            if (fs.existsSync(tempPdfPath)) {
                                fs.unlinkSync(tempPdfPath);
                            }
                        } catch (unlinkError) {
                            console.warn('Could not delete temp PDF file:', unlinkError);
                        }
                        return { images: imagePaths, thumbnails: thumbnailPaths };
                    }
                }
            }
        }

        // Clean up temp PDF file
        try {
            if (fs.existsSync(tempPdfPath)) {
                fs.unlinkSync(tempPdfPath);
            }
        } catch (unlinkError) {
            console.warn('Could not delete temp PDF file:', unlinkError);
        }

        console.log(`✅ Generated ${imagePaths.length} full images and ${thumbnailPaths.length} thumbnails`);
        return { images: imagePaths, thumbnails: thumbnailPaths };

    } catch (error) {
        console.error('❌ Error in PDF to image conversion:', error.message);
        throw error;
    }
}

// Upload PDFs
export const uploadPdfs_0 = async (req, res) => {
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
            photography_time,
            author_id
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

        // Generate unique UUID for the PDF folder
        const pdfUuid = uuidv4();

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
            // Generate filename before creating PDF
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const fileName = `${timestamp}_${randomString}`;
            const pdfFileName = `${fileName}.pdf`;
            const originalName = files[0]?.originalname || files[0]?.name || 'untitled.pdf';
            const fileSize = String(files[0]?.size || 0);

            // 1. Create PDF record with file info
            const pdf = await tx.pam_pdfs.create({
                data: {
                    uuid: pdfUuid,
                    pdf_title: String(photo_title),
                    pdf_description: description || '',
                    event_name: event_name || '',
                    category_id: parseInt(category_id),
                    sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
                    author_id: author_id ? parseInt(author_id) : parseInt(userId),
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
                    // ✅ FIX: Set required file fields during creation
                    pdf_file_name: pdfFileName,
                    original_file_name: originalName,
                    file_size: fileSize,
                    dir_path: `pdfs/${year}/${month}/${day}/${pdfUuid}`,
                }
            });

            const pdfId = Number(pdf.pdf_id);
            let totalFileSize = 0;
            let totalPages = 0;

            // 2. Create temp directory for thumbnails
            const tempDir = path.join(__dirname, '../../temp/thumbnails', `${year}/${month}/${day}`, pdfUuid);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // 3. Process each PDF file
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileBuffer = file.buffer;

                // Generate S3 keys with UUID folder
                const fileKey = `uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/${pdfFileName}`;
                const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/thumb_${fileName}`;

                try {
                    // Upload PDF to S3
                    console.log(`Uploading PDF ${i + 1}/${files.length}: ${originalName} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
                    await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                    // Generate thumbnails
                    let thumbnailPaths = [];
                    let pageCount = 0;

                    try {
                        console.log(`🔄 Generating thumbnails for ${fileName}...`);

                        // Generate all page thumbnails locally
                        const localThumbnails = await convertPdfToImagesPoppler(fileBuffer, tempDir, fileName);
                        pageCount = localThumbnails.length;
                        
                        console.log(`📤 Uploading ${pageCount} thumbnails to S3...`);

                        // Upload each thumbnail to S3
                        for (let pageIndex = 0; pageIndex < localThumbnails.length; pageIndex++) {
                            const localPath = localThumbnails[pageIndex];
                            
                            if (fs.existsSync(localPath)) {
                                const stats = fs.statSync(localPath);
                                if (stats.size > 0) {
                                    const thumbBuffer = fs.readFileSync(localPath);
                                    const pageThumbnailKey = `${thumbnailKey}_page${pageIndex + 1}.png`;
                                    await uploadToS3Direct(thumbBuffer, pageThumbnailKey, 'image/png', false);
                                    
                                    const thumbnailUrl = `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/uploads/${pageThumbnailKey}`;
                                    thumbnailPaths.push({
                                        url: thumbnailUrl,
                                        path: pageThumbnailKey
                                    });
                                    console.log(`✅ Uploaded thumbnail for page ${pageIndex + 1}: ${pageThumbnailKey}`);
                                }
                            }
                        }

                        console.log(`✅ Successfully uploaded ${thumbnailPaths.length} thumbnails to S3`);

                        // Clean up local thumbnail files
                        for (const localPath of localThumbnails) {
                            try {
                                if (fs.existsSync(localPath)) {
                                    fs.unlinkSync(localPath);
                                }
                            } catch (unlinkError) {
                                console.warn(`Could not delete local thumbnail: ${localPath}`, unlinkError);
                            }
                        }

                        // Save thumbnails to database
                        for (let pageIndex = 0; pageIndex < thumbnailPaths.length; pageIndex++) {
                            const thumb = thumbnailPaths[pageIndex];
                            await tx.pam_pdf_thumbnails.create({
                                data: {
                                    pdf_id: pdfId,
                                    page_number: pageIndex + 1,
                                    thumbnail_url: thumb.url,
                                    thumbnail_path: thumb.path,
                                    is_cover: pageIndex === 0 ? 1 : 0,
                                    is_active: 1,
                                    is_trash: 'N',
                                    created_at: new Date(),
                                    updated_at: new Date()
                                }
                            });
                        }

                    } catch (thumbnailError) {
                        console.error(`❌ Error generating thumbnails:`, thumbnailError.message);
                        // Continue with upload even if thumbnail fails
                    }

                    totalFileSize += parseInt(file.size);
                    totalPages += pageCount || 1;

                } catch (uploadError) {
                    console.error(`Error uploading PDF:`, uploadError);
                    throw new Error(`Failed to upload PDF: ${uploadError.message}`);
                }
            }

            // 4. Clean up temp directory
            try {
                if (fs.existsSync(tempDir)) {
                    const remainingFiles = fs.readdirSync(tempDir);
                    if (remainingFiles.length === 0) {
                        fs.rmdirSync(tempDir);
                        const parentDir = path.dirname(tempDir);
                        try {
                            const parentFiles = fs.readdirSync(parentDir);
                            if (parentFiles.length === 0) {
                                fs.rmdirSync(parentDir);
                            }
                        } catch (parentError) {
                            // Ignore
                        }
                    }
                }
            } catch (cleanupError) {
                console.warn('Could not clean up temp directory:', cleanupError);
            }

            // 5. Update PDF with file stats and total pages
            const updatedPdf = await tx.pam_pdfs.update({
                where: { pdf_id: pdfId },
                data: {
                    file_size: String(totalFileSize),
                    total_pages: totalPages,
                    storage_url: `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/${pdfFileName}`,
                }
            });

            // 6. Process tags (if any)
            if (tagIdsArray.length > 0) {
                const batchSize = 50;
                for (let i = 0; i < tagIdsArray.length; i += batchSize) {
                    const batch = tagIdsArray.slice(i, i + batchSize);
                    const tagPromises = batch.map(tagId =>
                        tx.pam_photo_tags.create({
                            data: {
                                photo_id: pdfId,
                                tag_id: parseInt(tagId)
                            }
                        })
                    );
                    await Promise.all(tagPromises);
                }
            }

            return {
                pdf: updatedPdf,
                totalPages: totalPages
            };
        }, {
            timeout: 300000
        });

        // Log activity
        try {
            await Prisma.pam_pdf_activities.create({
                data: {
                    pdf_id: Number(result.pdf.pdf_id),
                    user_id: parseInt(userId),
                    action_type: 'upload',
                    action_description: `Uploaded PDF: "${result.pdf.pdf_title}" with ${result.totalPages} pages`,
                    details: JSON.stringify({
                        file_size: result.pdf.file_size,
                        total_pages: result.totalPages,
                        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                    }),
                    activity_time: new Date()
                }
            });
        } catch (logError) {
            console.error('Error logging activity:', logError);
        }

        return res.status(201).json(
            successResponse('PDF(s) uploaded successfully', {
                pdf: {
                    id: result.pdf.pdf_id.toString(),
                    uuid: pdfUuid,
                    title: result.pdf.pdf_title,
                    total_pages: result.totalPages,
                    file_size: result.pdf.file_size,
                    storage_url: result.pdf.storage_url
                }
            })
        );

    } catch (error) {
        console.error('Upload PDFs error:', error);
        return res.status(500).json(
            errorResponse('Failed to upload PDFs', error.message)
        );
    }
};

// Upload PDFs
export const uploadPdfs_1 = async (req, res) => {
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
            photography_time,
            author_id
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

        // Generate unique UUID for the PDF folder
        const pdfUuid = uuidv4();

        // Parse tag IDs from request
        let tagIdsArray = [];
        if (tag_ids) {
            if (Array.isArray(tag_ids)) {
                tagIdsArray = tag_ids;
            } else if (typeof tag_ids === 'string') {
                tagIdsArray = tag_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            }
        }

        // Generate filename before creating PDF
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileName = `${timestamp}_${randomString}`;
        const pdfFileName = `${fileName}.pdf`;
        const originalName = files[0]?.originalname || files[0]?.name || 'untitled.pdf';
        const fileSize = String(files[0]?.size || 0);

        // ✅ STEP 1: Create PDF record in transaction (FAST)
        const pdf = await Prisma.$transaction(async (tx) => {
            // Create PDF record with file info
            const pdf = await tx.pam_pdfs.create({
                data: {
                    uuid: pdfUuid,
                    pdf_title: String(photo_title),
                    pdf_description: description || '',
                    event_name: event_name || '',
                    category_id: parseInt(category_id),
                    sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
                    author_id: author_id ? parseInt(author_id) : parseInt(userId),
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
                    pdf_file_name: pdfFileName,
                    original_file_name: originalName,
                    file_size: fileSize,
                    dir_path: `pdfs/${year}/${month}/${day}/${pdfUuid}`,
                }
            });

            // Process tags (if any)
            if (tagIdsArray.length > 0) {
                const batchSize = 50;
                for (let i = 0; i < tagIdsArray.length; i += batchSize) {
                    const batch = tagIdsArray.slice(i, i + batchSize);
                    const tagPromises = batch.map(tagId =>
                        tx.pam_photo_tags.create({
                            data: {
                                photo_id: Number(pdf.pdf_id),
                                tag_id: parseInt(tagId)
                            }
                        })
                    );
                    await Promise.all(tagPromises);
                }
            }

            return pdf;
        }, {
            timeout: 60000 // 60 seconds for the transaction
        });

        const pdfId = Number(pdf.pdf_id);
        let totalFileSize = 0;
        let totalPages = 0;

        // ✅ STEP 2: Upload PDF to S3 and generate thumbnails (OUTSIDE transaction)
        // Create temp directory for thumbnails
        const tempDir = path.join(__dirname, '../../temp/thumbnails', `${year}/${month}/${day}`, pdfUuid);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Process each PDF file
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileBuffer = file.buffer;

            // Generate S3 keys with UUID folder
            const fileKey = `uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/${pdfFileName}`;
            const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/thumb_${fileName}`;

            try {
                // Upload PDF to S3
                console.log(`Uploading PDF ${i + 1}/${files.length}: ${originalName} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
                await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                // Generate thumbnails
                let thumbnailPaths = [];
                let pageCount = 0;

                try {
                    console.log(`🔄 Generating thumbnails for ${fileName}...`);

                    // Generate all page thumbnails locally
                    const localThumbnails = await convertPdfToImagesPoppler(fileBuffer, tempDir, fileName);
                    pageCount = localThumbnails.length;
                    
                    console.log(`📤 Uploading ${pageCount} thumbnails to S3...`);

                    // Upload each thumbnail to S3
                    for (let pageIndex = 0; pageIndex < localThumbnails.length; pageIndex++) {
                        const localPath = localThumbnails[pageIndex];
                        
                        if (fs.existsSync(localPath)) {
                            const stats = fs.statSync(localPath);
                            if (stats.size > 0) {
                                const thumbBuffer = fs.readFileSync(localPath);
                                const pageThumbnailKey = `${thumbnailKey}_page${pageIndex + 1}.png`;
                                await uploadToS3Direct(thumbBuffer, pageThumbnailKey, 'image/png', false);
                                
                                // const thumbnailUrl = `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/uploads/${pageThumbnailKey}`;
                                const thumbnailUrl = `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/${pageThumbnailKey}`;
                                thumbnailPaths.push({
                                    url: thumbnailUrl,
                                    path: pageThumbnailKey
                                });
                                console.log(`✅ Uploaded thumbnail for page ${pageIndex + 1}: ${pageThumbnailKey}`);
                            }
                        }
                    }

                    console.log(`✅ Successfully uploaded ${thumbnailPaths.length} thumbnails to S3`);

                    // Clean up local thumbnail files
                    for (const localPath of localThumbnails) {
                        try {
                            if (fs.existsSync(localPath)) {
                                fs.unlinkSync(localPath);
                            }
                        } catch (unlinkError) {
                            console.warn(`Could not delete local thumbnail: ${localPath}`, unlinkError);
                        }
                    }

                    // ✅ STEP 3: Save thumbnails to database (OUTSIDE transaction)
                    // Use individual queries or a single transaction with shorter timeout
                    for (let pageIndex = 0; pageIndex < thumbnailPaths.length; pageIndex++) {
                        const thumb = thumbnailPaths[pageIndex];
                        await Prisma.pam_pdf_thumbnails.create({
                            data: {
                                pdf_id: pdfId,
                                page_number: pageIndex + 1,
                                thumbnail_url: thumb.url,
                                thumbnail_path: thumb.path,
                                is_cover: pageIndex === 0 ? 1 : 0,
                                is_active: 1,
                                is_trash: 'N',
                                created_at: new Date(),
                                updated_at: new Date()
                            }
                        });
                    }

                } catch (thumbnailError) {
                    console.error(`❌ Error generating thumbnails:`, thumbnailError.message);
                    // Continue with upload even if thumbnail fails
                }

                totalFileSize += parseInt(file.size);
                totalPages += pageCount || 1;

            } catch (uploadError) {
                console.error(`Error uploading PDF:`, uploadError);
                throw new Error(`Failed to upload PDF: ${uploadError.message}`);
            }
        }

        // Clean up temp directory
        try {
            if (fs.existsSync(tempDir)) {
                const remainingFiles = fs.readdirSync(tempDir);
                if (remainingFiles.length === 0) {
                    fs.rmdirSync(tempDir);
                    const parentDir = path.dirname(tempDir);
                    try {
                        const parentFiles = fs.readdirSync(parentDir);
                        if (parentFiles.length === 0) {
                            fs.rmdirSync(parentDir);
                        }
                    } catch (parentError) {
                        // Ignore
                    }
                }
            }
        } catch (cleanupError) {
            console.warn('Could not clean up temp directory:', cleanupError);
        }

        // ✅ STEP 4: Update PDF with file stats and total pages (OUTSIDE transaction)
        const updatedPdf = await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                file_size: String(totalFileSize),
                total_pages: totalPages,
                storage_url: `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/${pdfFileName}`,
            }
        });

        // Log activity
        try {
            await Prisma.pam_pdf_activities.create({
                data: {
                    pdf_id: pdfId,
                    user_id: parseInt(userId),
                    action_type: 'upload',
                    action_description: `Uploaded PDF: "${updatedPdf.pdf_title}" with ${totalPages} pages`,
                    details: JSON.stringify({
                        file_size: updatedPdf.file_size,
                        total_pages: totalPages,
                        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                    }),
                    activity_time: new Date()
                }
            });
        } catch (logError) {
            console.error('Error logging activity:', logError);
        }

        return res.status(201).json(
            successResponse('PDF(s) uploaded successfully', {
                pdf: {
                    id: updatedPdf.pdf_id.toString(),
                    uuid: pdfUuid,
                    title: updatedPdf.pdf_title,
                    total_pages: totalPages,
                    file_size: updatedPdf.file_size,
                    storage_url: updatedPdf.storage_url
                }
            })
        );

    } catch (error) {
        console.error('Upload PDFs error:', error);
        return res.status(500).json(
            errorResponse('Failed to upload PDFs', error.message)
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
            photography_time,
            author_id
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

        // Generate unique UUID for the PDF folder
        const pdfUuid = uuidv4();

        // Parse tag IDs from request
        let tagIdsArray = [];
        if (tag_ids) {
            if (Array.isArray(tag_ids)) {
                tagIdsArray = tag_ids;
            } else if (typeof tag_ids === 'string') {
                tagIdsArray = tag_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            }
        }

        // Generate filename before creating PDF
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileName = `${timestamp}_${randomString}`;
        const pdfFileName = `${fileName}.pdf`;
        const originalName = files[0]?.originalname || files[0]?.name || 'untitled.pdf';
        const fileSize = String(files[0]?.size || 0);

        // ✅ STEP 1: Create PDF record in transaction (FAST)
        const pdf = await Prisma.$transaction(async (tx) => {
            // Create PDF record with file info
            const pdf = await tx.pam_pdfs.create({
                data: {
                    uuid: pdfUuid,
                    pdf_title: String(photo_title),
                    pdf_description: description || '',
                    event_name: event_name || '',
                    category_id: parseInt(category_id),
                    sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
                    author_id: author_id ? parseInt(author_id) : parseInt(userId),
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
                    pdf_file_name: pdfFileName,
                    original_file_name: originalName,
                    file_size: fileSize,
                    dir_path: `pdfs/${year}/${month}/${day}/${pdfUuid}`,
                }
            });

            // Process tags (if any)
            if (tagIdsArray.length > 0) {
                const batchSize = 50;
                for (let i = 0; i < tagIdsArray.length; i += batchSize) {
                    const batch = tagIdsArray.slice(i, i + batchSize);
                    const tagPromises = batch.map(tagId =>
                        tx.pam_photo_tags.create({
                            data: {
                                photo_id: Number(pdf.pdf_id),
                                tag_id: parseInt(tagId)
                            }
                        })
                    );
                    await Promise.all(tagPromises);
                }
            }

            return pdf;
        }, {
            timeout: 60000 // 60 seconds for the transaction
        });

        const pdfId = Number(pdf.pdf_id);
        let totalFileSize = 0;
        let totalPages = 0;

        // ✅ STEP 2: Upload PDF to S3 and generate images (OUTSIDE transaction)
        // Create temp directory for images
        const tempDir = path.join(__dirname, '../../temp/thumbnails', `${year}/${month}/${day}`, pdfUuid);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Process each PDF file
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileBuffer = file.buffer;

            // Generate S3 keys with UUID folder
            const fileKey = `uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/${pdfFileName}`;
            const thumbnailKey = `uploads/pdfs/${year}/${month}/${day}/${pdfUuid}/${fileName}`;

            try {
                // Upload PDF to S3
                console.log(`Uploading PDF ${i + 1}/${files.length}: ${originalName} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
                await uploadToS3Direct(fileBuffer, fileKey, 'application/pdf', false);

                // Generate images and thumbnails
                let pageCount = 0;

                try {
                    console.log(`🔄 Generating images and thumbnails for ${fileName}...`);

                    // Generate all page images and thumbnails locally
                    const result = await convertPdfToImagesPoppler_1(fileBuffer, tempDir, fileName);
                    const localImages = result.images || [];
                    const localThumbnails = result.thumbnails || [];
                    
                    pageCount = localImages.length;
                    console.log(`📤 Uploading ${pageCount} images and ${localThumbnails.length} thumbnails to S3...`);

                    // Prepare data for database
                    const thumbnailData = [];

                    // Upload FULL IMAGES to S3 and store in thumbnail_url
                    for (let pageIndex = 0; pageIndex < localImages.length; pageIndex++) {
                        const localPath = localImages[pageIndex];
                        
                        if (fs.existsSync(localPath)) {
                            const stats = fs.statSync(localPath);
                            if (stats.size > 0) {
                                const imageBuffer = fs.readFileSync(localPath);
                                const pageImageKey = `${thumbnailKey}_page${pageIndex + 1}.png`;
                                await uploadToS3Direct(imageBuffer, pageImageKey, 'image/png', false);
                                
                                const fullImageUrl = `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/${pageImageKey}`;
                                
                                // Upload THUMBNAIL to S3 (small version)
                                const thumbPath = localThumbnails[pageIndex] || localPath;
                                let thumbUrl = fullImageUrl; // Fallback to full image
                                
                                if (fs.existsSync(thumbPath) && thumbPath !== localPath) {
                                    const thumbStats = fs.statSync(thumbPath);
                                    if (thumbStats.size > 0) {
                                        const thumbBuffer = fs.readFileSync(thumbPath);
                                        const pageThumbnailKey = `${thumbnailKey}_thumb_page${pageIndex + 1}.png`;
                                        await uploadToS3Direct(thumbBuffer, pageThumbnailKey, 'image/png', false);
                                        thumbUrl = `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/${pageThumbnailKey}`;
                                        console.log(`✅ Uploaded thumbnail for page ${pageIndex + 1}: ${pageThumbnailKey}`);
                                    }
                                }
                                
                                // Store data for database
                                thumbnailData.push({
                                    page_number: pageIndex + 1,
                                    thumbnail_url: fullImageUrl, // Full size image (1000x1300)
                                    thumbnail_path: thumbUrl,    // Thumbnail (100x130)
                                    is_cover: pageIndex === 0 ? 1 : 0
                                });
                                
                                console.log(`✅ Uploaded full image for page ${pageIndex + 1}: ${pageImageKey}`);
                            }
                        }
                    }

                    console.log(`✅ Successfully uploaded ${thumbnailData.length} images to S3`);

                    // Clean up local files
                    const allLocalFiles = [...localImages, ...localThumbnails];
                    for (const localPath of allLocalFiles) {
                        try {
                            if (fs.existsSync(localPath)) {
                                fs.unlinkSync(localPath);
                            }
                        } catch (unlinkError) {
                            console.warn(`Could not delete local file: ${localPath}`, unlinkError);
                        }
                    }

                    // Clean up directories
                    try {
                        const imagesDir = path.join(tempDir, 'images');
                        const thumbsDir = path.join(tempDir, 'thumbnails');
                        
                        if (fs.existsSync(imagesDir)) {
                            const files = fs.readdirSync(imagesDir);
                            if (files.length === 0) {
                                fs.rmdirSync(imagesDir);
                            }
                        }
                        if (fs.existsSync(thumbsDir)) {
                            const files = fs.readdirSync(thumbsDir);
                            if (files.length === 0) {
                                fs.rmdirSync(thumbsDir);
                            }
                        }
                    } catch (cleanupError) {
                        console.warn('Could not clean up directories:', cleanupError);
                    }

                    // ✅ STEP 3: Save to database - Use thumbnail_url for full image, thumbnail_path for thumbnail
                    for (const data of thumbnailData) {
                        await Prisma.pam_pdf_thumbnails.create({
                            data: {
                                pdf_id: pdfId,
                                page_number: data.page_number,
                                thumbnail_url: data.thumbnail_url,   // Full size image (1000x1300)
                                thumbnail_path: data.thumbnail_path,  // Thumbnail (100x130)
                                is_cover: data.is_cover,
                                is_active: 1,
                                is_trash: 'N',
                                created_at: new Date(),
                                updated_at: new Date()
                            }
                        });
                    }

                    // Update PDF with total pages
                    await Prisma.pam_pdfs.update({
                        where: { pdf_id: pdfId },
                        data: {
                            total_pages: pageCount,
                        }
                    });

                } catch (thumbnailError) {
                    console.error(`❌ Error generating images/thumbnails:`, thumbnailError.message);
                    // Continue with upload even if thumbnail fails
                }

                totalFileSize += parseInt(file.size);
                totalPages += pageCount || 1;

            } catch (uploadError) {
                console.error(`Error uploading PDF:`, uploadError);
                throw new Error(`Failed to upload PDF: ${uploadError.message}`);
            }
        }

        // Clean up temp directory
        try {
            if (fs.existsSync(tempDir)) {
                const remainingFiles = fs.readdirSync(tempDir);
                if (remainingFiles.length === 0) {
                    fs.rmdirSync(tempDir);
                    const parentDir = path.dirname(tempDir);
                    try {
                        const parentFiles = fs.readdirSync(parentDir);
                        if (parentFiles.length === 0) {
                            fs.rmdirSync(parentDir);
                        }
                    } catch (parentError) {
                        // Ignore
                    }
                }
            }
        } catch (cleanupError) {
            console.warn('Could not clean up temp directory:', cleanupError);
        }

        // ✅ STEP 4: Update PDF with file stats
        const updatedPdf = await Prisma.pam_pdfs.update({
            where: { pdf_id: pdfId },
            data: {
                file_size: String(totalFileSize),
                total_pages: totalPages,
                storage_url: `${process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com'}/pdfs/${year}/${month}/${day}/${pdfUuid}/${pdfFileName}`,
            }
        });

        // Log activity
        try {
            await Prisma.pam_pdf_activities.create({
                data: {
                    pdf_id: pdfId,
                    user_id: parseInt(userId),
                    action_type: 'upload',
                    action_description: `Uploaded PDF: "${updatedPdf.pdf_title}" with ${totalPages} pages`,
                    details: JSON.stringify({
                        file_size: updatedPdf.file_size,
                        total_pages: totalPages,
                        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                    }),
                    activity_time: new Date()
                }
            });
        } catch (logError) {
            console.error('Error logging activity:', logError);
        }

        return res.status(201).json(
            successResponse('PDF(s) uploaded successfully', {
                pdf: {
                    id: updatedPdf.pdf_id.toString(),
                    uuid: pdfUuid,
                    title: updatedPdf.pdf_title,
                    total_pages: totalPages,
                    file_size: updatedPdf.file_size,
                    storage_url: updatedPdf.storage_url
                }
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
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const category_id = req.query.category_id ? parseInt(req.query.category_id) : undefined;
        const is_active = req.query.is_active !== undefined ? parseInt(req.query.is_active) : undefined;

        const where = {
            is_trash: 0,
            ...(search && {
                OR: [
                    { pdf_title: { contains: search } },
                    { pdf_description: { contains: search } },
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
                thumbnails: {
                    where: { is_trash: 'N', is_active: 1 },
                    orderBy: { page_number: 'asc' },
                    take: 1
                }
            }
        });

        const formattedPdfs = pdfs.map(pdf => ({
            ...pdf,
            pdf_id: pdf.pdf_id.toString(),
            cover_thumbnail: pdf.thumbnails && pdf.thumbnails.length > 0 ? pdf.thumbnails[0] : null,
            thumbnail_count: pdf.thumbnails ? pdf.thumbnails.length : 0
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
                thumbnails: {
                    where: { is_trash: 'N', is_active: 1 },
                    orderBy: { page_number: 'asc' }
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
            pdf_title,
            pdf_description,
            event_name,
            author_id,
            photo_credit_id,
            category_id,
            sub_category_id,
            source_name,
            max_download,
            price,
            keywords,
            is_active,
            pdf_tags,
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
                pdf_title: pdf_title || existingPdf.pdf_title,
                pdf_description: pdf_description !== undefined ? pdf_description : existingPdf.pdf_description,
                event_name: event_name !== undefined ? event_name : existingPdf.event_name,
                category_id: category_id ? parseInt(category_id) : existingPdf.category_id,
                sub_category_id: sub_category_id ? parseInt(sub_category_id) : existingPdf.sub_category_id,
                author_id: author_id ? parseInt(author_id) : existingPdf.author_id,
                source_name: source_name !== undefined ? source_name : existingPdf.source_name,
                credit: photo_credit_id ? parseInt(photo_credit_id) : existingPdf.credit,
                max_download: max_download !== undefined ? parseInt(max_download) : existingPdf.max_download,
                price: price !== undefined ? parseFloat(price) : existingPdf.price,
                keywords: keywords !== undefined ? keywords : existingPdf.keywords,
                pdf_tags: pdf_tags !== undefined ? pdf_tags : existingPdf.pdf_tags,
                is_active: is_active !== undefined ? parseInt(is_active) : existingPdf.is_active,
                photography_time: photography_time ? new Date(photography_time) : existingPdf.photography_time,
                updated_on: new Date(),
                updated_by: parseInt(userId)
            }
        });

        // Log activity
        await Prisma.pam_pdf_activities.create({
            data: {
                pdf_id: pdfId,
                user_id: parseInt(userId),
                action_type: 'edit',
                action_description: `Updated PDF: "${updatedPdf.pdf_title}"`,
                details: JSON.stringify({
                    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                }),
                activity_time: new Date()
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
            errorResponse('Failed to update PDF', error)
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

        await Prisma.pam_pdf_thumbnails.updateMany({
            where: { pdf_id: pdfId },
            data: {
                is_trash: 'Y',
                updated_at: new Date()
            }
        });

        // Log activity
        await Prisma.pam_pdf_activities.create({
            data: {
                pdf_id: pdfId,
                user_id: parseInt(userId),
                action_type: 'delete',
                action_description: `Moved PDF to trash: "${existingPdf.pdf_title}"`,
                details: JSON.stringify({
                    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                }),
                activity_time: new Date()
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF moved to trash successfully',
            data: {
                pdf_id: pdfId,
                title: existingPdf.pdf_title,
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

        await Prisma.pam_pdf_thumbnails.updateMany({
            where: { pdf_id: pdfId },
            data: {
                is_trash: 'N',
                updated_at: new Date()
            }
        });

        // Log activity
        await Prisma.pam_pdf_activities.create({
            data: {
                pdf_id: pdfId,
                user_id: parseInt(userId),
                action_type: 'restore',
                action_description: `Restored PDF from trash: "${existingPdf.pdf_title}"`,
                details: JSON.stringify({
                    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                }),
                activity_time: new Date()
            }
        });

        return res.json({
            status: 'success',
            message: 'PDF restored successfully',
            data: {
                pdf_id: pdfId,
                title: existingPdf.pdf_title,
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
            Prisma.pam_pdfs.aggregate({
                where: { is_trash: 0 },
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

// Delete a specific thumbnail
export const deleteThumbnail = async (req, res) => {
    try {
        const { id, thumbnail_id } = req.params;
        const userId = req.user?.id || req.admin?.admin_id;
        const pdfId = parseInt(id);
        const thumbnailId = parseInt(thumbnail_id);

        if (isNaN(pdfId) || isNaN(thumbnailId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID or Thumbnail ID')
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

        // Check if thumbnail exists and belongs to this PDF
        const existingThumbnail = await Prisma.pam_pdf_thumbnails.findFirst({
            where: {
                thumbnail_id: thumbnailId,
                pdf_id: pdfId,
                is_trash: 'N'
            }
        });

        if (!existingThumbnail) {
            return res.status(404).json(
                errorResponse('Thumbnail not found')
            );
        }

        // Soft delete the thumbnail
        await Prisma.pam_pdf_thumbnails.update({
            where: { thumbnail_id: thumbnailId },
            data: {
                is_trash: 'Y',
                is_active: 0,
                updated_at: new Date()
            }
        });

        // Log activity
        await Prisma.pam_pdf_activities.create({
            data: {
                pdf_id: pdfId,
                user_id: parseInt(userId),
                action_type: 'delete',
                action_description: `Deleted thumbnail page ${existingThumbnail.page_number} from PDF: "${existingPdf.pdf_title}"`,
                details: JSON.stringify({
                    page_number: existingThumbnail.page_number,
                    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                }),
                activity_time: new Date()
            }
        });

        return res.json({
            status: 'success',
            message: 'Thumbnail deleted successfully',
            data: {
                thumbnail_id: thumbnailId,
                page_number: existingThumbnail.page_number
            }
        });

    } catch (error) {
        console.error('Delete thumbnail error:', error);
        return res.status(500).json(
            errorResponse('Failed to delete thumbnail', error)
        );
    }
};

// Download PDF file and increment download count
export const downloadPdfFile = async (req, res) => {
    console.log("--- Download PDF File ---");
    try {
        const { file_id } = req.params;
        console.log(`Download file ID: ${file_id}`);

        if (!file_id) {
            return res.status(400).json(
                errorResponse('File ID is required')
            );
        }

        // Get PDF details
        const pdf = await Prisma.pam_pdfs.findFirst({
            where: {
                pdf_id: parseInt(file_id),
                is_trash: 0,
                is_active: 1
            }
        });

        if (!pdf) {
            return res.status(404).json(
                errorResponse('PDF not found or not accessible')
            );
        }

        // Increment download count
        try {
            await Prisma.pam_pdfs.update({
                where: { pdf_id: parseInt(file_id) },
                data: {
                    downloads: {
                        increment: 1
                    },
                    updated_on: new Date()
                }
            });
            console.log(`✅ PDF Downloads updated for: ${pdf.pdf_title}`);
        } catch (updateError) {
            console.error('Failed to update downloads count:', updateError);
        }

        // Log activity
        try {
            await Prisma.pam_pdf_activities.create({
                data: {
                    pdf_id: parseInt(file_id),
                    user_id: req.user?.id || 0,
                    action_type: 'download',
                    action_description: `Downloaded PDF: "${pdf.pdf_title}"`,
                    details: JSON.stringify({
                        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
                    }),
                    activity_time: new Date()
                }
            });
        } catch (logError) {
            console.error('Failed to log download activity:', logError);
        }

        // Get S3 URL
        const ASSET_BASE_URL = process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com';
        let fileUrl;
        if (pdf.dir_path && pdf.pdf_file_name) {
            const cleanDirPath = pdf.dir_path.replace(/^\/|\/$/g, '');
            fileUrl = `${ASSET_BASE_URL}/uploads/${cleanDirPath}/${pdf.pdf_file_name}`;
            console.log(`📄 File URL: ${fileUrl}`);
        } else {
            return res.status(404).json(
                errorResponse('File URL not found')
            );
        }

        // Fetch the file from S3
        const response = await fetch(fileUrl);

        if (!response.ok) {
            console.error(`Failed to fetch file: ${response.status}`);
            return res.status(404).json(
                errorResponse('File not found in storage')
            );
        }

        // Get the file buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'application/pdf';

        // Set headers for PDF download
        const filename = pdf.original_file_name || `${pdf.pdf_title}.pdf`;
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

        // Send the file
        res.send(buffer);

    } catch (error) {
        console.error('Download PDF file error:', error);
        return res.status(500).json(
            errorResponse('Failed to download PDF file', error.message)
        );
    }
};

// Get user's own PDFs
export const getMyPdfs = async (req, res) => {
    try {
        const userId = req.user?.id || req.query.user_id;

        if (!userId) {
            return res.status(400).json(
                errorResponse('User ID is required')
            );
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const where = {
            author_id: parseInt(userId),
            is_trash: 0,
            ...(search && {
                OR: [
                    { pdf_title: { contains: search } },
                    { pdf_description: { contains: search } },
                    { event_name: { contains: search } }
                ]
            })
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
                thumbnails: {
                    where: { is_trash: 'N', is_active: 1 },
                    orderBy: { page_number: 'asc' },
                    take: 1
                }
            }
        });

        const formattedPdfs = pdfs.map(pdf => ({
            ...pdf,
            pdf_id: pdf.pdf_id.toString(),
            cover_thumbnail: pdf.thumbnails && pdf.thumbnails.length > 0 ? pdf.thumbnails[0] : null,
            thumbnail_count: pdf.thumbnails ? pdf.thumbnails.length : 0
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
        console.error('Get my PDFs error:', error);
        return res.status(500).json(
            errorResponse('Failed to fetch your PDFs', error)
        );
    }
};

// Add more PDF files (not needed with new schema - one file per PDF)
// Keeping for compatibility but deprecated
export const addPdfFiles = async (req, res) => {
    return res.status(400).json(
        errorResponse('This endpoint is deprecated. Use /upload endpoint instead.')
    );
};
// FOR PDF PREVIEW
export const getThumbnail = async (req, res) => {
  const { uuid, page } = req.params;
  const ASSET_BASE_URL = process.env.VITE_S3_BASE_URL || 'https://oli-photoassets.s3.ap-south-1.amazonaws.com';
  const thumbnailUrl = `${ASSET_BASE_URL}/uploads/pdfs/thumbnails/${uuid}/thumb_page_${page}.png`;
  // Redirect to the actual thumbnail URL
  res.redirect(thumbnailUrl);
};
// Get all thumbnails for a PDF
export const getPdfThumbnails = async (req, res) => {
    console.log('--- I AM IN getPdfThumbnails ---')
    try {
        const { id } = req.params;
        const pdfId = parseInt(id);

        if (isNaN(pdfId)) {
            return res.status(400).json(
                errorResponse('Invalid PDF ID')
            );
        }

        // First check if PDF exists and is not trashed
        const pdf = await Prisma.pam_pdfs.findUnique({
            where: { 
                pdf_id: pdfId,
                is_trash: 0
            },
            select: {
                pdf_id: true,
                uuid: true,
                pdf_title: true,
                total_pages: true
            }
        });

        if (!pdf) {
            return res.status(404).json(
                errorResponse('PDF not found')
            );
        }

        // Get all thumbnails for this PDF
        const thumbnails = await Prisma.pam_pdf_thumbnails.findMany({
            where: {
                pdf_id: pdfId,
                is_trash: 'N',
                is_active: 1
            },
            orderBy: {
                page_number: 'asc'
            },
            select: {
                thumbnail_id: true,
                page_number: true,
                thumbnail_url: true,
                thumbnail_path: true,
                is_cover: true
            }
        });

        return res.json({
            status: 'success',
            data: {
                pdf: {
                    id: pdf.pdf_id.toString(),
                    uuid: pdf.uuid,
                    title: pdf.pdf_title,
                    total_pages: pdf.total_pages
                },
                thumbnails: serializeBigInt(thumbnails)
            }
        });

    } catch (error) {
        console.error('Get PDF thumbnails error:', error);
        return res.status(500).json(
            errorResponse('Failed to fetch thumbnails', error)
        );
    }
};
// END FOR PDF PREVIEW