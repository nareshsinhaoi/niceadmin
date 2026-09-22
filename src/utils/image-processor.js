import sharp from 'sharp';
import exifr from 'exifr';

/**
 * Extract EXIF data from image buffer
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Object>} EXIF data
 */
export async function extractExifFromBuffer(imageBuffer) {
  try {
    const exif = await exifr.parse(imageBuffer, {
      gps: true,
      xmp: true,
      iptc: true,
      tiff: true,
      ifd0: true,
      ifd1: true,
      exif: true,
      interop: true,
    });

    return exif || {};
  } catch (error) {
    console.error('Error extracting EXIF data:', error);
    return {};
  }
}

/**
 * Get image metadata using sharp
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Object>} Image metadata
 */
export async function getImageMetadata(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      orientation: metadata.orientation || 1,
      format: metadata.format || 'unknown',
      size: imageBuffer.length,
      hasAlpha: metadata.hasAlpha || false,
      space: metadata.space || 'srgb'
    };
  } catch (error) {
    console.error('Error getting image metadata:', error);
    return {
      width: 0,
      height: 0,
      orientation: 1,
      format: 'unknown',
      size: 0,
      hasAlpha: false,
      space: 'unknown'
    };
  }
}

/**
 * Create thumbnail from image buffer
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} options - Thumbnail options
 * @returns {Promise<Buffer>} Thumbnail buffer
 */
export async function createThumbnail(imageBuffer, options = {}) {
  const {
    width = 400,
    height = 400,
    fit = 'inside',
    quality = 80,
    format = 'jpeg'
  } = options;

  try {
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize({
        width,
        height,
        fit,
        withoutEnlargement: true
      })
      .toFormat(format, { quality })
      .toBuffer();

    return thumbnailBuffer;
  } catch (error) {
    console.error('Error creating thumbnail:', error);
    throw error;
  }
}

/**
 * Determine image orientation
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} tolerance - Tolerance ratio
 * @returns {string} Orientation ('horizontal', 'vertical', 'square')
 */
export function getOrientationScientific(width, height, tolerance = 0.05) {
  if (!width || !height) return 'unknown';
  
  const ratio = width / height;
  if (ratio > 1 + tolerance) return "horizontal";
  if (ratio < 1 - tolerance) return "vertical";
  return "square";
}

/**
 * Convert image to different format
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {string} format - Target format ('jpeg', 'png', 'webp')
 * @param {Object} options - Conversion options
 * @returns {Promise<Buffer>} Converted image buffer
 */
export async function convertImageFormat(imageBuffer, format = 'webp', options = {}) {
  const { quality = 80 } = options;

  try {
    const convertedBuffer = await sharp(imageBuffer)
      .toFormat(format, { quality })
      .toBuffer();

    return convertedBuffer;
  } catch (error) {
    console.error('Error converting image format:', error);
    throw error;
  }
}

/**
 * Validate image file
 * @param {Buffer} imageBuffer - Image buffer
 * @param {Array<string>} allowedFormats - Allowed formats
 * @returns {Promise<boolean>} Validation result
 */
export async function validateImage(imageBuffer, allowedFormats = ['jpeg', 'jpg', 'png', 'gif', 'webp']) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    return allowedFormats.includes(metadata.format?.toLowerCase() || '');
  } catch (error) {
    return false;
  }
}

/**
 * Extract dominant color from image
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<string>} Hex color code
 */

// export async function extractDominantColor(imageBuffer) {
//   try {
//     const { dominant } = await sharp(imageBuffer)
//       .resize(1, 1)
//       .raw()
//       .toBuffer({ resolveWithObject: true });
//     // Convert RGB to hex
//     const [r, g, b] = dominant;
//     const toHex = (c) => c.toString(16).padStart(2, '0');
//     return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
//   } catch (error) {
//     console.error('Error extracting dominant color:', error);
//     return '#000000';
//   }
// }

export async function extractDominantColor(imageBuffer) {
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(1, 1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    if (!data || data.length < 3) {
      return '#000000';
    }
    
    // Convert RGB to hex
    const r = data[0];
    const g = data[1];
    const b = data[2];
    const toHex = (c) => c.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } catch (error) {
    console.error('Error extracting dominant color:', error);
    return '#000000';
  }
}