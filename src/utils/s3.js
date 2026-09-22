import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';

// AWS S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'oli-photoassets';
const CDN_URL = process.env.AWS_CDN_URL || `https://${S3_BUCKET_NAME}.s3.amazonaws.com`;

/**
 * Helper function to upload file to S3
 * @param {Buffer} fileBuffer - File content as buffer
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type
 * @param {boolean} isPublic - Whether the file should be publicly accessible
 * @returns {Promise<string>} Public URL of the uploaded file
 */
async function uploadToS3(fileBuffer, key, contentType, isPublic = true) {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  };

  // Only add ACL if we want the file to be public
  if (isPublic) {
    params.ACL = 'public-read';
  }

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  // Return public URL
  return `${CDN_URL}/${key}`;
}

/**
 * Helper function to generate S3 key with date-based directory structure
 * @param {string} fileName - Original file name
 * @param {boolean} isThumbnail - Whether it's a thumbnail
 * @param {string} prefix - Additional prefix (optional)
 * @returns {string} S3 key/path
 */
function generateS3Key(fileName, isThumbnail = false, prefix = 'uploads') {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
  const day = String(currentDate.getDate()).padStart(2, '0');

  if (isThumbnail) {
    return `${prefix}/testing/400/${year}/${month}/${day}/${fileName}`;
  }
  return `${prefix}/testing/${year}/${month}/${day}/${fileName}`;
}

/**
 * Get public URL for an S3 object
 * @param {string} key - S3 object key
 * @returns {string} Public URL
 */
function getPublicUrl(key) {
  return `${CDN_URL}/${key}`;
}

/**
 * Generate a signed URL for private S3 objects (valid for specified duration)
 * @param {string} key - S3 object key
 * @param {number} expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns {Promise<string>} Signed URL
 */
async function getSignedS3Url(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key
  });

  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
  return signedUrl;
}

/**
 * Delete an object from S3
 * @param {string} key - S3 object key
 * @returns {Promise<boolean>} Success status
 */
async function deleteFromS3(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    return false;
  }
}

/**
 * Upload image with automatic thumbnail generation to S3
 * @param {Buffer} fileBuffer - Original image buffer
 * @param {string} fileName - Original file name
 * @param {string} contentType - MIME type
 * @param {Object} options - Additional options
 * @param {number} options.thumbnailWidth - Thumbnail width (default: 400)
 * @param {number} options.thumbnailHeight - Thumbnail height (default: 400)
 * @param {string} options.prefix - S3 path prefix (default: 'uploads')
 * @returns {Promise<{mainUrl: string, thumbnailUrl: string, mainKey: string, thumbnailKey: string}>}
 */
async function uploadImageWithThumbnail(fileBuffer, fileName, contentType, options = {}) {
  const {
    thumbnailWidth = 400,
    thumbnailHeight = 400,
    prefix = 'uploads',
    isPublic = true
  } = options;

  // Generate unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const uniqueFileName = `${timestamp}_${randomString}${getFileExtension(fileName)}`;

  // Generate S3 keys
  const mainKey = generateS3Key(uniqueFileName, false, prefix);
  const thumbnailKey = generateS3Key(uniqueFileName, true, prefix);

  let mainUrl = '';
  let thumbnailUrl = '';

  try {
    // Upload original image
    mainUrl = await uploadToS3(fileBuffer, mainKey, contentType, isPublic);
    console.log(`Main image uploaded to S3: ${mainUrl}`);

    // Create and upload thumbnail
    const thumbnailBuffer = await sharp(fileBuffer)
      .resize({
        width: thumbnailWidth,
        height: thumbnailHeight,
        fit: 'inside',
        withoutEnlargement: true
      })
      .toBuffer();

    thumbnailUrl = await uploadToS3(thumbnailBuffer, thumbnailKey, contentType, isPublic);
    console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

    return {
      mainUrl,
      thumbnailUrl,
      mainKey,
      thumbnailKey,
      fileName: uniqueFileName,
      originalFileName: fileName
    };

  } catch (error) {
    console.error('Error uploading image with thumbnail:', error);

    // Cleanup: If main upload succeeded but thumbnail failed, delete the main file
    if (mainUrl && !thumbnailUrl) {
      await deleteFromS3(mainKey);
    }

    throw error;
  }
}

/**
 * Get file extension from filename
 * @param {string} fileName - File name
 * @returns {string} File extension including dot
 */
function getFileExtension(fileName) {
  return fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
}

/**
 * Generate S3 key for user uploads
 * @param {number} userId - User ID
 * @param {string} fileName - File name
 * @param {string} type - File type ('avatar', 'document', etc.)
 * @returns {string} S3 key
 */
function generateUserS3Key(userId, fileName, type = 'avatar') {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');

  const uniqueFileName = `${userId}_${Date.now()}_${fileName}`;

  return `users/${type}/${year}/${month}/${uniqueFileName}`;
}

/**
 * Upload user avatar to S3
 * @param {Buffer} fileBuffer - Image buffer
 * @param {number} userId - User ID
 * @param {string} originalFileName - Original file name
 * @param {string} contentType - MIME type
 * @returns {Promise<{url: string, key: string}>}
 */
async function uploadUserAvatar(fileBuffer, userId, originalFileName, contentType) {
  const key = generateUserS3Key(userId, originalFileName, 'avatars');
  const url = await uploadToS3(fileBuffer, key, contentType, true);

  return { url, key };
}

/**
 * Copy file within S3
 * @param {string} sourceKey - Source S3 key
 * @param {string} destinationKey - Destination S3 key
 * @returns {Promise<boolean>} Success status
 */
async function copyInS3(sourceKey, destinationKey) {
  try {
    const command = new CopyObjectCommand({
      Bucket: S3_BUCKET_NAME,
      CopySource: `${S3_BUCKET_NAME}/${sourceKey}`,
      Key: destinationKey,
      // ACL: 'public-read'
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error copying in S3:', error);
    return false;
  }
}

/**
 * Get object metadata from S3
 * @param {string} key - S3 object key
 * @returns {Promise<Object|null>} Object metadata
 */
async function getS3ObjectMetadata(key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key
    });

    const response = await s3Client.send(command);
    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      metadata: response.Metadata
    };
  } catch (error) {
    console.error('Error getting S3 object metadata:', error);
    return null;
  }
}

/**
 * List objects in S3 bucket with prefix
 * @param {string} prefix - Prefix to filter objects
 * @param {number} maxKeys - Maximum number of keys to return
 * @returns {Promise<Array>} List of objects
 */
async function listS3Objects(prefix = '', maxKeys = 100) {
  try {
    const command = new ListObjectsV2Command({
      Bucket: S3_BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys
    });

    const response = await s3Client.send(command);
    return response.Contents || [];
  } catch (error) {
    console.error('Error listing S3 objects:', error);
    return [];
  }
}

/**
 * Generate URL for CloudFront CDN (if configured)
 * @param {string} key - S3 object key
 * @returns {string} CloudFront URL
 */
function getCloudFrontUrl(key) {
  if (process.env.AWS_CLOUDFRONT_URL) {
    return `${process.env.AWS_CLOUDFRONT_URL}/${key}`;
  }
  return getPublicUrl(key);
}

/**
 * Upload file to S3 from local path
 * @param {string} filePath - Local file path
 * @param {string} key - S3 key
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Public URL
 */
async function uploadFileFromPath(filePath, key, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  return await uploadToS3(fileBuffer, key, contentType, true);
}

/**
 * Download file from S3 to local path
 * @param {string} key - S3 key
 * @param {string} localPath - Local file path to save to
 * @returns {Promise<boolean>} Success status
 */
async function downloadFileFromS3(key, localPath) {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key
    });

    const response = await s3Client.send(command);
    const fileStream = fs.createWriteStream(localPath);

    return new Promise((resolve, reject) => {
      response.Body.pipe(fileStream)
        .on('error', reject)
        .on('close', () => resolve(true));
    });
  } catch (error) {
    console.error('Error downloading from S3:', error);
    return false;
  }
}
// Create a simple upload function
async function uploadToS3Direct(fileBuffer, key, contentType, isPublic = true) {
  // Check credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials not configured');
  }

  const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME || 'oli-photoassets',
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  };

  // if (isPublic) {
  //   params.ACL = 'public-read';
  // }

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    // Return public URL
    return `https://${params.Bucket}.s3.amazonaws.com/${key}`;
  } catch (error) {
    console.error('S3 upload error details:', error);
    console.error('S3 params:', {
      bucket: params.Bucket,
      key: params.Key,
      region: process.env.AWS_REGION
    });
    throw error;
  }
}

export {
  s3Client,
  S3_BUCKET_NAME,
  CDN_URL,
  uploadToS3,
  generateS3Key,
  getPublicUrl,
  getSignedS3Url,
  deleteFromS3,
  uploadImageWithThumbnail,
  getFileExtension,
  generateUserS3Key,
  uploadUserAvatar,
  copyInS3,
  getS3ObjectMetadata,
  listS3Objects,
  getCloudFrontUrl,
  uploadFileFromPath,
  downloadFileFromS3,
  uploadToS3Direct
};

// Import additional AWS SDK commands as needed
import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';