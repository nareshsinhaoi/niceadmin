import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs'; // or 'node:fs'
import { fileURLToPath } from 'url';
//import fileUpload from 'express-fileupload';
import { Prisma } from './src/config/db.js';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import exifr from 'exifr';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
//import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
//import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { verifyAdmin, checkPermission, optionalAuth } from "./authMiddleware1.js"


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

// Helper function to upload file to S3
async function uploadToS3(fileBuffer, key, contentType) {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    // ACL: 'public-read' // Change to 'private' if you want private files
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  // Return public URL
  return `${CDN_URL}/${key}`;
}

// Helper function to generate S3 key (using same directory structure as before)
function generateS3Key(fileName, isThumbnail = false) {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
  const date = String(currentDate.getDate()).padStart(2, '0');

  if (isThumbnail) {
    return `uploads/testing/400/${year}/${month}/${date}/${fileName}`;
  }
  return `uploads/testing/${year}/${month}/${date}/${fileName}`;
}
// Helper function to make S3 object public via bucket policy
// Note: You need to set up bucket policy separately in AWS Console
function getPublicUrl(key) {
  // If using S3 directly
  return `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

  // If using CloudFront CDN
  // return `${CDN_URL}/${key}`;
}

const app = express();
app.use(cors({
	origin: ['http://localhost:5173', 'http://localhost:8080', 'http://localhost:8081', "http://192.168.0.186:8080", 'https://uat-photoassets.outlookindia.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));

// app.use(fileUpload({
//   createParentPath: true,
//   limits: { fileSize: 50 * 1024 * 1024 }, // 5MB limit 
//   abortOnLimit: true, // Return error if file exceeds limit
//   safeFileNames: true, // Strip special characters from filenames
//   preserveExtension: true, // Keep file extensions 
//   useTempFiles: false, // Don't use temp files (uses memory instead)
//   tempFileDir: '/tmp/', // Temp directory if useTempFiles is true
//   parseNested: false, // Set to false to avoid conflicts
//   debug: process.env.NODE_ENV === 'development',
// }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const userUploadsDir = path.join(uploadsDir, 'users');
if (!fs.existsSync(userUploadsDir)) {
  fs.mkdirSync(userUploadsDir, { recursive: true });
}
// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));
const dirs = ['images', 'photos', 'users', 'thumbnails'];
dirs.forEach(dir => {
  const dirPath = path.join(uploadsDir, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});


app.use(express.json());
//app.use(express.json({ limit: '50mb' }));
//app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const jsonParser = express.json({ limit: '50mb' });
const urlencodedParser = express.urlencoded({ extended: true, limit: '50mb' });


// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Access token required'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
  }
};

function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
}

const bufferToString = (val) => {
  if (Buffer.isBuffer(val)) {
    return val.toString('utf8');
  }
  return val;
};

const parseToNumber = (value) => {
  if (value === undefined || value === null) return undefined;
  return value === '1' || value === 1 || value === true ? 1 : 0;
};

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'photos');

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    // cb(null, uniqueName);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Create multer instance with proper configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 50, // max 50 files
    fields: 100, // max 100 non-file fields
    parts: 150 // max 150 parts (fields + files)
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    const allowedTypes = /jpeg|jpg|png|gif|webp|tiff/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Error: Only image files are allowed!'));
    }
  }
});


// Helper function to extract EXIF data
async function extractExifData(filePath) {
  try {
    const exif = await exifr.parse(filePath, {
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
// Get image dimensions and info
async function getImageInfo(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      orientation: metadata.orientation || 1,
      format: metadata.format || 'unknown',
      size: fs.statSync(filePath).size,
    };
  } catch (error) {
    console.error('Error getting image info:', error);
    return {
      width: 0,
      height: 0,
      orientation: 1,
      format: 'unknown',
      size: 0,
    };
  }
}
function getOrientation(width, height) {

  if (!width || !height) return 'unknown';
  if (width > height) return 'horizontal';
  if (height > width) return 'vertical';
  return 'square';
}
const getOrientationScientific = (width, height, tolerance = 0.05) => {
  const ratio = width / height;
  if (ratio > 1 + tolerance) return "horizontal";
  if (ratio < 1 - tolerance) return "vertical";
  return "square";
};


// Create thumbnail
async function createThumbnail(filePath, filename) {
  try {
    const thumbnailDir = path.join(process.cwd(), 'public', 'uploads', 'thumbnails');
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }
    const thumbnailPath = path.join(thumbnailDir, `thumb_${filename}`);
    await sharp(filePath)
      .resize(300, 300, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .toFile(thumbnailPath);
    return `/uploads/thumbnails/thumb_${filename}`;
  } catch (error) {
    console.error('Error creating thumbnail:', error);
    return null;
  }
}


app.get('/api', (req, res) => {
  res.json({ "status": "error", message: "Direct access not allowed" })
});

app.get('/api/allusers', async (req, res) => {
  try {
    const allUsers = await Prisma.pam_users.findMany({
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        password_reset_code: true,
        last_ip: true,
        created_at: true,
        updated_at: true,
        email: true,
        password: true,
        is_active: true,
        is_verify: true
      }
    });
    res.json(allUsers);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.get('/api/webusers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const username = req.query.username?.trim();

    // allowed sort fields (important for safety)
    const allowedSortFields = [
      'id',
      'username',
      'email',
      'created_at',
      'updated_at',
    ];

    const sortBy = allowedSortFields.includes(req.query.sortBy)
      ? req.query.sortBy
      : 'id';

    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const where = {};

    if (username) {
      where.username = {
        contains: username,
        mode: 'insensitive',
      };
    }

    const [users, totalRecords] = await Promise.all([
      Prisma.pam_users.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          email: true,
          mobile_no: true,
          address: true,
          photo: true,
          role: true,
          is_active: true,
          is_verify: true,
          last_ip: true,
          created_at: true,
          updated_at: true,
        },
      }),
      Prisma.pam_users.count({ where }),
    ]);

    res.json({
      status: 'success',
      page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      results: users,
    });

  } catch (err) {
    console.error('WEBUSERS ERROR:', err);
    res.status(500).json({
      status: 'error',
      message: 'Database error',
    });
  }
});

app.get('/api/user/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID"
      });
    }
    const user = await Prisma.pam_users.findUnique({
      where: { id: userId }
    });
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // (1) Validate input
    if (!email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Email and password are required"
      });
    }
    // (2) Find user by email
    const user = await Prisma.pam_users.findFirst({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }
    // (3) Check account status
    if (user.is_active === 0) {
      return res.status(403).json({
        status: "error",
        message: "Account is inactive"
      });
    }
    if (user.is_verify === 0) {
      return res.status(403).json({
        status: "error",
        message: "Account not verified"
      });
    }
    // (4) Compare password (PHP bcrypt compatible)
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    // (5) SUCCESS RESPONSE (NO password)
    return res.json({
      status: "success",
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.username,
        username: user.username,
        email: user.email,
        role: user.role,
        bio: 'Professional photographer and visual storyteller.',
        location: 'New Delhi, India',
        website: '',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop',
        joinedDate: 'January 2024',
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
});

app.patch('/api/users/update-status/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { is_active } = req.body;

    // Validate userId
    if (isNaN(userId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid user ID',
      });
    }

    // Validate is_active (only 0 or 1 allowed)
    if (![0, 1].includes(is_active)) {
      return res.status(400).json({
        status: 'error',
        message: 'is_active must be 0 or 1',
      });
    }

    // Update user status
    const user = await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        is_active,
        updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        is_active: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User status updated successfully',
      user,
    });

  } catch (err) {
    console.error(err);

    // Prisma "record not found"
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update user status',
    });
  }
});

// INSERT
app.post('/api/users', async (req, res) => {
  const { user_name, email } = req.body;
  const users = await Prisma.pam_tmp_user.create({
    data: {
      user_name,
      email
    }
  });
  return res.json(users);
});

app.put('/api/user/update/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // For FormData/multipart, you need to handle it differently
    // Check if it's FormData or JSON
    let bodyData = req.body;

    // If it's FormData, you might need to parse it differently
    // Make sure you have proper middleware for multipart/form-data
    // Example: using multer or express-fileupload

    // Debug log to see what's coming in
    console.log('Request body:', req.body);
    console.log('Request files:', req.files); // If using file upload middleware 
    //const role = parseInt(req.body.role) || 1;

    const {
      username,
      firstname,
      lastname,
      email,
      mobile_no,
      address,
      photo, // This might be a string (path) or file object
      role,
      is_active,
      is_verify,
      is_admin,
      password,
    } = bodyData;

    // (1) Validate ID
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid user ID is required',
      });
    }
    const data = {
      updated_at: new Date(),
    };
    const fields = ['username', 'firstname', 'lastname', 'email', 'mobile_no', 'address', 'photo', 'role', 'password'];
    fields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== '') {
        data[field] = field === 'role' ? Number(req.body[field]) : req.body[field];
      }
    });
    const booleanFields = ['is_active', 'is_verify', 'is_admin'];
    booleanFields.forEach(field => {
      if (req.body[field] !== undefined) {
        data[field] = parseToNumber(req.body[field]);
      }
    });

    // (2) Build update object safely - convert string values to proper types
    // const data = {
    //   username: username || undefined,
    //   firstname: firstname || undefined,
    //   lastname: lastname || undefined,
    //   email: email || undefined,
    //   mobile_no: mobile_no || undefined,
    //   address: address || undefined,
    //   photo: photo || undefined, // Handle file path if uploaded
    //   role: role ? Number(role) : 1, 
    //   is_active: is_active !== undefined ? (is_active === '1' || is_active === 1 || is_active === true) : undefined,
    //   is_verify: is_verify !== undefined ? (is_verify === '1' || is_verify === 1 || is_verify === true) : undefined,
    //   is_admin: is_admin !== undefined ? (is_admin === '1' || is_admin === 1 || is_admin === true) : undefined,
    //   updated_at: new Date(),
    // };

    // Remove undefined values
    Object.keys(data).forEach(
      (key) => data[key] === undefined && delete data[key]
    );

    // (3) Hash password if provided
    if (password && password.trim() !== '') {
      data.password = await bcrypt.hash(password, 10);
    }

    // (4) Handle file upload if photo is a file
    if (req.files && req.files.photo) {
      const photoFile = req.files.photo;
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(photoFile.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
        });
      }
      // Calculate path to frontend public directory
      // const frontendPublicDir = path.join(__dirname, '..', 'frontend', 'public', 'uploads', 'users');
      const uploadDir = path.join(__dirname, 'uploads', 'users');
      //const uploadDir = path.join(__dirname, '../uploads/users');

      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Generate unique filename
      const fileName = `user_${id}_${Date.now()}${path.extname(photoFile.name)}`;
      const filePath = path.join(uploadDir, fileName);

      // Move file to uploads directory
      await photoFile.mv(filePath);

      // Save relative path in database
      data.photo = `/uploads/users/${fileName}`;
    }

    // (5) Validate required fields for update
    if (Object.keys(data).length <= 1) { // Only updated_at is present
      return res.status(400).json({
        status: 'error',
        message: 'No valid data provided for update',
      });
    }

    // (6) Update user
    const user = await Prisma.pam_users.update({
      where: { id: Number(id) },
      data,
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        is_admin: true,
        updated_at: true,
      },
    });

    res.json({
      status: 'success',
      message: 'User updated successfully',
      user,
    });
  } catch (err) {
    console.error('Update user error:', err);

    // Handle specific Prisma errors
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Handle unique constraint violations
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      return res.status(400).json({
        status: 'error',
        message: `${field ? field.charAt(0).toUpperCase() + field.slice(1) : 'Field'} already exists`,
      });
    }

    // Handle invalid data
    if (err.code === 'P2003' || err.code === 'P2006' || err.code === 'P2007') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid data provided',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// PHOTOS (get photo listing using in admin panel)
app.get('/api/photos', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    /* 1️. Total records */
    const totalRecords = await Prisma.pam_photos.count({
      where: {
        is_active: 1,
        is_trash: 0
      }
    });

    /* 2️. Fetch paginated photos */
    const photos = await Prisma.pam_photos.findMany({
      where: {
        is_active: 1,
        is_trash: 0
      },
      orderBy: {
        photo_id: 'desc'
      },
      skip,
      take: limit
    });

    /* 3️. Attach files & counts (CI style) */
    const results = [];

    for (const photo of photos) {
      const photoId = Number(photo.photo_id); // BigInt → Number

      // files count
      const num_photos = await Prisma.pam_photos_files.count({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        }
      });

      // files list
      const files = await Prisma.pam_photos_files.findMany({
        where: {
          photo_id: photoId,
          is_trash: 'N'
        },
        select: {
          file_id: true,
          dir_path: true,
          Image_Name: true,
          isMigrat: true,
          migratedFilePath: true,
          migratedFileName: true
        },
        take: 1
      });

      results.push({
        'obj': '1',
        photo_id: photo.photo_id, // BigInt handled by serializer
        photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
        photo_title: photo.photo_title,
        photography_time: photo.photography_time,
        datetime: photo.photography_time
          ? new Date(photo.photography_time).toLocaleDateString('en-GB')
          : null,
        category_id: photo.category_id,
        author_id: photo.author_id,
        num_photo: num_photos,
        photos: files
      });
    }

    /* 4️. Final response */
    res.json(
      serializeBigInt({
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        results
      })
    );
  } catch (err) {
    console.error('Photos API@ Error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load photos'
    });
  }
});

// api/get_all_photos/MTY3MzA5
app.get('/api/get_all_photos/:photo_id', async (req, res) => {
  try {
    /* 1️. Decode photo_id */
    let decodedId;
    try {
      decodedId = Buffer
        .from(req.params.photo_id, 'base64')
        .toString('utf-8');
    } catch {
      return res.status(400).json({
        status: "error",
        message: "Invalid encoded photo ID"
      });
    }

    const photoId = Number(decodedId);
    if (!photoId || isNaN(photoId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid photo ID"
      });
    }

    /* 2️. Fetch photo details */
    const photo = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: BigInt(photoId)
      }
    });

    if (!photo) {
      return res.status(404).json({
        status: "error",
        message: "Photo not found"
      });
    }

    /* 3️. Fetch all files */
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        photo_id: photoId,
        is_trash: 'N'
      },
      orderBy: {
        file_id: 'asc'
      },
      select: {
        file_id: true,
        dir_path: true,
        Image_Name: true,
        raw_name: true,
        file_ext: true,
        Width: true,
        Height: true,
        file_size: true,
        isMigrat: true,
        migratedFilePath: true,
        migratedFileName: true
      }
    });

    /* 4️. Final response (BigInt-safe) */
    res.json(
      serializeBigInt({
        photo: {
          photo_id: photo.photo_id,
          photo_id_enc: req.params.photo_id,
          photo_title: photo.photo_title,
          description: photo.description,
          event_name: photo.event_name,
          photography_time: photo.photography_time,
          price: photo.price,
          author_id: photo.author_id,
          category_id: photo.category_id
        },
        total_files: files.length,
        files
      })
    );

  } catch (err) {
    console.error('Get Photo API Error:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to load photo details"
    });
  }
});

// GET /api/cat_photos/:page
// GET /api/cat_photos/:page?cat=9
// GET /api/cat_photos/:page?cat=3&subcat=12
// GET /api/filter_photos?page=1&orientation=Horizontal&location=&contentType=Photos&dateRange=anytime&search=

app.get('/api/filter_photos', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const search = req.query.search?.trim();
    const category = req.query.cat ? Number(req.query.cat) : null;
    const subCategory = req.query.subcat ? Number(req.query.subcat) : null;
    const orientation = req.query.orientation ? req.query.orientation : null;
    const dateRange = req.query.dateRange;
    let dateFilter = null;
    let orientationFilter = null;
    let photoIdsWithOrientation = [];


    switch (orientation) {
      case 'Horizontal': { }
      case 'Vertical': { }
      default: orientationFilter = null;
    }

    switch (dateRange) {
      case '24h': {
        const d = new Date();
        d.setHours(d.getHours() - 24);
        dateFilter = d;
        break;
      }
      case '7d': {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        dateFilter = d;
        break;
      }
      case '30d': {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        dateFilter = d;
        break;
      }
      default:
        dateFilter = null; // anytime
    }

    /* WHERE condition */
    const where = {
      is_active: 1,
      is_trash: 0
    };

    if (category) where.category_id = category;
    if (subCategory) where.sub_category_id = subCategory;
    if (dateFilter) {
      where.photography_time = {
        gte: dateFilter
      };
    }

    if (search) {
      where.OR = [
        // { photo_title: { contains: search, mode: 'insensitive' } }
        { photo_title: { contains: search } }
        // { photo_keywords: { contains: search } }, // if exists

      ];
    }

    /* (1) Total Records */
    const totalRecords = await Prisma.pam_photos.count({ where });

    /* (2) Photos */
    const photos = await Prisma.pam_photos.findMany({
      where,
      orderBy: { photo_id: 'desc' },
      skip,
      take: limit
    });

    /* (3) Attach files */
    const results = [];

    for (const photo of photos) {
      const photoId = Number(photo.photo_id);

      if (orientationFilter) {

      }

      const filesCount = await Prisma.pam_photos_files.count({
        where: { photo_id: photoId, is_trash: 'N' }
      });

      const files = await Prisma.pam_photos_files.findMany({
        where: { photo_id: photoId, is_trash: 'N' },
        select: {
          file_id: true,
          dir_path: true,
          Image_Name: true,
          isMigrat: true,
          migratedFilePath: true,
          migratedFileName: true,
          Width: true,
          Height: true,
          orientation: true
        },
        take: 1
      });

      results.push({
        photo_id: photo.photo_id,
        photo_id_enc: Buffer.from(photoId.toString()).toString('base64'),
        photo_title: photo.photo_title,
        photography_time: photo.photography_time,
        datetime: new Date(photo.photography_time).toLocaleDateString('en-GB'),
        category_id: photo.category_id,
        sub_category_id: photo.sub_category_id,
        author_id: photo.author_id,
        num_photo: filesCount,

        photos: files
      });
    }

    res.json(
      serializeBigInt({
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        results
      })
    );

  } catch (err) {
    console.error('Photos API Error:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to load photos"
    });
  }
});

// GET /api/my_photos?user_id=12&page=1
app.get('/api/my_photos_old', async (req, res) => {
  try {
    // Assume middleware sets req.user
    // const userId = req.user?.id;
    //const userId = parseInt(req.query.user_id);
    const userId = String(req.query.user_id || '53');

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized"
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    // (1) Count total records
    const totalRecords = await Prisma.pam_photos_files.count({
      where: {
        updated_by: userId,
        is_trash: 'N'
      }
    });

    // (2) Fetch files with joined photo data
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        updated_by: userId.toString(),
        is_trash: 'N'
      },
      orderBy: {
        file_id: 'desc'
      },
      skip,
      take: limit,
      include: {
        pam_photos: {
          select: {
            photo_title: true,
            description: true,
            credit: true,
            download: true
          }
        }
      }
    });

    // (3) BigInt-safe mapping
    const results = files.map(f => ({
      file_id: f.file_id.toString(),
      photo_id: f.photo_id.toString(),
      file_ext: f.file_ext,
      dir_path: f.dir_path,
      Image_Name: f.Image_Name,
      file_size: f.file_size,
      Width: f.Width,
      Height: f.Height,
      updated_by: f.updated_by,
      updated_on: f.updated_on,

      // Joined fields
      photo_title: f.pam_photos?.photo_title || '',
      description: f.pam_photos?.description || '',
      credit: f.pam_photos?.credit || 0,
      download: f.pam_photos?.download || 0
    }));

    // (4) Final response
    res.json({
      page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      results
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Failed to load uploaded photos"
    });
  }
});


app.get('/api/my_photos', async (req, res) => {
  try {
    const userId = String(req.query.user_id || '53');
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const rows = await Prisma.$queryRaw`
      SELECT 
        F.file_id,
        F.photo_id,
        F.dir_path,
        F.Image_Name,
        F.file_ext,
        F.file_size,
        P.photo_title,
        P.description,
        P.credit,
        P.download
      FROM pam_photos_files F
      JOIN pam_photos P ON F.photo_id = P.photo_id
      WHERE F.updated_by = ${userId}
        AND F.is_trash = 'N'
      ORDER BY F.file_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const results = rows.map(r => ({
      file: {
        file_id: r.file_id.toString(),
        photo_id: r.photo_id.toString(),
        dir_path: r.dir_path.toString('utf8'),
        image_name: bufferToString(r.Image_Name),
        file_ext: bufferToString(r.file_ext),
        file_size: bufferToString(r.file_size),
      },
      photo: {
        title: bufferToString(r.photo_title),
        description: bufferToString(r.description),
        credit: Number(r.credit),
        download: Number(r.download),
      }
    }));

    res.json({
      status: "success",
      page,
      limit,
      count: results.length,
      results
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Failed to load photos"
    });
  }
});

app.get('/api/myphotos', async (req, res) => {
  try {
    const userId = String(req.query.user_id || '53');
    const page = parseInt(req.query.page || '1');
    const limit = 21;
    const skip = (page - 1) * limit;

    const totalRecords = await Prisma.pam_photos_files.count({
      where: {
        updated_by: userId,
        is_trash: 'N',
      },
    });

    const files = await Prisma.pam_photos_files.findMany({
      where: {
        updated_by: userId,
        is_trash: 'N',
      },
      orderBy: {
        file_id: 'desc',
      },
      skip,
      take: limit,
      select: {
        file_id: true,
        photo_id: true,
        dir_path: true,
        Image_Name: true,
        raw_name: true,
        file_ext: true,
        Width: true,
        Height: true,
        file_size: true,
        isMigrat: true,
        migratedFilePath: true,
        migratedFileName: true,
        date_created: true,
        updated_on: true
      }
    });

    const results = files.map(f => ({
      file: {
        file_id: f.file_id.toString(),
        photo_id: f.photo_id?.toString(),
        dir_path: f.dir_path,
        image_name: f.Image_Name,
        file_ext: f.file_ext,
        file_size: f.file_size,
        file_width: f.Width,
        file_height: f.Height,
        created_at: f.date_created,
        updated_at: f.updated_on,
      }
    }));

    res.json({
      status: 'success',
      page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      count: results.length,
      results,
    });

  } catch (err) {
    console.error('MyPhotos API Error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load photos',
    });
  }
});

app.post('/api/user/create', async (req, res) => {
  try {
    const {
      username,
      firstname,
      lastname,
      email,
      mobile_no,
      password,
      address
    } = req.body;
    /* (1) Basic validation */
    if (!username || !firstname || !lastname || !email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Required fields are missing"
      });
    }
    /* (2) Check email exists */
    const existingUser = await Prisma.pam_users.findFirst({
      where: { email }
    });
    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "Email already registered"
      });
    }
    /* (3) Hash password */
    const hashedPassword = await bcrypt.hash(password, 10);

    /* (4) Generate token */
    const token = jwt.sign(
      { email },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '7d' }
    );
    /* (5) Create user */
    const user = await Prisma.pam_users.create({
      data: {
        username,
        firstname,
        lastname,
        email,
        mobile_no: mobile_no || '',
        password: hashedPassword,
        address: address || '',
        photo: '',
        role: 1,
        is_active: 0,
        is_verify: 0,
        is_admin: 0,
        token,
        password_reset_code: '',
        last_ip: req.ip,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    /* (6) Remove sensitive fields */
    const safeUser = {
      id: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      mobile_no: user.mobile_no,
      role: user.role,
      token: user.token
    };
    res.status(201).json({
      status: "success",
      message: "User created successfully",
      user: safeUser
    });
  } catch (err) {
    console.error('Create User Error:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to create user"
    });
  }
});

app.get('/api/menus', async (req, res) => {
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
});

// ADMIN

app.post('/api/admin/login', jsonParser, urlencodedParser, async (req, res) => {
  //console.log("Email: ", req.body )
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({
        status: 'error',
        message: 'Email and password are required'
      });
    }
    const admin = await Prisma.ci_admin.findFirst({
      where: {
        email: email,
        is_active: 1
      }
    });
    if (!admin) {
      return res.json({
        status: 'error',
        message: 'Invalid credentials'
      });
    }
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.json({
        status: 'error',
        message: 'Invalid credentials'
      });
    }
    const token = jwt.sign(
      {
        admin_id: admin.admin_id,
        role_id: admin.admin_role_id,
        is_admin: admin.is_admin,
        is_supper: admin.is_supper
      },
      process.env.JWT_SECRET || 'SECRET_KEY',
      { expiresIn: '1d' }
    );
    // update login info
    await Prisma.ci_admin.update({
      where: { admin_id: admin.admin_id },
      data: {
        last_login: new Date(),
        token
      }
    });
    res.json({
      status: 'success',
      message: 'Login successful',
      token,
      admin: {
        admin_id: admin.admin_id,
        username: admin.username,
        firstname: admin.firstname,
        lastname: admin.lastname,
        email: admin.email,
        is_admin: admin.is_admin,
        is_supper: admin.is_supper
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

app.get('/api/admin/adminlist', async (req, res) => {
  try {
    const {
      search = '',
      role,
      status,
      page = 1,
      limit = 10
    } = req.query;

    const pageNumber = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNumber - 1) * pageSize;

    const whereClause = {
      AND: [
        search
          ? {
            OR: [
              { firstname: { contains: search } },
              { lastname: { contains: search } },
              { email: { contains: search } }
            ]
          }
          : {},
        role ? { admin_role_id: parseInt(role) } : {},
        status !== undefined ? { is_active: parseInt(status) } : {}
      ]
    };

    const [admins, totalRecords] = await Promise.all([
      Prisma.ci_admin.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        orderBy: { admin_id: 'desc' },
        select: {
          admin_id: true,
          firstname: true,
          lastname: true,
          email: true,
          admin_role_id: true,
          is_active: true,
          is_supper: true,
          created_at: true
        }
      }),
      Prisma.ci_admin.count({ where: whereClause })
    ]);

    res.json({
      status: 'success',
      data: admins,
      pagination: {
        totalRecords,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalRecords / pageSize)
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

app.delete("/api/admin/delete/:id", async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);

    if (!adminId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid admin ID",
      });
    }

    const admin = await Prisma.ci_admin.findUnique({
      where: { admin_id: adminId },
    });

    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
      });
    }

    // Prevent deleting super admin
    if (admin.is_supper === 1) {
      return res.status(403).json({
        status: "error",
        message: "Super admin cannot be deleted",
      });
    }

    // Soft delete
    await Prisma.ci_admin.update({
      where: { admin_id: adminId },
      data: {
        is_active: 0,
        updated_at: new Date(),
      },
    });

    return res.json({
      status: "success",
      message: "Admin disabled successfully",
    });

  } catch (error) {
    console.error("DELETE ADMIN ERROR:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

app.post("/api/admin/create", async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      email,
      mobile_no,
      password,
      admin_role_id,
      is_active,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    const exists = await Prisma.ci_admin.findFirst({
      where: { email },
    });

    if (exists) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await Prisma.ci_admin.create({
      data: {
        firstname,
        lastname,
        email,
        mobile_no,
        password: hashed,
        admin_role_id,
        is_active,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    res.json({ status: "success" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/admin/update/:id", async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    const {
      firstname,
      lastname,
      email,
      mobile_no,
      admin_role_id,
      is_active,
    } = req.body;

    await Prisma.ci_admin.update({
      where: { admin_id: adminId },
      data: {
        firstname,
        lastname,
        email,
        mobile_no,
        admin_role_id,
        is_active,
        updated_at: new Date(),
      },
    });

    res.json({ status: "success" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/admin/detail/:id", async (req, res) => {
  const admin = await Prisma.ci_admin.findUnique({
    where: { admin_id: parseInt(req.params.id) },
    select: {
      firstname: true,
      lastname: true,
      email: true,
      mobile_no: true,
      admin_role_id: true,
      is_active: true,
    },
  });

  res.json(admin);
});

// CATEGORY

// Get all categories
app.get('/api/categories', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
      status
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ✅ where must be an object
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

    // ✅ dynamic orderBy
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
});


// Get single category
app.get('/api/category/:id', async (req, res) => {
  try {
    const categoryId = Number(req.params.id);

    // ✅ Validate ID
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
});

// Create category
app.post('/api/category/add', async (req, res) => {
  try {
    const { sortname, name, slug, status = 1 } = req.body;

    // Validate required fields
    if (!sortname || !name || !slug) {
      return res.status(400).json({
        status: 'error',
        message: 'Sortname, name, and slug are required',
      });
    }

    // Check if slug already exists
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

    res.json({
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
});

// Update category
app.put('/api/category/:id', async (req, res) => {
  try {
    const categoryId = Number(req.params.id);
    const { sortname, name, slug, status } = req.body;

    // ✅ Validate ID
    if (isNaN(categoryId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }

    // ✅ Check if category exists
    const existingCategory = await Prisma.pam_category.findUnique({
      where: { category_id: categoryId },
    });

    if (!existingCategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Category not found',
      });
    }

    // ✅ Check slug uniqueness
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

    // ✅ Build update data safely
    const updateData = {};

    if (sortname !== undefined) updateData.sortname = sortname;
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (status !== undefined) updateData.status = Number(status);

    // ❌ Prevent empty update
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
});


// Delete category
app.delete('/api/category/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category has subcategories
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
});

// Toggle category status
app.patch('/api/categories/:id/toggle-status', async (req, res) => {
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
});


// 1 GET	/api/subcategories	Get all subcategories with pagination & filters
// 2 GET	/api/subcategories/:id	Get single subcategory by ID
// 3 POST	/api/subcategories	Create new subcategory
// 4 PUT	/api/subcategories/:id	Update subcategory
// 5 DELETE	/api/subcategories/:id	Delete subcategory
// 6 PATCH	/api/subcategories/:id/toggle-status	Toggle subcategory status
// 7 GET	/api/categories/:category_id/subcategories	Get subcategories by category ID
// 8 PATCH	/api/subcategories/bulk/update-status	Bulk update subcategories status subcategories

app.get('/api/subcategories', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
      status = '',
      category_id = ''
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (status !== '') {
      where.status = parseInt(status);
    }
    if (category_id !== '') {
      where.category_id = parseInt(category_id);
    }
    const total = await Prisma.pam_sub_category.count({ where });
    const subcategories = await Prisma.pam_sub_category.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { [sortBy]: sortOrder },
      include: {
        category: {
          select: {
            name: true,
            sortname: true,
            status: true
          }
        }
      }
    });
    res.json({
      status: 'success',
      data: subcategories,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (err) {
    console.error('Get subcategories error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subcategories.',
    });
  }
});

// 2 GET SINGLE SUBCATEGORY BY ID
app.get('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const subcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            sortname: true
          }
        }
      }
    });
    if (!subcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    res.json({
      status: 'success',
      data: subcategory,
    });
  } catch (err) {
    console.error('Get subcategory error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subcategory',
    });
  }
});

// 3 CREATE NEW SUBCATEGORY
app.post('/api/subcategories', async (req, res) => {
  try {
    const { category_id, name, slug, status = 1 } = req.body;
    // Validate required fields
    if (!category_id || !name || !slug) {
      return res.status(400).json({
        status: 'error',
        message: 'Category ID, name, and slug are required',
      });
    }
    // Check if category exists and is active
    const category = await Prisma.pam_category.findUnique({
      where: { category_id: parseInt(category_id) },
    });
    if (!category) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category',
      });
    }
    if (category.status !== 1) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot add subcategory to inactive category',
      });
    }
    // Check if slug already exists
    const existingSubcategory = await Prisma.pam_sub_category.findUnique({
      where: { slug },
    });
    if (existingSubcategory) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug already exists. Please use a different slug.',
      });
    }
    // Create subcategory
    const subcategory = await Prisma.pam_sub_category.create({
      data: {
        category_id: parseInt(category_id),
        name,
        slug,
        status: parseInt(status),
        created_at: new Date(),
      },
      include: {
        category: {
          select: {
            name: true,
            sortname: true
          }
        }
      }
    });
    res.status(201).json({
      status: 'success',
      message: 'Subcategory created successfully',
      data: subcategory,
    });
  } catch (err) {
    console.error('Create subcategory error:', err);
    // Handle Prisma errors
    if (err.code === 'P2002') {
      return res.status(400).json({
        status: 'error',
        message: 'Subcategory with this slug already exists',
      });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to create subcategory@',
    });
  }
});

// 4. UPDATE SUBCATEGORY
app.put('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, name, slug, status } = req.body;
    // Check if subcategory exists
    const existingSubcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
    });
    if (!existingSubcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    // Check if category exists (if changing category)
    if (category_id && parseInt(category_id) !== existingSubcategory.category_id) {
      const category = await Prisma.pam_category.findUnique({
        where: { category_id: parseInt(category_id) },
      });
      if (!category) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid category ID',
        });
      }
      if (category.status !== 1) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot move subcategory to inactive category',
        });
      }
    }
    // Check if slug already exists (excluding current subcategory)
    if (slug && slug !== existingSubcategory.slug) {
      const slugExists = await Prisma.pam_sub_category.findFirst({
        where: {
          slug,
          sub_category_id: { not: parseInt(id) }
        },
      });

      if (slugExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Slug already exists. Please use a different slug.',
        });
      }
    }
    // Prepare update data
    const updateData = {
      updated_at: new Date(),
    };
    if (category_id !== undefined) updateData.category_id = parseInt(category_id);
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (status !== undefined) updateData.status = parseInt(status);
    // Update subcategory
    const updatedSubcategory = await Prisma.pam_sub_category.update({
      where: { sub_category_id: parseInt(id) },
      data: updateData,
      include: {
        category: {
          select: {
            name: true,
            sortname: true
          }
        }
      }
    });
    res.json({
      status: 'success',
      message: 'Subcategory updated successfully',
      data: updatedSubcategory,
    });
  } catch (err) {
    console.error('Update subcategory error:', err);
    // Handle Prisma errors
    if (err.code === 'P2002') {
      return res.status(400).json({
        status: 'error',
        message: 'Subcategory with this slug already exists',
      });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid category ID',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to update subcategory',
    });
  }
});

//5. DELETE SUBCATEGORY
app.delete('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Check if subcategory exists
    const subcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
    });
    if (!subcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    // Delete subcategory
    await Prisma.pam_sub_category.delete({
      where: { sub_category_id: parseInt(id) },
    });
    res.json({
      status: 'success',
      message: 'Subcategory deleted successfully',
    });
  } catch (err) {
    console.error('Delete subcategory error:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete subcategory',
    });
  }
});

// 6. TOGGLE SUBCATEGORY STATUS (ACTIVE/INACTIVE)
app.patch('/api/subcategories/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;
    // Check if subcategory exists
    const subcategory = await Prisma.pam_sub_category.findUnique({
      where: { sub_category_id: parseInt(id) },
    });
    if (!subcategory) {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    // Check if parent category is active
    if (subcategory.status === 0) {
      const category = await Prisma.pam_category.findUnique({
        where: { category_id: subcategory.category_id },
      });
      if (category && category.status !== 1) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot activate subcategory when parent category is inactive',
        });
      }
    }
    // Toggle status
    const newStatus = subcategory.status === 1 ? 0 : 1;
    const updatedSubcategory = await Prisma.pam_sub_category.update({
      where: { sub_category_id: parseInt(id) },
      data: {
        status: newStatus,
        updated_at: new Date(),
      },
      include: {
        category: {
          select: {
            name: true,
            sortname: true
          }
        }
      }
    });
    res.json({
      status: 'success',
      message: `Subcategory ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`,
      data: updatedSubcategory,
    });
  } catch (err) {
    console.error('Toggle subcategory status error:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Subcategory not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to toggle subcategory status',
    });
  }
});

// 7. GET SUBCATEGORIES BY CATEGORY ID
app.get('/api/categories/:category_id/subcategories', async (req, res) => {
  try {
    const { category_id } = req.params;
    const { status = '1' } = req.query;
    // Check if category exists
    const category = await Prisma.pam_category.findUnique({
      where: { category_id: parseInt(category_id) },
    });
    if (!category) {
      return res.status(404).json({
        status: 'error',
        message: 'Category not found',
      });
    }
    // Build where clause
    const where = {
      category_id: parseInt(category_id),
    };
    if (status !== '') {
      where.status = parseInt(status);
    }
    // Get subcategories
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
});

// 8. BULK UPDATE SUBCATEGORIES STATUS
app.patch('/api/subcategories/bulk/update-status', async (req, res) => {
  try {
    const { subcategory_ids, status } = req.body;
    // Validate input
    if (!Array.isArray(subcategory_ids) || subcategory_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide subcategory IDs',
      });
    }
    if (status === undefined || (status !== 0 && status !== 1)) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide valid status (0 or 1)',
      });
    }
    // Check if status is being set to active
    if (status === 1) {
      // Get all subcategories to check their parent categories
      const subcategories = await Prisma.pam_sub_category.findMany({
        where: {
          sub_category_id: { in: subcategory_ids.map(id => parseInt(id)) }
        },
        include: {
          category: true
        }
      });
      // Check if any parent category is inactive
      const inactiveParent = subcategories.find(
        subcat => subcat.category.status !== 1
      );
      if (inactiveParent) {
        return res.status(400).json({
          status: 'error',
          message: `Cannot activate subcategory "${inactiveParent.name}" because parent category "${inactiveParent.category.name}" is inactive`,
        });
      }
    }
    // Bulk update
    const updated = await Prisma.pam_sub_category.updateMany({
      where: {
        sub_category_id: { in: subcategory_ids.map(id => parseInt(id)) }
      },
      data: {
        status: parseInt(status),
        updated_at: new Date(),
      },
    });
    res.json({
      status: 'success',
      message: `${updated.count} subcategor${updated.count === 1 ? 'y' : 'ies'} ${status === 1 ? 'activated' : 'deactivated'} successfully`,
      count: updated.count,
    });
  } catch (err) {
    console.error('Bulk update subcategories status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update subcategories status',
    });
  }
});

// 9. CHECK SLUG AVAILABILITY
app.get('/api/subcategories/check-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { exclude_id } = req.query;
    const where = { slug };
    if (exclude_id) {
      where.sub_category_id = { not: parseInt(exclude_id) };
    }
    const existing = await Prisma.pam_sub_category.findFirst({
      where,
    });
    res.json({
      status: 'success',
      available: !existing,
      message: existing ? 'Slug already exists' : 'Slug is available'
    });
  } catch (err) {
    console.error('Check slug error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check slug availability',
    });
  }
});

// 10. GET ACTIVE SUBCATEGORIES COUNT BY CATEGORY
app.get('/api/categories/:category_id/subcategories/count', async (req, res) => {
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
});

// --------------------------------------------------------------- COUNTRY --------------------------------------------------------------- 

// 1. GET ALL COUNTRIES WITH PAGINATION & FILTERS
app.get('/api/countries', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'name',
      sortOrder = 'asc',
      status = ''
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    // Build where clause
    const where = {};
    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sortname: { contains: search } },
        { slug: { contains: search } }
      ];
    }
    // Status filter
    if (status !== '') {
      where.status = parseInt(status);
    }
    // Get total count
    const total = await Prisma.pam_countries.count({ where });
    const orderByClause = {};
    orderByClause[sortBy] = sortOrder;
    // Get countries
    const countries = await Prisma.pam_countries.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { [sortBy]: sortOrder },
    });
    res.json({
      status: 'success',
      data: countries,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (err) {
    console.error('Get countries error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch@ countries',
    });
  }
});

// 2. GET SINGLE COUNTRY BY ID
app.get('/api/country/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const country = await Prisma.pam_countries.findUnique({
      where: { id: parseInt(id) },
    });
    if (!country) {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    res.json({
      status: 'success',
      data: country,
    });

  } catch (err) {
    console.error('Get country error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch 11 country',
    });
  }
});

// ✅ 3. CREATE NEW COUNTRY
app.post('/api/countries', async (req, res) => {
  try {
    const { sortname, name, slug, phonecode, status = 1 } = req.body;

    // Validate required fields
    if (!sortname || !name || !slug || !phonecode) {
      return res.status(400).json({
        status: 'error',
        message: 'Sortname, name, slug, and phonecode are required',
      });
    }

    // Validate sortname length
    if (sortname.length > 3) {
      return res.status(400).json({
        status: 'error',
        message: 'Sortname must be 3 characters or less',
      });
    }

    // Validate phonecode is a number
    if (isNaN(parseInt(phonecode))) {
      return res.status(400).json({
        status: 'error',
        message: 'Phonecode must be a valid number',
      });
    }

    // Check if slug already exists
    const existingCountry = await Prisma.pam_countries.findFirst({
      where: { slug },
    });

    if (existingCountry) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug already exists. Please use a different slug.',
      });
    }

    // Check if sortname already exists
    const existingSortname = await Prisma.pam_countries.findFirst({
      where: { sortname },
    });

    if (existingSortname) {
      return res.status(400).json({
        status: 'error',
        message: 'Sortname already exists. Please use a different sortname.',
      });
    }

    // Create country
    const country = await Prisma.pam_countries.create({
      data: {
        sortname: sortname.toUpperCase(),
        name: name.trim(),
        slug: slug.trim(),
        phonecode: parseInt(phonecode),
        status: parseInt(status),
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Country created successfully',
      data: country,
    });

  } catch (err) {
    console.error('Create country error:', err);

    // Handle Prisma errors
    if (err.code === 'P2002') {
      return res.status(400).json({
        status: 'error',
        message: 'A country with this slug or sortname already exists',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to create country',
    });
  }
});

// ✅ 4. UPDATE COUNTRY
app.put('/api/countries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sortname, name, slug, phonecode, status } = req.body;

    // Check if country exists
    const existingCountry = await Prisma.pam_countries.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingCountry) {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    // Validate sortname length if provided
    if (sortname && sortname.length > 3) {
      return res.status(400).json({
        status: 'error',
        message: 'Sortname must be 3 characters or less',
      });
    }

    // Validate phonecode is a number if provided
    if (phonecode && isNaN(parseInt(phonecode))) {
      return res.status(400).json({
        status: 'error',
        message: 'Phonecode must be a valid number',
      });
    }

    // Check if slug already exists (excluding current country)
    if (slug && slug !== existingCountry.slug) {
      const slugExists = await Prisma.pam_countries.findFirst({
        where: {
          slug,
          id: { not: parseInt(id) }
        },
      });

      if (slugExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Slug already exists. Please use a different slug.',
        });
      }
    }

    // Check if sortname already exists (excluding current country)
    if (sortname && sortname !== existingCountry.sortname) {
      const sortnameExists = await Prisma.pam_countries.findFirst({
        where: {
          sortname: sortname.toUpperCase(),
          id: { not: parseInt(id) }
        },
      });

      if (sortnameExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Sortname already exists. Please use a different sortname.',
        });
      }
    }

    // Prepare update data
    const updateData = {};

    if (sortname !== undefined) updateData.sortname = sortname.toUpperCase();
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) updateData.slug = slug.trim();
    if (phonecode !== undefined) updateData.phonecode = parseInt(phonecode);
    if (status !== undefined) updateData.status = parseInt(status);

    // Update country
    const updatedCountry = await Prisma.pam_countries.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    res.json({
      status: 'success',
      message: 'Country updated successfully',
      data: updatedCountry,
    });

  } catch (err) {
    console.error('Update country error:', err);

    // Handle Prisma errors
    if (err.code === 'P2002') {
      return res.status(400).json({
        status: 'error',
        message: 'A country with this slug or sortname already exists',
      });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to update country',
    });
  }
});

// ✅ 5. DELETE COUNTRY
app.delete('/api/countries/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if country exists
    const country = await Prisma.pam_countries.findUnique({
      where: { id: parseInt(id) },
    });

    if (!country) {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    // Delete country
    await Prisma.pam_countries.delete({
      where: { id: parseInt(id) },
    });

    res.json({
      status: 'success',
      message: 'Country deleted successfully',
    });

  } catch (err) {
    console.error('Delete country error:', err);

    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to delete country',
    });
  }
});

// ✅ 6. TOGGLE COUNTRY STATUS (ACTIVE/INACTIVE)
app.patch('/api/countries/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if country exists
    const country = await Prisma.pam_countries.findUnique({
      where: { id: parseInt(id) },
    });

    if (!country) {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    // Toggle status
    const newStatus = country.status === 1 ? 0 : 1;

    const updatedCountry = await Prisma.pam_countries.update({
      where: { id: parseInt(id) },
      data: {
        status: newStatus,
      },
    });

    res.json({
      status: 'success',
      message: `Country ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`,
      data: updatedCountry,
    });

  } catch (err) {
    console.error('Toggle country status error:', err);

    if (err.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Failed to toggle country status',
    });
  }
});

// ✅ 7. BULK UPDATE COUNTRIES STATUS
app.patch('/api/countries/bulk/update-status', async (req, res) => {
  try {
    const { country_ids, status } = req.body;

    // Validate input
    if (!Array.isArray(country_ids) || country_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide country IDs',
      });
    }

    if (status === undefined || (status !== 0 && status !== 1)) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide valid status (0 or 1)',
      });
    }

    // Bulk update
    const updated = await Prisma.pam_countries.updateMany({
      where: {
        id: { in: country_ids.map(id => parseInt(id)) }
      },
      data: {
        status: parseInt(status),
      },
    });

    res.json({
      status: 'success',
      message: `${updated.count} countr${updated.count === 1 ? 'y' : 'ies'} ${status === 1 ? 'activated' : 'deactivated'} successfully`,
      count: updated.count,
    });

  } catch (err) {
    console.error('Bulk update countries status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update countries status',
    });
  }
});

// ✅ 8. CHECK SLUG AVAILABILITY
app.get('/api/countries/check-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { exclude_id } = req.query;

    const where = { slug };

    if (exclude_id) {
      where.id = { not: parseInt(exclude_id) };
    }

    const existing = await Prisma.pam_countries.findFirst({
      where,
    });

    res.json({
      status: 'success',
      available: !existing,
      message: existing ? 'Slug already exists' : 'Slug is available'
    });

  } catch (err) {
    console.error('Check slug error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check slug availability',
    });
  }
});

// ✅ 9. CHECK SORTNAME AVAILABILITY
app.get('/api/countries/check-sortname/:sortname', async (req, res) => {
  try {
    const { sortname } = req.params;
    const { exclude_id } = req.query;

    const where = { sortname: sortname.toUpperCase() };

    if (exclude_id) {
      where.id = { not: parseInt(exclude_id) };
    }

    const existing = await Prisma.pam_countries.findFirst({
      where,
    });

    res.json({
      status: 'success',
      available: !existing,
      message: existing ? 'Sortname already exists' : 'Sortname is available'
    });

  } catch (err) {
    console.error('Check sortname error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check sortname availability',
    });
  }
});

// ✅ 10. GET ACTIVE COUNTRIES LIST (FOR DROPDOWNS)
app.get('/api/countries/active', async (req, res) => {
  try {
    const countries = await Prisma.pam_countries.findMany({
      where: { status: 1 },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        sortname: true,
        name: true,
        phonecode: true
      }
    });
    res.json({
      status: 'success',
      data: countries,
    });
  } catch (err) {
    console.error('Get active countries error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch active countries',
    });
  }
});
// ------------------------- END COUNTRY -------------------------


// -------------------------  STATE START ------------------------- 
// STATE CRUD APIs
app.get('/api/states', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'name',
      sortOrder = 'asc',
      status = '',
      country_id = ''
    } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {};

    // Search filter
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { name: { contains: searchTerm } },
        { slug: { contains: searchTerm } }
      ];
    }
    // Status filter
    if (status !== '' && !isNaN(parseInt(status))) {
      where.status = parseInt(status);
    }
    // Country filter
    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.country_id = parseInt(country_id);
    }
    // Validate sort columns
    const validSortColumns = ['id', 'name', 'slug', 'country_id', 'status'];
    const actualSortBy = validSortColumns.includes(sortBy) ? sortBy : 'name';
    // Create orderBy object
    const orderBy = {};
    orderBy[actualSortBy] = sortOrder.toLowerCase() === 'desc' ? 'desc' : 'asc';
    // Get total count
    const total = await Prisma.pam_states.count({ where });
    // Get states with country information
    const states = await Prisma.pam_states.findMany({
      where,
      include: {
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        }
      },
      skip,
      take: limitNum,
      orderBy
    });
    res.json({
      status: 'success',
      data: states,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });

  } catch (err) {
    console.error('Get states error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch states',
      error: err.message
    });
  }
});

// Get single state by ID
app.get('/api/states/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const stateId = parseInt(id);

    if (isNaN(stateId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid state ID'
      });
    }

    const state = await Prisma.pam_states.findUnique({
      where: { id: stateId },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        }
      }
    });

    if (!state) {
      return res.status(404).json({
        status: 'error',
        message: 'State not found'
      });
    }

    res.json({
      status: 'success',
      data: state
    });

  } catch (err) {
    console.error('Get state by ID error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch state',
      error: err.message
    });
  }
});

// Create new state
app.post('/api/states', async (req, res) => {
  try {
    const { name, slug, country_id, status = 1 } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'State name is required'
      });
    }

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    if (!country_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Country is required'
      });
    }

    // Check if country exists
    const countryExists = await Prisma.pam_countries.findUnique({
      where: { id: parseInt(country_id) }
    });

    if (!countryExists) {
      return res.status(400).json({
        status: 'error',
        message: 'Country does not exist'
      });
    }

    // Check for duplicate state name in same country
    const existingState = await Prisma.pam_states.findFirst({
      where: {
        name: name.trim(),
        country_id: parseInt(country_id)
      }
    });

    if (existingState) {
      return res.status(400).json({
        status: 'error',
        message: 'State with this name already exists in this country'
      });
    }

    // Check for duplicate slug
    const existingSlug = await Prisma.pam_states.findFirst({
      where: { slug: slug.trim().toLowerCase() }
    });

    if (existingSlug) {
      return res.status(400).json({
        status: 'error',
        message: 'State with this slug already exists'
      });
    }

    // Create state
    const state = await Prisma.pam_states.create({
      data: {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        country_id: parseInt(country_id),
        status: parseInt(status)
      },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        }
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'State created successfully',
      data: state
    });

  } catch (err) {
    console.error('Create state error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create state',
      error: err.message
    });
  }
});

// Update state
app.put('/api/states/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, country_id, status } = req.body;
    const stateId = parseInt(id);

    if (isNaN(stateId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid state ID'
      });
    }

    // Check if state exists
    const existingState = await Prisma.pam_states.findUnique({
      where: { id: stateId }
    });

    if (!existingState) {
      return res.status(404).json({
        status: 'error',
        message: 'State not found'
      });
    }

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'State name is required'
      });
    }

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    if (!country_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Country is required'
      });
    }

    // Check if country exists
    const countryExists = await Prisma.pam_countries.findUnique({
      where: { id: parseInt(country_id) }
    });

    if (!countryExists) {
      return res.status(400).json({
        status: 'error',
        message: 'Country does not exist'
      });
    }

    // Check for duplicate state name in same country (excluding current state)
    const duplicateName = await Prisma.pam_states.findFirst({
      where: {
        name: name.trim(),
        country_id: parseInt(country_id),
        id: { not: stateId }
      }
    });

    if (duplicateName) {
      return res.status(400).json({
        status: 'error',
        message: 'Another state with this name already exists in this country'
      });
    }

    // Check for duplicate slug (excluding current state)
    const duplicateSlug = await Prisma.pam_states.findFirst({
      where: {
        slug: slug.trim().toLowerCase(),
        id: { not: stateId }
      }
    });

    if (duplicateSlug) {
      return res.status(400).json({
        status: 'error',
        message: 'Another state with this slug already exists'
      });
    }

    // Update state
    const updatedState = await Prisma.pam_states.update({
      where: { id: stateId },
      data: {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        country_id: parseInt(country_id),
        status: status !== undefined ? parseInt(status) : existingState.status
      },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        }
      }
    });

    res.json({
      status: 'success',
      message: 'State updated successfully',
      data: updatedState
    });

  } catch (err) {
    console.error('Update state error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update state',
      error: err.message
    });
  }
});

// Delete state
app.delete('/api/states/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const stateId = parseInt(id);

    if (isNaN(stateId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid state ID'
      });
    }

    // Check if state exists
    const state = await Prisma.pam_states.findUnique({
      where: { id: stateId },
      include: {
        cities: {
          take: 1
        }
      }
    });

    if (!state) {
      return res.status(404).json({
        status: 'error',
        message: 'State not found'
      });
    }

    // Check if state has cities
    if (state.cities && state.cities.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete state. It has associated cities.'
      });
    }

    // Delete state
    await Prisma.pam_states.delete({
      where: { id: stateId }
    });

    res.json({
      status: 'success',
      message: 'State deleted successfully'
    });

  } catch (err) {
    console.error('Delete state error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete state',
      error: err.message
    });
  }
});

// Toggle state status (Active/Inactive)
app.patch('/api/states/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;
    const stateId = parseInt(id);

    if (isNaN(stateId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid state ID'
      });
    }

    const state = await Prisma.pam_states.findUnique({
      where: { id: stateId }
    });

    if (!state) {
      return res.status(404).json({
        status: 'error',
        message: 'State not found'
      });
    }

    const updatedState = await Prisma.pam_states.update({
      where: { id: stateId },
      data: {
        status: state.status === 1 ? 0 : 1
      },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        }
      }
    });

    res.json({
      status: 'success',
      message: `State ${updatedState.status === 1 ? 'activated' : 'deactivated'} successfully`,
      data: updatedState
    });

  } catch (err) {
    console.error('Toggle state status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to toggle state status',
      error: err.message
    });
  }
});

// Bulk update state status
app.patch('/api/states/bulk/update-status', async (req, res) => {
  try {
    const { state_ids, status } = req.body;

    if (!state_ids || !Array.isArray(state_ids) || state_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'state_ids array is required'
      });
    }

    if (status === undefined || ![0, 1].includes(parseInt(status))) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid status (0 or 1) is required'
      });
    }

    // Convert all IDs to numbers
    const stateIdsNum = state_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    // Update all selected states
    await Prisma.pam_states.updateMany({
      where: {
        id: {
          in: stateIdsNum
        }
      },
      data: {
        status: parseInt(status)
      }
    });

    res.json({
      status: 'success',
      message: `${stateIdsNum.length} state${stateIdsNum.length === 1 ? '' : 's'} ${status === '1' ? 'activated' : 'deactivated'} successfully`
    });

  } catch (err) {
    console.error('Bulk update state status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update state status in bulk',
      error: err.message
    });
  }
});

// Get states by country ID (for dropdowns)
app.get('/api/states/country/:countryId', async (req, res) => {
  try {
    const { countryId } = req.params;
    const { status = '1' } = req.query;

    const countryIdNum = parseInt(countryId);
    if (isNaN(countryIdNum)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid country ID'
      });
    }

    // Check if country exists
    const countryExists = await Prisma.pam_countries.findUnique({
      where: { id: countryIdNum }
    });

    if (!countryExists) {
      return res.status(404).json({
        status: 'error',
        message: 'Country not found'
      });
    }

    const where = {
      country_id: countryIdNum
    };

    if (status !== '' && !isNaN(parseInt(status))) {
      where.status = parseInt(status);
    }

    const states = await Prisma.pam_states.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        country_id: true
      }
    });

    res.json({
      status: 'success',
      data: states
    });

  } catch (err) {
    console.error('Get states by country error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch states by country',
      error: err.message
    });
  }
});

// Get active states only (for public use)
app.get('/api/states/active/list', async (req, res) => {
  try {
    const { country_id = '' } = req.query;

    const where = {
      status: 1
    };

    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.country_id = parseInt(country_id);
    }

    const states = await Prisma.pam_states.findMany({
      where,
      include: {
        country: {
          select: {
            id: true,
            name: true,
            sortname: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      status: 'success',
      data: states
    });

  } catch (err) {
    console.error('Get active states error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch active states',
      error: err.message
    });
  }
});

// Validate state slug (check if unique)
app.get('/api/states/validate/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { exclude_id = '' } = req.query;

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    const where = {
      slug: slug.trim().toLowerCase()
    };

    if (exclude_id !== '' && !isNaN(parseInt(exclude_id))) {
      where.id = { not: parseInt(exclude_id) };
    }

    const existingState = await Prisma.pam_states.findFirst({
      where
    });

    res.json({
      status: 'success',
      data: {
        is_unique: !existingState,
        message: existingState ? 'Slug already exists' : 'Slug is available'
      }
    });

  } catch (err) {
    console.error('Validate slug error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to validate slug',
      error: err.message
    });
  }
});

// Count total states
app.get('/api/states/count/total', async (req, res) => {
  try {
    const { status = '' } = req.query;
    const where = {};
    if (status !== '' && !isNaN(parseInt(status))) {
      where.status = parseInt(status);
    }
    const total = await Prisma.pam_states.count({ where });
    const active = await Prisma.pam_states.count({ where: { status: 1 } });
    const inactive = await Prisma.pam_states.count({ where: { status: 0 } });
    res.json({
      status: 'success',
      data: {
        total,
        active,
        inactive
      }
    });
  } catch (err) {
    console.error('Count states error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to count states',
      error: err.message
    });
  }
});

// Search states by name (autocomplete)
app.get('/api/states/search/autocomplete', async (req, res) => {
  try {
    const { q = '', limit = 10, country_id = '' } = req.query;

    if (!q || q.trim() === '') {
      return res.json({
        status: 'success',
        data: []
      });
    }

    const where = {
      OR: [
        { name: { contains: q.trim() } },
        { slug: { contains: q.trim() } }
      ],
      status: 1
    };

    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.country_id = parseInt(country_id);
    }

    const states = await Prisma.pam_states.findMany({
      where,
      take: parseInt(limit) || 10,
      select: {
        id: true,
        name: true,
        slug: true,
        country_id: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      status: 'success',
      data: states
    });

  } catch (err) {
    console.error('Search states autocomplete error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to search states',
      error: err.message
    });
  }
});
// -------------------------  STATE ------------------------- 


// -------------------------  CITY START ------------------------- 

// 1. GET /api/cities - Get all cities with pagination and filters
app.get('/api/cities', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'name',
      sortOrder = 'asc',
      status = '',
      state_id = '',
      country_id = ''
    } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {};

    // Search filter
    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      where.OR = [
        { name: { contains: searchTerm } },
        { slug: { contains: searchTerm } }
      ];
    }
    // Status filter
    if (status !== '' && !isNaN(parseInt(status))) {
      where.status = parseInt(status);
    }
    // State filter
    if (state_id !== '' && !isNaN(parseInt(state_id))) {
      where.state_id = parseInt(state_id);
    }

    // Country filter - via state relation
    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.state = {
        country_id: parseInt(country_id)
      };
    }
    // Get total count
    const total = await Prisma.pam_cities.count({ where });
    // Get cities with state and country info
    const cities = await Prisma.pam_cities.findMany({
      where,
      include: {
        state: {
          include: {
            country: {
              select: {
                id: true,
                name: true,
                sortname: true
              }
            }
          }
        }
      },
      skip,
      take: limitNum,
      orderBy: { [sortBy]: sortOrder }
    });

    res.json({
      status: 'success',
      data: cities,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });

  } catch (err) {
    console.error('Get cities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch cities',
      error: err.message
    });
  }
});

// 2. GET /api/city/edit/:id - Get city data for edit
app.get('/api/city/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cityId = parseInt(id);

    if (isNaN(cityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid city ID'
      });
    }

    const city = await Prisma.pam_cities.findUnique({
      where: { id: cityId },
      include: {
        state: {
          include: {
            country: {
              select: {
                id: true,
                name: true,
                sortname: true
              }
            }
          }
        }
      }
    });

    if (!city) {
      return res.status(404).json({
        status: 'error',
        message: 'City not found'
      });
    }

    res.json({
      status: 'success',
      data: city
    });

  } catch (err) {
    console.error('Get city for edit error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch city data',
      error: err.message
    });
  }
});

// 3. POST /api/city/create - Create new city
app.post('/api/city/create', async (req, res) => {
  try {
    const { name, slug, state_id, status = 1 } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'City name is required'
      });
    }

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    if (!state_id) {
      return res.status(400).json({
        status: 'error',
        message: 'State is required'
      });
    }

    // Check if state exists
    const stateExists = await Prisma.pam_states.findUnique({
      where: { id: parseInt(state_id) }
    });

    if (!stateExists) {
      return res.status(400).json({
        status: 'error',
        message: 'State does not exist'
      });
    }

    // Check for duplicate city name in same state
    const existingCity = await Prisma.pam_cities.findFirst({
      where: {
        name: name.trim(),
        state_id: parseInt(state_id)
      }
    });

    if (existingCity) {
      return res.status(400).json({
        status: 'error',
        message: 'City with this name already exists in this state'
      });
    }

    // Check for duplicate slug
    const existingSlug = await Prisma.pam_cities.findFirst({
      where: { slug: slug.trim().toLowerCase() }
    });

    if (existingSlug) {
      return res.status(400).json({
        status: 'error',
        message: 'City with this slug already exists'
      });
    }

    // Create city
    const city = await Prisma.pam_cities.create({
      data: {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        state_id: parseInt(state_id),
        status: parseInt(status)
      },
      include: {
        state: {
          include: {
            country: {
              select: {
                id: true,
                name: true,
                sortname: true
              }
            }
          }
        }
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'City created successfully',
      data: city
    });

  } catch (err) {
    console.error('Create city error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create city',
      error: err.message
    });
  }
});

// 4. PUT /api/city/update/:id - Update city
app.put('/api/city/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, state_id, status } = req.body;
    const cityId = parseInt(id);

    if (isNaN(cityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid city ID'
      });
    }

    // Check if city exists
    const existingCity = await Prisma.pam_cities.findUnique({
      where: { id: cityId }
    });

    if (!existingCity) {
      return res.status(404).json({
        status: 'error',
        message: 'City not found'
      });
    }

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'City name is required'
      });
    }

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    if (!state_id) {
      return res.status(400).json({
        status: 'error',
        message: 'State is required'
      });
    }

    // Check if state exists
    const stateExists = await Prisma.pam_states.findUnique({
      where: { id: parseInt(state_id) }
    });

    if (!stateExists) {
      return res.status(400).json({
        status: 'error',
        message: 'State does not exist'
      });
    }

    // Check for duplicate city name in same state (excluding current city)
    const duplicateName = await Prisma.pam_cities.findFirst({
      where: {
        name: name.trim(),
        state_id: parseInt(state_id),
        id: { not: cityId }
      }
    });

    if (duplicateName) {
      return res.status(400).json({
        status: 'error',
        message: 'Another city with this name already exists in this state'
      });
    }

    // Check for duplicate slug (excluding current city)
    const duplicateSlug = await Prisma.pam_cities.findFirst({
      where: {
        slug: slug.trim().toLowerCase(),
        id: { not: cityId }
      }
    });

    if (duplicateSlug) {
      return res.status(400).json({
        status: 'error',
        message: 'Another city with this slug already exists'
      });
    }

    // Update city
    const updatedCity = await Prisma.pam_cities.update({
      where: { id: cityId },
      data: {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        state_id: parseInt(state_id),
        status: status !== undefined ? parseInt(status) : existingCity.status
      },
      include: {
        state: {
          include: {
            country: {
              select: {
                id: true,
                name: true,
                sortname: true
              }
            }
          }
        }
      }
    });

    res.json({
      status: 'success',
      message: 'City updated successfully',
      data: updatedCity
    });

  } catch (err) {
    console.error('Update city error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update city',
      error: err.message
    });
  }
});

// 5. DELETE /api/city/delete/:id - Delete city
app.delete('/api/city/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cityId = parseInt(id);

    if (isNaN(cityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid city ID'
      });
    }

    // Check if city exists
    const city = await Prisma.pam_cities.findUnique({
      where: { id: cityId }
    });

    if (!city) {
      return res.status(404).json({
        status: 'error',
        message: 'City not found'
      });
    }

    // Delete city
    await Prisma.pam_cities.delete({
      where: { id: cityId }
    });

    res.json({
      status: 'success',
      message: 'City deleted successfully'
    });

  } catch (err) {
    console.error('Delete city error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete city',
      error: err.message
    });
  }
});

// 6. GET /api/city/view/:id - Get city details
app.get('/api/city/view/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cityId = parseInt(id);

    if (isNaN(cityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid city ID'
      });
    }

    const city = await Prisma.pam_cities.findUnique({
      where: { id: cityId },
      include: {
        state: {
          include: {
            country: {
              select: {
                id: true,
                name: true,
                sortname: true,
                phonecode: true
              }
            }
          }
        }
      }
    });

    if (!city) {
      return res.status(404).json({
        status: 'error',
        message: 'City not found'
      });
    }

    res.json({
      status: 'success',
      data: city
    });

  } catch (err) {
    console.error('Get city details error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch city details',
      error: err.message
    });
  }
});

// 7. GET /api/city/status/:id - Get city status only
app.get('/api/city/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cityId = parseInt(id);

    if (isNaN(cityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid city ID'
      });
    }

    const city = await Prisma.pam_cities.findUnique({
      where: { id: cityId },
      select: {
        id: true,
        name: true,
        status: true
      }
    });

    if (!city) {
      return res.status(404).json({
        status: 'error',
        message: 'City not found'
      });
    }

    res.json({
      status: 'success',
      data: {
        id: city.id,
        name: city.name,
        status: city.status,
        status_text: city.status === 1 ? 'Active' : 'Inactive'
      }
    });

  } catch (err) {
    console.error('Get city status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch city status',
      error: err.message
    });
  }
});

// 8. PATCH /api/city/status/update/:id - Update city status
app.patch('/api/city/status/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const cityId = parseInt(id);

    if (isNaN(cityId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid city ID'
      });
    }

    if (status === undefined || ![0, 1].includes(parseInt(status))) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid status (0 or 1) is required'
      });
    }

    const city = await Prisma.pam_cities.findUnique({
      where: { id: cityId }
    });

    if (!city) {
      return res.status(404).json({
        status: 'error',
        message: 'City not found'
      });
    }

    const updatedCity = await Prisma.pam_cities.update({
      where: { id: cityId },
      data: {
        status: parseInt(status)
      },
      include: {
        state: {
          select: {
            id: true,
            name: true,
            country: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.json({
      status: 'success',
      message: `City ${updatedCity.status === 1 ? 'activated' : 'deactivated'} successfully`,
      data: updatedCity
    });

  } catch (err) {
    console.error('Update city status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update city status',
      error: err.message
    });
  }
});

// 9. GET /api/city/search - Search cities
app.get('/api/city/search', async (req, res) => {
  try {
    const { q = '', limit = 10, state_id = '', country_id = '' } = req.query;

    if (!q || q.trim() === '') {
      return res.json({
        status: 'success',
        data: []
      });
    }

    const where = {
      OR: [
        { name: { contains: q.trim() } },
        { slug: { contains: q.trim() } }
      ],
      status: 1
    };

    if (state_id !== '' && !isNaN(parseInt(state_id))) {
      where.state_id = parseInt(state_id);
    }

    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.state = {
        country_id: parseInt(country_id)
      };
    }

    const cities = await Prisma.pam_cities.findMany({
      where,
      take: parseInt(limit) || 10,
      select: {
        id: true,
        name: true,
        slug: true,
        state_id: true,
        state: {
          select: {
            name: true,
            country: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      status: 'success',
      data: cities
    });

  } catch (err) {
    console.error('Search cities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to search cities',
      error: err.message
    });
  }
});

// 10. GET /api/city/by-state/:state_id - Get cities by state
app.get('/api/city/by-state/:state_id', async (req, res) => {
  try {
    const { state_id } = req.params;
    const { status = '1' } = req.query;

    const stateIdNum = parseInt(state_id);
    if (isNaN(stateIdNum)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid state ID'
      });
    }

    // Check if state exists
    const stateExists = await Prisma.pam_states.findUnique({
      where: { id: stateIdNum }
    });

    if (!stateExists) {
      return res.status(404).json({
        status: 'error',
        message: 'State not found'
      });
    }

    const where = {
      state_id: stateIdNum
    };

    if (status !== '' && !isNaN(parseInt(status))) {
      where.status = parseInt(status);
    }

    const cities = await Prisma.pam_cities.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      status: 'success',
      data: cities
    });

  } catch (err) {
    console.error('Get cities by state error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch cities by state',
      error: err.message
    });
  }
});

// 11. GET /api/city/active - Get active cities only
app.get('/api/city/active', async (req, res) => {
  try {
    const { state_id = '', country_id = '', limit = 100 } = req.query;

    const where = {
      status: 1
    };

    if (state_id !== '' && !isNaN(parseInt(state_id))) {
      where.state_id = parseInt(state_id);
    }

    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.state = {
        country_id: parseInt(country_id)
      };
    }

    const cities = await Prisma.pam_cities.findMany({
      where,
      take: parseInt(limit) || 100,
      include: {
        state: {
          select: {
            id: true,
            name: true,
            country: {
              select: {
                id: true,
                name: true,
                sortname: true
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      status: 'success',
      data: cities
    });

  } catch (err) {
    console.error('Get active cities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch active cities',
      error: err.message
    });
  }
});

// 12. GET /api/city/count - Get city counts
app.get('/api/city/count', async (req, res) => {
  try {
    const { state_id = '', country_id = '' } = req.query;

    const where = {};

    if (state_id !== '' && !isNaN(parseInt(state_id))) {
      where.state_id = parseInt(state_id);
    }

    if (country_id !== '' && !isNaN(parseInt(country_id))) {
      where.state = {
        country_id: parseInt(country_id)
      };
    }

    const total = await Prisma.pam_cities.count({ where });
    const active = await Prisma.pam_cities.count({
      where: { ...where, status: 1 }
    });
    const inactive = await Prisma.pam_cities.count({
      where: { ...where, status: 0 }
    });

    res.json({
      status: 'success',
      data: {
        total,
        active,
        inactive
      }
    });

  } catch (err) {
    console.error('Count cities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to count cities',
      error: err.message
    });
  }
});

// 13. GET /api/city/validate-slug/:slug - Validate slug uniqueness
app.get('/api/city/validate-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { exclude_id = '' } = req.query;

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Slug is required'
      });
    }

    const where = {
      slug: slug.trim().toLowerCase()
    };

    if (exclude_id !== '' && !isNaN(parseInt(exclude_id))) {
      where.id = { not: parseInt(exclude_id) };
    }

    const existingCity = await Prisma.pam_cities.findFirst({
      where
    });

    res.json({
      status: 'success',
      data: {
        is_unique: !existingCity,
        message: existingCity ? 'Slug already exists' : 'Slug is available'
      }
    });

  } catch (err) {
    console.error('Validate slug error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to validate slug',
      error: err.message
    });
  }
});

// 14. POST /api/city/bulk-status-update - Bulk update city status
app.post('/api/city/bulk-status-update', async (req, res) => {
  try {
    const { city_ids, status } = req.body;

    if (!city_ids || !Array.isArray(city_ids) || city_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'city_ids array is required'
      });
    }

    if (status === undefined || ![0, 1].includes(parseInt(status))) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid status (0 or 1) is required'
      });
    }

    // Convert all IDs to numbers
    const cityIdsNum = city_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    // Update all selected cities
    await Prisma.pam_cities.updateMany({
      where: {
        id: {
          in: cityIdsNum
        }
      },
      data: {
        status: parseInt(status)
      }
    });

    res.json({
      status: 'success',
      message: `${cityIdsNum.length} cit${cityIdsNum.length === 1 ? 'y' : 'ies'} ${status === '1' ? 'activated' : 'deactivated'} successfully`
    });

  } catch (err) {
    console.error('Bulk update city status error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update city status in bulk',
      error: err.message
    });
  }
});

// 15. POST /api/city/bulk-delete - Bulk delete cities
app.post('/api/city/bulk-delete', async (req, res) => {
  try {
    const { city_ids } = req.body;

    if (!city_ids || !Array.isArray(city_ids) || city_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'city_ids array is required'
      });
    }

    // Convert all IDs to numbers
    const cityIdsNum = city_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    // Delete all selected cities
    await Prisma.pam_cities.deleteMany({
      where: {
        id: {
          in: cityIdsNum
        }
      }
    });

    res.json({
      status: 'success',
      message: `${cityIdsNum.length} cit${cityIdsNum.length === 1 ? 'y' : 'ies'} deleted successfully`
    });

  } catch (err) {
    console.error('Bulk delete cities error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete cities in bulk',
      error: err.message
    });
  }
});
// -------------------------  END CITY ------------------------- 


// -------------------------  START LOG  -------------------------
// Activity Log APIs
app.get('/api/activity-logs', async (req, res) => {
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
      data: logs,
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
});

// Get activity log statistics
app.get('/api/activity-logs/stats', async (req, res) => {
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
});
// -------------------------  END LOG  -------------------------




// -------------------------  START ROLE  -------------------------

app.get('/api/roles', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'admin_role_created_on',
      sortOrder = 'desc',
      status = ''
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (search) {
      where.OR = [
        { admin_role_title: { contains: search } }
      ];
    }

    if (status !== '') {
      where.admin_role_status = parseInt(status);
    }

    // Fetch without date fields first
    const roles = await Prisma.ci_admin_roles.findMany({
      where,
      orderBy: { admin_role_id: sortOrder === 'asc' ? 'asc' : 'desc' },
      skip,
      take: limitNum,
      select: {
        admin_role_id: true,
        admin_role_title: true,
        admin_role_status: true,
        admin_role_created_by: true,
        admin_role_modified_by: true,
        // Exclude date fields temporarily
        // admin_role_created_on: true,
        // admin_role_modified_on: true
      }
    });

    const total = await Prisma.ci_admin_roles.count({ where });

    // Format response
    const formattedRoles = roles.map(role => ({
      id: role.admin_role_id,
      title: role.admin_role_title,
      status: role.admin_role_status,
      created_by: role.admin_role_created_by,
      modified_by: role.admin_role_modified_by
      // created_on: null, // Temporary
      // modified_on: null // Temporary
    }));

    res.json({
      status: 'success',
      data: formattedRoles,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch roles'
    });
  }
});

// GET single role by ID
app.get('/api/roles/:id', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    // Format response
    const formattedRole = {
      id: role.admin_role_id,
      title: role.admin_role_title,
      status: role.admin_role_status,
      created_by: role.admin_role_created_by,
      created_on: role.admin_role_created_on,
      modified_by: role.admin_role_modified_by,
      modified_on: role.admin_role_modified_on
    };

    res.json({
      status: 'success',
      data: formattedRole
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch role'
    });
  }
});
// POST create new role
app.post('/api/roles/create', async (req, res) => {
  try {
    const {
      title,
      status = 1,
      created_by
    } = req.body;

    // Validation
    if (!title || !created_by) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and created_by are required'
      });
    }

    if (title.length > 30) {
      return res.status(400).json({
        status: 'error',
        message: 'Title must be 30 characters or less'
      });
    }

    // Check if role with same title exists
    const existingRole = await Prisma.ci_admin_roles.findFirst({
      where: { admin_role_title: title }
    });

    if (existingRole) {
      return res.status(409).json({
        status: 'error',
        message: 'Role with this title already exists'
      });
    }

    const now = new Date();
    const newRole = await Prisma.ci_admin_roles.create({
      data: {
        admin_role_title: title,
        admin_role_status: parseInt(status),
        admin_role_created_by: parseInt(created_by),
        admin_role_created_on: now,
        admin_role_modified_by: parseInt(created_by),
        admin_role_modified_on: now
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'Role created successfully',
      data: {
        id: newRole.admin_role_id,
        title: newRole.admin_role_title,
        status: newRole.admin_role_status
      }
    });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create role'
    });
  }
});
// PUT update role
app.put('/api/roles/:id/edit', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const {
      title,
      status,
      modified_by
    } = req.body;

    // Check if role exists
    const existingRole = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!existingRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    // Validation
    if (title && title.length > 30) {
      return res.status(400).json({
        status: 'error',
        message: 'Title must be 30 characters or less'
      });
    }

    // Check for duplicate title (excluding current role)
    if (title && title !== existingRole.admin_role_title) {
      const duplicateRole = await Prisma.ci_admin_roles.findFirst({
        where: {
          admin_role_title: title,
          NOT: { admin_role_id: roleId }
        }
      });

      if (duplicateRole) {
        return res.status(409).json({
          status: 'error',
          message: 'Role with this title already exists'
        });
      }
    }

    const updatedRole = await Prisma.ci_admin_roles.update({
      where: { admin_role_id: roleId },
      data: {
        admin_role_title: title || existingRole.admin_role_title,
        admin_role_status: status !== undefined ? parseInt(status) : existingRole.admin_role_status,
        admin_role_modified_by: parseInt(modified_by),
        admin_role_modified_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Role updated successfully',
      data: {
        id: updatedRole.admin_role_id,
        title: updatedRole.admin_role_title,
        status: updatedRole.admin_role_status
      }
    });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update role'
    });
  }
});
// DELETE role
app.delete('/api/roles/:id/delete', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    // Check if role exists
    const existingRole = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!existingRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    // Check if role is being used (optional - add your own logic)
    // const userCount = await prisma.ci_admin_users.count({
    //   where: { admin_role_id: roleId }
    // });

    // if (userCount > 0) {
    //   return res.status(400).json({ 
    //     status: 'error', 
    //     message: 'Cannot delete role that is assigned to users' 
    //   });
    // }

    await Prisma.ci_admin_roles.delete({
      where: { admin_role_id: roleId }
    });

    res.json({
      status: 'success',
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete role'
    });
  }
});
// PATCH toggle role status
app.patch('/api/roles/:id/toggle-status', async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await Prisma.ci_admin_roles.findUnique({
      where: { admin_role_id: roleId }
    });

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found'
      });
    }

    const updatedRole = await Prisma.ci_admin_roles.update({
      where: { admin_role_id: roleId },
      data: {
        admin_role_status: role.admin_role_status === 1 ? 0 : 1,
        admin_role_modified_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: `Role ${updatedRole.admin_role_status === 1 ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: updatedRole.admin_role_id,
        status: updatedRole.admin_role_status
      }
    });
  } catch (error) {
    console.error('Error toggling role status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update role status'
    });
  }
});
// PATCH bulk update status
app.patch('/api/roles/bulk/update-status', async (req, res) => {
  try {
    const { role_ids, status } = req.body;

    if (!Array.isArray(role_ids) || role_ids.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'role_ids array is required'
      });
    }

    if (status === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'status is required'
      });
    }

    const roleIds = role_ids.map(id => parseInt(id));
    const statusValue = parseInt(status);

    await Prisma.ci_admin_roles.updateMany({
      where: { admin_role_id: { in: roleIds } },
      data: {
        admin_role_status: statusValue,
        admin_role_modified_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: `Bulk status update completed for ${roleIds.length} role(s)`
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to perform bulk update'
    });
  }
});
// -------------------------  END LOG  -------------------------



// -------------------------  activities  -------------------------

// GET /api/activities - Get all activities with filters
app.get('/api/activities', async (req, res) => {
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
      data: activities,
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
});

// GET /api/activities/stats - Get activity statistics
app.get('/api/activities/stats', async (req, res) => {
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
});

// GET /api/activities/:id - Get single activity
app.get('/api/activities/:id', async (req, res) => {
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
      data: activity
    });

  } catch (err) {
    console.error('Get activity error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity',
      error: err.message
    });
  }
});

// -------------------------  end activities  -------------------------



// -------------------------  Upload new photo -------------------------
// PHOTO_CREDIT_LIST
app.get('/api/credits/active', async (req, res) => {
  try {
    const credits = await Prisma.pam_credit.findMany({
      where: { is_active: 1, },
      orderBy: { id: 'desc', },
    }); 
    const otherOption = {
      id: 0,
      firstname: "Other",
      lastname: "",
      email: "",
      mobile_no: "",
      address: "",
      is_active: 1,
      created_at: null,
      updated_at: null,
    }; 
    //const results = [otherOption, ...credits];
    const results = [...credits, otherOption];
    res.json({
      status: 'success',
      totalRecords: credits.length,
      results,
    });
  } catch (err) {
    console.error('Get active credits error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch active credits',
    });
  }
});

app.get('/api/tags', async (req, res) => {
  try {
    const tags = await Prisma.pam_tags.findMany({
      take: 25,
      orderBy: {
        tag_id: 'desc', // latest first
      },
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
});
app.get('/api/tags/search',   async (req, res) => {
  try {
    const q = (req.query.q || '').trim(); 
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
          { photo_tag: { contains: q, }, },
          { photo_slug: { contains: q, }, },
        ],
      },
      take: 50,
      orderBy: { photo_tag: 'asc', },
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
});

app.post('/api/tag/create', async (req, res) => {
  try {
    let { photo_tag } = req.body;
    //console.log("aaaaaaaaaa", photo_tag); return;
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
    //console.log("aaaaaaaaaa");
    // Check if tag already exists (by slug)
    const existingTag = await Prisma.pam_tags.findFirst({
      where: {
        photo_slug,
      },
    });
    //console.log("SSSS"); 
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
    // console.log("YYYY: ",  data ); return;
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
});



// new photo
app.post('/api/photos/upload2', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      photo_title,
      description,
      category_id,
      sub_category_id,
      price,
      photography_time,
      event_name
    } = req.body;

    // Validate required fields
    if (!photo_title || !category_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title and category are required'
      });
    }

    // Create photo entry
    const photo = await Prisma.pam_photos.create({
      data: {
        photo_title,
        description: description || '',
        category_id: parseInt(category_id),
        sub_category_id: sub_category_id ? parseInt(sub_category_id) : null,
        price: price ? parseFloat(price) : null,
        photography_time: photography_time ? new Date(photography_time) : new Date(),
        event_name: event_name || '',
        author_id: userId,
        is_active: 1,
        is_trash: 0,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'Photo created successfully',
      data: {
        photo_id: photo.photo_id,
        photo_title: photo.photo_title
      }
    });
  } catch (err) {
    console.error('Upload photo error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload photo'
    });
  }
});

// Upload photo files
app.post('/api/NEWphotos/:photoId/files/upload', async (req, res) => {
  try {
    const { photoId } = req.params;
    const userId = req.user.id;

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No files were uploaded'
      });
    }

    const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];
    const uploadedFiles = [];

    for (const file of files) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        continue; // Skip invalid files
      }

      // Generate unique filename
      const fileName = `${Date.now()}_${file.name}`;
      const uploadDir = path.join(__dirname, 'uploads', 'photos', photoId);

      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);

      // Move file
      await file.mv(filePath);

      // Create file record in database
      const fileRecord = await Prisma.pam_photos_files.create({
        data: {
          photo_id: parseInt(photoId),
          dir_path: `/uploads/photos/${photoId}`,
          Image_Name: fileName,
          raw_name: file.name,
          file_ext: path.extname(file.name),
          file_size: file.size,
          Width: null, // You can use image-size library to get dimensions
          Height: null,
          isMigrat: 'N',
          is_trash: 'N',
          updated_by: userId.toString(),
          updated_on: new Date(),
          date_created: new Date()
        }
      });

      uploadedFiles.push({
        file_id: fileRecord.file_id,
        filename: fileName,
        original_name: file.name,
        size: file.size
      });
    }

    res.json({
      status: 'success',
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      data: uploadedFiles
    });
  } catch (err) {
    console.error('Upload files error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload files'
    });
  }
});

//
// Single API (Photos + Files + Tags)
//



// UPLOAD_IMAGE API endpoint --- DEMO ---
app.post('/apieeee/upload/image', upload.single('image'), async (req, res) => {
  console.log("I AM HERE 111 ")
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No image file provided'
      });
    }

    // Create URL for the uploaded file
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    res.json({
      status: 'success',
      message: 'Image uploaded successfully',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: imageUrl,
        path: req.file.path
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Upload failed'
    });
  }
});
// REPLACE your current /api/upload/image endpoint with this:
app.post('/api/upload/image', async (req, res) => {
  console.log('=== /api/upload/image REQUEST RECEIVED ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);

  // Check if it's multipart form data
  if (!req.headers['content-type'] || !req.headers['content-type'].includes('multipart/form-data')) {
    return res.status(400).json({
      status: 'error',
      message: 'Content-Type must be multipart/form-data'
    });
  }

  // Create a new multer instance for this specific route
  const uploadSingleImage = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'images');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
      }
    }),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
      files: 1 // Only one file
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|gif|webp/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Only image files are allowed!'));
      }
    }
  }).single('image');

  // Use the multer middleware
  uploadSingleImage(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);

      // Handle specific errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'error',
          message: 'File too large. Maximum size is 10MB'
        });
      }

      if (err.message === 'Only image files are allowed!') {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'
        });
      }

      return res.status(400).json({
        status: 'error',
        message: 'Upload failed: ' + err.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded or file field name is incorrect. Use field name "image"'
      });
    }

    console.log('File uploaded successfully:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    try {
      // Get image metadata using sharp
      const metadata = await sharp(req.file.path).metadata();

      // Create URLs
      const imageUrl = `/uploads/images/${req.file.filename}`;
      const baseUrl = process.env.APP_URL || 'http://localhost:4600';
      const fullUrl = `${baseUrl}${imageUrl}`;

      res.json({
        status: 'success',
        message: 'Image uploaded successfully',
        data: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          dimensions: {
            width: metadata.width,
            height: metadata.height
          },
          url: imageUrl,
          fullUrl: fullUrl,
          path: req.file.path,
          timestamp: new Date().toISOString()
        }
      });
    } catch (sharpError) {
      console.error('Image processing error:', sharpError);

      // Still return success even if sharp fails
      const imageUrl = `/uploads/images/${req.file.filename}`;
      const baseUrl = process.env.APP_URL || 'http://localhost:4600';
      const fullUrl = `${baseUrl}${imageUrl}`;

      res.json({
        status: 'success',
        message: 'Image uploaded (metadata processing skipped)',
        data: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          url: imageUrl,
          fullUrl: fullUrl,
          path: req.file.path,
          note: 'Image metadata could not be processed'
        }
      });
    }
  });
});
// Full photo upload endpoint (with form data)
app.post('/api/upload/photo', upload.single('image'), async (req, res) => {
  console.log("I AM HERE 222 ")
  try {
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No image file provided'
      });
    }

    // Get form data
    const { title, description, author, category } = req.body;

    // Validate required fields
    if (!title || !category) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and category are required'
      });
    }

    // Create URL for the uploaded file
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    // In a real app, you would save to database here
    const photoData = {
      id: Date.now().toString(),
      title,
      description: description || '',
      author: author || '',
      category,
      image_url: imageUrl,
      filename: req.file.filename,
      created_at: new Date().toISOString(),
      file_info: {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    };

    res.json({
      status: 'success',
      message: 'Photo uploaded successfully',
      data: photoData
    });
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Photo upload failed'
    });
  }
});
// Multiple images upload
app.post('/api/upload/images', upload.array('images', 10), async (req, res) => {
  console.log("I AM HERE 333 ")
  try {
    console.log('Files received:', req.files?.length || 0);
    console.log('Form data:', req.body);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No images provided'
      });
    }

    const uploadedFiles = req.files.map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
    }));

    res.json({
      status: 'success',
      message: `${uploadedFiles.length} image(s) uploaded successfully`,
      data: {
        files: uploadedFiles,
        formData: req.body
      }
    });
  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Upload failed'
    });
  }
});
// --- end demo working--








// Replace your current /api/upload/simple endpoint with this:
app.post('/api/upload/simple', upload.single('image'), async (req, res) => {
  console.log('=== UPLOAD SIMPLE DEBUG ===');
  console.log('Request received');

  if (!req.file) {
    console.log('No file received');
    return res.status(400).json({
      status: "error",
      message: "No file uploaded"
    });
  }

  console.log('File received:', req.file.originalname);

  try {
    const file = req.file;
    const publicUrl = `/uploads/images/${file.filename}`;
    const baseUrl = process.env.APP_URL || 'http://localhost:4600';
    const fullUrl = `${baseUrl}${publicUrl}`;

    console.log('Processing image with sharp...');
    // Get image info
    const metadata = await sharp(file.path).metadata();

    console.log('Image processed successfully');

    res.status(200).json({
      status: "success",
      message: "File uploaded successfully",
      data: {
        filename: file.filename,
        original_name: file.originalname,
        url: fullUrl,
        width: metadata.width,
        height: metadata.height,
        size: file.size,
      }
    });
  } catch (error) {
    console.error('Error processing file:', error);

    // Clean up file
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('Cleaned up file:', req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    res.status(500).json({
      status: "error",
      message: "Failed to process uploaded file",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
/**
 *  Important for admin upload new Photo
 */
app.post('/api/add-admin-photos/upload-full', async (req, res) => {
  console.log('=== UPLOAD FULL API CALLED ===');

  // Use multer middleware directly in the route
  const uploadMultiple = upload.array('files', 50);

  uploadMultiple(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({
        status: 'error',
        message: err.message
      });
    }

    console.log('=== REQUEST DEBUG ===');
    console.log('Files received:', req.files ? req.files.length : 0);
    console.log('Body fields:', req.body);

    if (req.files && req.files.length > 0) {
      req.files.forEach((file, index) => {
        console.log(`File ${index + 1}:`, {
          name: file.originalname,
          size: file.size,
          type: file.mimetype
        });
      });
    }

    const userId = req.userId || 1;

    try {
      const {
        photo_title,
        description,
        category_id,
        sub_category_id,
        price,
        photography_time,
        event_name,
        tag_ids = []
      } = req.body;

      if (!photo_title || !category_id) {
        return res.status(400).json({
          status: 'error',
          message: 'Photo title and category are required'
        });
      }

      // Parse tag_ids if it's a string
      let parsedTagIds = [];
      if (tag_ids) {
        if (typeof tag_ids === 'string') {
          parsedTagIds = tag_ids.split(',').filter(id => id.trim() !== '');
        } else if (Array.isArray(tag_ids)) {
          parsedTagIds = tag_ids;
        }
      }

      const result = await Prisma.$transaction(async (tx) => {
        // 1. Create photo 
        const photo = await tx.pam_photos.create({
          data: {
            photo_title,
            description: description || '',
            category_id: parseInt(category_id),
            sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
            price: price ? parseFloat(price) : 0,
            photography_time: photography_time
              ? new Date(photography_time)
              : new Date(),
            event_name: event_name || '',
            author_id: userId,
            enter_by: userId,
            updated_by: userId,
            is_active: 1,
            is_trash: 0,
            created_at: new Date(),
            updated_at: new Date()
          }
        });

        const photoId = Number(photo.photo_id);

        // 2. Upload files + insert pam_photos_files 
        const uploadedFiles = [];

        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            const allowedTypes = [
              'image/jpeg',
              'image/jpg',
              'image/png',
              'image/webp',
              'image/gif'
            ];

            if (!allowedTypes.includes(file.mimetype)) {
              console.log(`Skipping file ${file.originalname} - invalid type`);
              continue;
            }

            const fileName = `${Date.now()}_${file.originalname}`;
            const uploadDir = path.join(__dirname, 'uploads', 'photos', String(photoId));

            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }

            const filePath = path.join(uploadDir, fileName);

            // Move file using fs.renameSync for multer
            fs.renameSync(file.path, filePath);

            const fileRow = await tx.pam_photos_files.create({
              data: {
                photo_id: photoId,
                dir_path: `/uploads/photos/${photoId}`,
                Image_Name: fileName,
                raw_name: file.originalname,
                original_image_name: file.originalname,
                file_ext: path.extname(file.originalname).replace('.', ''),
                file_size: String(file.size),
                source: 'upload',
                reference: '',
                date_created: new Date(),
                updated_by: userId.toString(),
                enter_by: userId.toString(),
                is_trash: 'N',
                Width: null,
                Height: null,
                isMigrat: 'N'
              }
            });

            uploadedFiles.push(fileRow);
          }
        }

        // 3. Insert tags (bulk)
        if (parsedTagIds.length > 0) {
          await tx.pam_photo_tags.createMany({
            data: parsedTagIds.map(tagId => ({
              photo_id: photoId,
              tag_id: parseInt(tagId)
            }))
          });
        }

        return {
          photo,
          uploadedFiles,
          tagsInserted: parsedTagIds.length
        };
      });

      res.status(201).json({
        status: 'success',
        message: 'Photo, files and tags saved successfully',
        data: {
          photo_id: result.photo.photo_id,
          files: result.uploadedFiles.length,
          tags: result.tagsInserted
        }
      });

    } catch (err) {
      console.error('Upload full photo error:', err);

      res.status(500).json({
        status: 'error',
        message: 'Upload failed. All changes rolled back.'
      });
    }
  });
});

// New Photo Upload Old
// http://localhost:4600/api/photos/upload-full
// app.post('/api/add-admin-photos/upload-full', upload.array('files'),  async (req, res) => 

/*
// FOR UPLOAD NEW PHOTO
app.post('/api/admin-photos/upload-full', upload.array('files', 50), async (req, res) => {
  console.log("=== REQUEST DEBUG (api/admin-photos/upload-full) ===");
  console.log("I am in Create mode ~~~ API");

  // Check body fields
  console.log("Body fields:", JSON.stringify(req.body));
  console.log("\n");
  // Check files
  console.log(JSON.stringify(req.files));
  console.log("\n");


  //return;

  // Check what fields are available
  console.log("Available fields in body:", Object.keys(req.body));
  if (req.files) {
    console.log("Number of files:", req.files.length);
    req.files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
      console.log("\n");
    });
  }
  console.log("\n");
  //return;

  const userId = req.userId || 1;
  try {
    const {
      photo_title,
      event_name,
      description,
      category_id,
      sub_category_id,
      country_id,
      state_id,
      city_id,
      source_name,
      price,
      photography_time,
      author_id,
      photo_credit_id,
      credit,
      tag_ids = [],
      files_data
    } = req.body;

    if (!photo_title || !category_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title and category are required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one image file is required'
      });
    }

    const files = req.files;

    const result = await Prisma.$transaction(async (tx) => {

      // 1 Create photo 
      const photo = await tx.pam_photos.create({
        data: {
          photo_title,
          event_name: event_name || '',
          description: description || '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,

          country_id: parseInt(country_id),
          state_id: parseInt(state_id),
          city_id: parseInt(city_id),
          author_id: userId,
          media_type: 'photo',
          source_name: source_name || '',

          credit: parseInt(photo_credit_id) || 0,
          other_credit: 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time
            ? new Date(photography_time)
            : new Date(),
          event_name: event_name || '',

          enter_by: userId,
          updated_by: userId,
          is_active: 1,
          is_trash: 0,
        }
      });

      const photoId = Number(photo.photo_id);

      // 2 Upload files + insert pam_photos_files 
      const uploadedFiles = [];

      for (const file of req.files) {

        // Read image metadata
        const meta = await sharp(file.path).metadata();
        const width = meta.width || 0;
        const height = meta.height || 0;
        const orientation = getOrientationScientific(parseInt(width), parseInt(height));

        const fileName = file.filename; // generated by Multer
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        const uploadDir = path.join(__dirname, 'uploads', 'photos', String(photoId));

        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        //const filePath = path.join(uploadDir, fileName);
        //await file.mv(filePath);
        console.log(width);
        console.log(height);
        console.log(orientation);

        const fileRow = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: ext,
            type: ext, //path.extname(file.name).replace('.', ''),
            dir_path: `/uploads/photos/${photoId}`,
            file_size: String(file.size),
            reference: '',
            source: 'Outlook Images',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: width,
            Height: height, 
            orientation:  orientation || null, 
            raw_name:  baseFileName  || '',
            Image_Name: file.fileName,
            original_image_name: originalName,
            isMigrat: 0,
          }
        });
        uploadedFiles.push(fileRow);
      }

      // 3️⃣ Insert tags (bulk)
      if (tag_ids.length > 0) {
        await tx.pam_photo_tags.createMany({
          data: tag_ids.map(tagId => ({
            photo_id: photoId,
            tag_id: parseInt(tagId)
          }))
        });
      }
      return {
        photo,
        uploadedFiles,
        tagsInserted: Array.isArray(tag_ids) ? tag_ids.length : 0
      };
    });
    const safeResult = serializeBigInt({
      status: 'success',
      message: 'Photo, files and tags saved successfully',
      data: {
        photo_id: result.photo.photo_id,
        files: result.uploadedFiles.length,
        tags: result.tagsInserted
      }
    });
    return res.status(201).json(safeResult);
  } catch (err) {
    console.error('Upload full photo error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Upload failed. All changes rolled back.'
    });

  }
});
*/

/** WORKING BEFORE S3
app.post('/api/admin-photos/upload-full', upload.array('files', 50), async (req, res) => {
  console.log("=== REQUEST DEBUG (api/admin-photos/upload-full) ===");
  console.log("I am in Create mode ~~~ API");

  // Check body fields
  console.log("Body fields:", JSON.stringify(req.body));
  console.log("\n");
  // Check files
  console.log(JSON.stringify(req.files));
  console.log("\n");

  // Check what fields are available
  console.log("Available fields in body:", Object.keys(req.body));
  if (req.files) {
    console.log("Number of files:", req.files.length);
    req.files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
      console.log("\n");
    });
  }
  console.log("\n");

  const userId = req.userId || 1;
  try {
    const {
      photo_title,
      event_name,
      description,
      category_id,
      sub_category_id,
      country_id,
      state_id,
      city_id,
      source_name,
      price,
      photography_time,
      author_id,
      photo_credit_id,
      credit,
      tag_ids = [],
      files_data
    } = req.body;

    if (!photo_title || !category_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title and category are required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one image file is required'
      });
    }

    const files = req.files;
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentDate.getDate()).padStart(2, '0');

    const result = await Prisma.$transaction(async (tx) => {

      // 1 Create photo 
      const photo = await tx.pam_photos.create({
        data: {
          photo_title,
          event_name: event_name || '',
          description: description || '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,

          country_id: parseInt(country_id),
          state_id: parseInt(state_id),
          city_id: parseInt(city_id),
          author_id: userId,
          media_type: 'photo',
          source_name: source_name || '',

          credit: parseInt(photo_credit_id) || 0,
          other_credit: 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time
            ? new Date(photography_time)
            : new Date(),
          event_name: event_name || '',

          enter_by: userId,
          updated_by: userId,
          is_active: 1,
          is_trash: 0,
        }
      });

      const photoId = Number(photo.photo_id);

      // 2 Upload files + insert pam_photos_files 
      const uploadedFiles = [];

      for (const file of req.files) {
        // Create directories based on current date
        const mainDir = path.join(__dirname, 'uploads', String(year), month, date);
        const thumbnailDir = path.join(__dirname, 'uploads', '400', String(year), month, date);
        
        // Create directories if they don't exist
        if (!fs.existsSync(mainDir)) {
          fs.mkdirSync(mainDir, { recursive: true });
        }
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true });
        }

        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileName = `${timestamp}_${randomString}${path.extname(file.originalname)}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        const mainFilePath = path.join(mainDir, fileName);
        const thumbnailFilePath = path.join(thumbnailDir, fileName);

        // Read image metadata from the temporary file
        const meta = await sharp(file.path).metadata();
        const width = meta.width || 0;
        const height = meta.height || 0;
        const orientation = getOrientationScientific(parseInt(width), parseInt(height));

        console.log("Image metadata:", { width, height, orientation });

        // Move original file to main directory
        fs.renameSync(file.path, mainFilePath);

        // Create thumbnail (400px width, maintain aspect ratio)
        try {
          await sharp(mainFilePath)
            .resize({
              width: 400,
              height: 400,
              fit: 'inside', // Maintain aspect ratio, fit within 400x400
              withoutEnlargement: true // Don't enlarge if image is smaller
            })
            .toFile(thumbnailFilePath);

          console.log(`Thumbnail created: ${thumbnailFilePath}`);
        } catch (thumbnailError) {
          console.error('Error creating thumbnail:', thumbnailError);
          // Continue even if thumbnail creation fails
        }

        const fileRow = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: ext,
            type: ext,
            dir_path: `/${year}/${month}/${date}`, // Updated path 
            file_size: String(file.size),
            reference: '',
            source: 'Outlook Images',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: width,
            Height: height, 
            orientation: orientation || null, 
            raw_name: baseFileName || '',
            Image_Name: fileName, // Use the new generated filename
            original_image_name: originalName,
            isMigrat: 0,
          }
        });
        uploadedFiles.push(fileRow);
      }

      // 3️⃣ Insert tags (bulk)
      if (tag_ids.length > 0) {
        await tx.pam_photo_tags.createMany({
          data: tag_ids.map(tagId => ({
            photo_id: photoId,
            tag_id: parseInt(tagId)
          }))
        });
      }
      return {
        photo,
        uploadedFiles,
        tagsInserted: Array.isArray(tag_ids) ? tag_ids.length : 0,
        directories: {
          main: `/uploads/${year}/${month}/${date}`,
          thumbnail: `/uploads/400/${year}/${month}/${date}`
        }
      };
    });
    
    const safeResult = serializeBigInt({
      status: 'success',
      message: 'Photo, files and tags saved successfully',
      data: {
        photo_id: result.photo.photo_id,
        files: result.uploadedFiles.length,
        tags: result.tagsInserted,
        directories: result.directories
      }
    });
    return res.status(201).json(safeResult);
  } catch (err) {
    console.error('Upload full photo error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Upload failed. All changes rolled back.'
    });
  }
});
*/
// api/admin-photos/upload-full
//261
app.post('/apiapiapiapiapiapi-api/admin-photos/upload-full', upload.array('files', 50), jsonParser, urlencodedParser, async (req, res) => {
  console.log("=== REQUEST DEBUG (api/admin-photos/upload-full) ==="); //  photo_tags
  // console.log("I am in Create mode ~~~ API");

  // // Check body fields
  // console.log("Body fields:", JSON.stringify(req.body));
  // console.log("\n");
  // // Check files
  // console.log(JSON.stringify(req.files));
  // console.log("\n");

  // Check what fields are available
  console.log("Available fields in body:", Object.keys(req.body));
  if (req.files) {
    console.log("Number of files:", req.files.length);
    req.files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
      console.log("\n");
    });
  }
  console.log("\n");

  const userId = req.userId || 1;
  try {
    const {
      photo_title,
      event_name,
      description,
      category_id,
      sub_category_id,
      country_id,
      state_id,
      city_id,
      source_name,
      price,
      photography_time,
      author_id,
      photo_credit_id,
      credit,
      tag_ids = [],
      files_data , photo_tags
    } = req.body;

    if (!photo_title || !category_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title and category are required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one image file is required'
      });
    }

    const files = req.files;
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentDate.getDate()).padStart(2, '0');

    const result = await Prisma.$transaction(async (tx) => {

      // 1 Create photo 
      const photo = await tx.pam_photos.create({
        data: {
          photo_title,
          event_name: event_name || '',
          description: description || '',
          photo_tags: photo_tags || '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,

          country_id: parseInt(country_id),
          state_id: parseInt(state_id),
          city_id: parseInt(city_id),
          author_id: userId,
          media_type: 'photo',
          source_name: source_name || '',

          credit: parseInt(photo_credit_id) || 0,
          other_credit: 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time
            ? new Date(photography_time)
            : new Date(),
          event_name: event_name || '',

          enter_by: userId,
          updated_by: userId,
          is_active: 1,
          is_trash: 0,
        }
      });

      const photoId = Number(photo.photo_id);

      // 2 Upload files to S3 + insert pam_photos_files 
      const uploadedFiles = [];

      for (const file of req.files) {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileName = `${timestamp}_${randomString}${path.extname(file.originalname)}`;
        const originalName = file.originalname;
        const ext = path.extname(originalName).replace('.', '');
        const baseFileName = path.parse(originalName).name;

        // Read file buffer from temporary file
        const fileBuffer = fs.readFileSync(file.path);

        // Read image metadata
        const meta = await sharp(fileBuffer).metadata();
        const width = meta.width || 0;
        const height = meta.height || 0;
        const orientation = getOrientationScientific(parseInt(width), parseInt(height));

        console.log("Image metadata:", { width, height, orientation });

        // Generate S3 keys
        const mainFileKey = generateS3Key(fileName, false);
        const thumbnailKey = generateS3Key(fileName, true);

        let mainFileUrl = '';
        let thumbnailUrl = '';

        try {
          // Upload original image to S3 (without ACL)
          await uploadToS3(fileBuffer, mainFileKey, file.mimetype);
          mainFileUrl = getPublicUrl(mainFileKey);

          console.log(`Main image uploaded to S3: ${mainFileUrl}`);

          // Create thumbnail buffer
          const thumbnailBuffer = await sharp(fileBuffer)
            .resize({
              width: 400,
              height: 400,
              fit: 'inside',
              withoutEnlargement: true
            })
            .toBuffer();

          // Upload thumbnail to S3 (without ACL)
          await uploadToS3(thumbnailBuffer, thumbnailKey, file.mimetype);
          thumbnailUrl = getPublicUrl(thumbnailKey);

          console.log(`Thumbnail uploaded to S3: ${thumbnailUrl}`);

          // Clean up local temporary file
          fs.unlinkSync(file.path);

        } catch (s3Error) {
          console.error('S3 upload error:', s3Error);
          // Clean up temp file even if S3 upload fails
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
          throw new Error(`Failed to upload to S3: ${s3Error.message}`);
        }

        // Create database record
        const fileRow = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: ext,
            type: ext,
            dir_path: `testing/${year}/${month}/${date}`,
            file_size: String(file.size),
            reference: '',
            source: 'Outlook Images',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: width,
            Height: height,
            orientation: orientation || null,
            raw_name: baseFileName || '',
            Image_Name: fileName,
            original_image_name: originalName,
            isMigrat: 0,
          }
        });

        uploadedFiles.push({
          ...fileRow,
          s3_url: mainFileUrl,
          s3_thumbnail_url: thumbnailUrl
        });
      }

      // 3. Insert tags (bulk)
      if (tag_ids.length > 0) {
        await tx.pam_photo_tags.createMany({
          data: tag_ids.map(tagId => ({
            photo_id: photoId,
            tag_id: parseInt(tagId)
          }))
        });
      }

      return {
        photo,
        uploadedFiles,
        tagsInserted: Array.isArray(tag_ids) ? tag_ids.length : 0,
        storage: {
          type: 'aws_s3',
          bucket: S3_BUCKET_NAME,
          region: process.env.AWS_REGION || 'us-east-1',
          main_directory: `uploads/${year}/${month}/${date}`,
          thumbnail_directory: `uploads/400/${year}/${month}/${date}`
        }
      };
    });

    const safeResult = serializeBigInt({
      status: 'success',
      message: 'Photo, files and tags uploaded to AWS S3 successfully',
      data: {
        photo_id: result.photo.photo_id,
        files: result.uploadedFiles.length,
        tags: result.tagsInserted,
        storage: result.storage,
        file_urls: result.uploadedFiles.map(file => ({
          file_id: file.file_id,
          s3_url: file.s3_url,
          s3_thumbnail_url: file.s3_thumbnail_url
        }))
      }
    });
    return res.status(201).json(safeResult);
  } catch (err) {
    console.error('Upload full photo error:', err);

    // Clean up any remaining temporary files
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    return res.status(500).json({
      status: 'error',
      message: `Upload failed: ${err.message}`
    });
  }
});

app.post('/api/admin-photos/upload-full', upload.array('files', 50), jsonParser, urlencodedParser, async (req, res) => {
  console.log("=== REQUEST DEBUG (api/admin-photos/upload-full) ===");
  console.log("Available fields in body:", Object.keys(req.body)); 

  const userId = req.userId || 1;
  
  try {
    const {
      photo_title,
      event_name,
      description,
      category_id,
      sub_category_id,
      country_id,
      state_id,
      city_id,
      source_name,
      price,
      photography_time,
      author_id,
      photo_credit_id,
      credit,
      tag_ids = [],
      files_data,
      photo_tags
    } = req.body; 

    if (!photo_title || !category_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Photo title and category are required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one image file is required'
      });
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const date = String(currentDate.getDate()).padStart(2, '0');

    // 1. First, upload all files to S3 (outside transaction)
    const uploadPromises = req.files.map(async (file) => {
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const fileName = `${timestamp}_${randomString}${path.extname(file.originalname)}`;
      const originalName = file.originalname;
      const ext = path.extname(originalName).replace('.', '');
      const baseFileName = path.parse(originalName).name;

      // Read file buffer
      const fileBuffer = fs.readFileSync(file.path);

      // Read image metadata
      const meta = await sharp(fileBuffer).metadata();
      const width = meta.width || 0;
      const height = meta.height || 0;
      const orientation = getOrientationScientific(parseInt(width), parseInt(height));

      // Generate S3 keys
      const mainFileKey = generateS3Key(fileName, false);
      const thumbnailKey = generateS3Key(fileName, true);

      // Upload main image
      await uploadToS3(fileBuffer, mainFileKey, file.mimetype);
      const mainFileUrl = getPublicUrl(mainFileKey);

      // Create and upload thumbnail
      const thumbnailBuffer = await sharp(fileBuffer)
        .resize({
          width: 400,
          height: 400,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer();

      await uploadToS3(thumbnailBuffer, thumbnailKey, file.mimetype);
      const thumbnailUrl = getPublicUrl(thumbnailKey);

      // Clean up local temporary file
      fs.unlinkSync(file.path);

      return {
        fileName,
        originalName,
        ext,
        baseFileName,
        width,
        height,
        orientation,
        fileSize: file.size,
        mainFileUrl,
        thumbnailUrl,
        mimeType: file.mimetype
      };
    });

    // Wait for all S3 uploads to complete
    const uploadResults = await Promise.all(uploadPromises);

    // 2. Now do the database transaction (without S3 uploads, should be fast)
    const result = await Prisma.$transaction(async (tx) => {
      // Create photo
      const photo = await tx.pam_photos.create({
        data: {
          photo_title,
          event_name: event_name || '',
          description: description || '',
          photo_tags: photo_tags || '',
          category_id: parseInt(category_id),
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : 0,
          country_id: parseInt(country_id) || 0,
          state_id: parseInt(state_id) || 0,
          city_id: parseInt(city_id) || 0,
          author_id: userId,
          media_type: 'photo',
          source_name: source_name || '',
          credit: parseInt(photo_credit_id) || 0,
          other_credit: 'nk',
          price: price ? parseFloat(price) : 0,
          photography_time: photography_time
            ? new Date(photography_time)
            : new Date(),
          enter_by: userId,
          updated_by: userId,
          is_active: 1,
          is_trash: 0,
        }
      });

      const photoId = Number(photo.photo_id);

      // Insert file records
      const uploadedFiles = [];
      for (const uploadResult of uploadResults) {
        const fileRow = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            file_ext: uploadResult.ext,
            type: uploadResult.ext,
            dir_path: `testing/${year}/${month}/${date}`,
            file_size: String(uploadResult.fileSize),
            reference: '',
            source: 'Outlook Images',
            date_created: new Date(),
            enter_by: String(userId),
            entered_on: new Date(),
            updated_by: String(userId),
            updated_on: new Date(),
            is_trash: 'N',
            trashed_by: '',
            trashed_on: new Date(),
            Width: uploadResult.width,
            Height: uploadResult.height,
            orientation: uploadResult.orientation || null,
            raw_name: uploadResult.baseFileName || '',
            Image_Name: uploadResult.fileName,
            original_image_name: uploadResult.originalName,
            isMigrat: 0,
          }
        });

        uploadedFiles.push({
          ...fileRow,
          s3_url: uploadResult.mainFileUrl,
          s3_thumbnail_url: uploadResult.thumbnailUrl
        });
      }

      // Insert tags (bulk)
      if (tag_ids.length > 0) {
        await tx.pam_photo_tags.createMany({
          data: tag_ids.map(tagId => ({
            photo_id: photoId,
            tag_id: parseInt(tagId)
          }))
        });
      }

      return {
        photo,
        uploadedFiles,
        tagsInserted: Array.isArray(tag_ids) ? tag_ids.length : 0
      };
    }, {
      maxWait: 10000,    // 10 seconds max wait
      timeout: 30000,    // 30 seconds timeout
    });

    const safeResult = serializeBigInt({
      status: 'success',
      message: 'Photo, files and tags uploaded to AWS S3 successfully',
      data: {
        photo_id: result.photo.photo_id,
        files: result.uploadedFiles.length,
        tags: result.tagsInserted,
        storage: {
          type: 'aws_s3',
          bucket: S3_BUCKET_NAME,
          region: process.env.AWS_REGION || 'us-east-1',
          main_directory: `uploads/${year}/${month}/${date}`,
          thumbnail_directory: `uploads/400/${year}/${month}/${date}`
        },
        file_urls: result.uploadedFiles.map(file => ({
          file_id: file.file_id,
          s3_url: file.s3_url,
          s3_thumbnail_url: file.s3_thumbnail_url
        }))
      }
    });
    
    return res.status(201).json(safeResult);
    
  } catch (err) {
    console.error('Upload full photo error:', err);

    // Clean up any remaining temporary files
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    return res.status(500).json({
      status: 'error',
      message: `Upload failed: ${err.message}`
    });
  }
});




/*
// Handle single file upload
app.post('/api/photos/upl---oad-full---new',  upload.single('photo_file'), async (req, res) => {
        const userId = req.userId  || 1;
        
        try {
            // Get all form fields from req.body (multer adds them)
            const {
                photo_title,
                description,
                category_id,
                sub_category_id,
                price,
                photography_time,
                event_name,
                author,
                photo_credit_id,
                country_id,
                state_id,
                city_id,
                source,
                max_downloads,
                status,
                image_url, // if not uploading new file
                exif_data
            } = req.body;

            // Get uploaded file info
            const photo_file = req.file;
            
            if (!photo_title || !category_id) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Photo title and category are required'
                });
            }

            // Handle tags - they come as tag_ids[0], tag_ids[1], etc.
            const tag_ids = [];
            for (const key in req.body) {
                if (key.startsWith('tag_ids[')) {
                    tag_ids.push(req.body[key]);
                }
            }

            // If a file was uploaded, get its path
            let finalImageUrl = image_url;
            if (photo_file) {
                // Save the file path
                finalImageUrl = `/uploads/photos/${photo_file.filename}`;
                
                // Optionally process EXIF data from the uploaded file
                if (exif_data) {
                    const parsedExif = JSON.parse(exif_data);
                    // Save EXIF data to database
                }
            }

            // Create photo in database
            const photo = await Photo.create({
                title: photo_title,
                description,
                category_id,
                sub_category_id: sub_category_id || null,
                price: price || 0,
                photography_time: photography_time ? new Date(photography_time) : new Date(),
                event_name,
                author,
                photo_credit_id,
                country_id: country_id || null,
                state_id: state_id || null,
                city_id: city_id || null,
                source,
                max_downloads: max_downloads || 0,
                status: status || 1,
                image_url: finalImageUrl,
                user_id: userId,
                exif_data: exif_data ? JSON.parse(exif_data) : null
            });

            // Handle tags if any
            if (tag_ids.length > 0) {
                // Assuming you have a many-to-many relationship with tags
                await photo.setTags(tag_ids);
            }

            return res.json({
                status: 'success',
                message: 'Photo uploaded successfully',
                data: {
                    id: photo.id,
                    title: photo.title,
                    image_url: photo.image_url
                }
            });

        } catch (error) {
            console.error('Upload error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to upload photo',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);*/


// Update Photo
app.put('/api/photos/update/:photoId', async (req, res) => {
  const userId = req.user.id;
  const photoId = parseInt(req.params.photoId);

  try {
    const {
      photo_title,
      description,
      category_id,
      sub_category_id,
      price,
      photography_time,
      event_name,
      tag_ids = []
    } = req.body;

    const files = req.files?.files
      ? (Array.isArray(req.files.files) ? req.files.files : [req.files.files])
      : [];

    const result = await Prisma.$transaction(async (tx) => {

      /** 1️⃣ Ensure photo exists */
      const photoExists = await tx.pam_photos.findUnique({
        where: { photo_id: photoId }
      });

      if (!photoExists) {
        throw new Error('PHOTO_NOT_FOUND');
      }

      /** 2️⃣ Update pam_photos */
      const updatedPhoto = await tx.pam_photos.update({
        where: { photo_id: photoId },
        data: {
          photo_title,
          description,
          category_id: category_id ? parseInt(category_id) : undefined,
          sub_category_id: sub_category_id ? parseInt(sub_category_id) : undefined,
          price: price ? parseFloat(price) : undefined,
          photography_time: photography_time
            ? new Date(photography_time)
            : undefined,
          event_name,
          updated_by: userId,
          updated_on: new Date()
        }
      });

      /** 3️⃣ Upload NEW files */
      const uploadedFiles = [];

      for (const file of files) {
        const allowedTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'image/gif'
        ];

        if (!allowedTypes.includes(file.mimetype)) continue;

        const fileName = `${Date.now()}_${file.name}`;
        const uploadDir = path.join(__dirname, 'uploads', 'photos', String(photoId));

        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        await file.mv(path.join(uploadDir, fileName));

        const fileRow = await tx.pam_photos_files.create({
          data: {
            photo_id: photoId,
            dir_path: `/uploads/photos/${photoId}`,
            Image_Name: fileName,
            raw_name: file.name,
            original_image_name: file.name,
            file_ext: path.extname(file.name).replace('.', ''),
            file_size: String(file.size),
            source: 'upload',
            reference: '',
            date_created: new Date(),
            updated_by: userId.toString(),
            enter_by: userId.toString(),
            is_trash: 'N'
          }
        });

        uploadedFiles.push(fileRow);
      }

      /** 4️⃣ Replace tags */
      if (Array.isArray(tag_ids)) {
        await tx.pam_photo_tags.deleteMany({
          where: { photo_id: photoId }
        });

        if (tag_ids.length > 0) {
          await tx.pam_photo_tags.createMany({
            data: tag_ids.map(tagId => ({
              photo_id: photoId,
              tag_id: parseInt(tagId)
            }))
          });
        }
      }

      return {
        updatedPhoto,
        uploadedFilesCount: uploadedFiles.length,
        tagsCount: tag_ids.length
      };
    });

    res.json({
      status: 'success',
      message: 'Photo updated successfully',
      data: result
    });

  } catch (err) {
    console.error('Update photo error:', err);

    if (err.message === 'PHOTO_NOT_FOUND') {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found'
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Update failed. All changes rolled back.'
    });
  }
});
/**
 * GET /api/photos/tags
 * Query parameters:
 * - q: search query (optional)
 * - page: page number (optional, default: 1)
 * - limit: items per page (optional, default: 10)
 * - sort: sort field (optional, default: created_at)
 * - order: sort order (optional, default: desc)
 */
app.get('/api/photos/tags', async (req, res) => {
  try {
    const {
      q = '',
      page = 1,
      limit = 10,
      sort = 'created_at',
      order = 'desc'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {
      is_trash: 'N'
    };

    if (q) {
      where.photo_tag = {
        contains: q,
        mode: 'insensitive'
      };
    }

    // Get total count
    const total = await Prisma.pam_photo_tags_list.count({
      where
    });

    // Get tags
    const tags = await Prisma.pam_photo_tags_list.findMany({
      where,
      select: {
        tag_id: true,
        photo_tag: true,
        photo_slug: true,
        tag_description: true,
        created_at: true,
        updated_at: true
      },
      orderBy: {
        [sort]: order
      },
      skip: offset,
      take: limitNum
    });

    // Format response
    const formattedTags = tags.map(tag => ({
      tag_id: tag.tag_id.toString(),
      photo_tag: tag.photo_tag,
      photo_slug: tag.photo_slug,
      name: tag.photo_tag, // For compatibility with existing code
      description: tag.tag_description,
      created_at: tag.created_at,
      updated_at: tag.updated_at
    }));

    res.json({
      status: 'success',
      message: 'Tags fetched successfully',
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      results: formattedTags
    });

  } catch (err) {
    console.error('Get tags error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch tags'
    });
  }
});

// Update photo details
app.put('/api/photos/:photoId', async (req, res) => {
  try {
    const { photoId } = req.params;
    const userId = req.user.id;
    const {
      photo_title,
      description,
      category_id,
      sub_category_id,
      price,
      event_name
    } = req.body;

    // Check if photo exists and user owns it
    const photo = await Prisma.pam_photos.findFirst({
      where: {
        photo_id: BigInt(photoId),
        author_id: userId
      }
    });

    if (!photo) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found or access denied'
      });
    }

    const updatedPhoto = await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        photo_title: photo_title || photo.photo_title,
        description: description !== undefined ? description : photo.description,
        category_id: category_id ? parseInt(category_id) : photo.category_id,
        sub_category_id: sub_category_id ? parseInt(sub_category_id) : photo.sub_category_id,
        price: price !== undefined ? parseFloat(price) : photo.price,
        event_name: event_name || photo.event_name,
        updated_at: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Photo updated successfully',
      data: updatedPhoto
    });
  } catch (err) {
    console.error('Update photo error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update photo'
    });
  }
});

// Delete photo (soft delete)
app.delete('/api/photos/:photoId', async (req, res) => {
  try {
    const { photoId } = req.params;
    const userId = req.user.id;

    const photo = await Prisma.pam_photos.findFirst({
      where: {
        photo_id: BigInt(photoId),
        author_id: userId
      }
    });

    if (!photo) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found or access denied'
      });
    }

    // Soft delete
    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        is_trash: 1,
        updated_at: new Date()
      }
    });

    // Also mark all files as trash
    await Prisma.pam_photos_files.updateMany({
      where: { photo_id: parseInt(photoId) },
      data: {
        is_trash: 'Y',
        updated_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Photo moved to trash successfully'
    });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete photo'
    });
  }
});

// Restore photo from trash
app.post('/api/photos/:photoId/restore', async (req, res) => {
  try {
    const { photoId } = req.params;
    const userId = req.user.id;

    const photo = await Prisma.pam_photos.findFirst({
      where: {
        photo_id: BigInt(photoId),
        author_id: userId,
        is_trash: 1
      }
    });

    if (!photo) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found in trash or access denied'
      });
    }

    await Prisma.pam_photos.update({
      where: { photo_id: BigInt(photoId) },
      data: {
        is_trash: 0,
        updated_at: new Date()
      }
    });

    // Restore all files
    await Prisma.pam_photos_files.updateMany({
      where: { photo_id: parseInt(photoId) },
      data: {
        is_trash: 'N',
        updated_on: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Photo restored from trash successfully'
    });
  } catch (err) {
    console.error('Restore photo error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to restore photo'
    });
  }
});

// Get photo statistics
app.get('/api/photos/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    const [
      totalPhotos,
      activePhotos,
      trashPhotos,
      photosByCategory,
      recentUploads
    ] = await Promise.all([
      // Total photos
      Prisma.pam_photos.count({
        where: { author_id: userId }
      }),

      // Active photos
      Prisma.pam_photos.count({
        where: {
          author_id: userId,
          is_trash: 0,
          is_active: 1
        }
      }),

      // Photos in trash
      Prisma.pam_photos.count({
        where: {
          author_id: userId,
          is_trash: 1
        }
      }),

      // Photos by category
      Prisma.pam_photos.groupBy({
        by: ['category_id'],
        where: {
          author_id: userId,
          is_trash: 0
        },
        _count: { category_id: true }
      }),

      // Recent uploads
      Prisma.pam_photos.findMany({
        where: {
          author_id: userId,
          is_trash: 0
        },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          photo_id: true,
          photo_title: true,
          created_at: true
        }
      })
    ]);

    res.json({
      status: 'success',
      data: {
        total_photos: totalPhotos,
        active_photos: activePhotos,
        trash_photos: trashPhotos,
        photos_by_category: photosByCategory,
        recent_uploads: recentUploads
      }
    });
  } catch (err) {
    console.error('Get photo stats error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch photo statistics'
    });
  }
});
// -------------------------  Upload new photo -------------------------


// Export/Import APIs

// Export user data
app.get('/api/user/export-data', async (req, res) => {
  try {
    const userId = req.user.id;

    const [userData, userPhotos, userActivities] = await Promise.all([
      // User profile data
      Prisma.pam_users.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          email: true,
          mobile_no: true,
          address: true,
          created_at: true,
          updated_at: true
        }
      }),

      // User photos
      Prisma.pam_photos.findMany({
        where: { author_id: userId },
        select: {
          photo_id: true,
          photo_title: true,
          description: true,
          category_id: true,
          created_at: true,
          updated_at: true
        }
      }),

      // User activities
      Prisma.pam_activities.findMany({
        where: { user_id: userId },
        select: {
          activity_type: true,
          module: true,
          action: true,
          created_at: true,
          status: true
        }
      })
    ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      user: userData,
      photos: userPhotos,
      activities: userActivities
    };

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="user-data-${userId}-${Date.now()}.json"`);

    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error('Export data error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to export data'
    });
  }
});

// Export photos metadata
app.get('/api/photos/export-metadata', async (req, res) => {
  try {
    const userId = req.user.id;
    const { format = 'json' } = req.query;

    const photos = await Prisma.pam_photos.findMany({
      where: { author_id: userId },
      include: {
        pam_photos_files: {
          where: { is_trash: 'N' },
          select: {
            file_id: true,
            Image_Name: true,
            file_size: true,
            file_ext: true
          }
        }
      }
    });

    if (format === 'csv') {
      // Convert to CSV
      const csvData = photos.map(photo => ({
        ID: photo.photo_id,
        Title: photo.photo_title,
        Description: photo.description,
        Category: photo.category_id,
        Files: photo.pam_photos_files.length,
        Created: photo.created_at
      }));

      // Convert to CSV string (simplified)
      const csvString = [
        Object.keys(csvData[0]).join(','),
        ...csvData.map(row => Object.values(row).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="photos-metadata-${Date.now()}.csv"`);
      res.send(csvString);
    } else {
      // Default to JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="photos-metadata-${Date.now()}.json"`);
      res.send(JSON.stringify(photos, null, 2));
    }
  } catch (err) {
    console.error('Export metadata error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to export metadata'
    });
  }
});
// TOGGAL-STATUS (PHOTO)
app.patch('/api/photos/:id/toggle-status', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const photoId = parseInt(id);
    if (isNaN(photoId) || photoId <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid photo ID',
      });
    }
    const photo = await Prisma.pam_photos.findUnique({
      where: { photo_id: photoId },
      select: { photo_id: true, is_active: true },
    });
    if (!photo) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found',
      });
    }
    const newStatus = photo.is_active === 1 ? 0 : 1;
    const updatedPhoto = await Prisma.pam_photos.update({
      where: { photo_id: photoId },
      data: {
        is_active: newStatus,
        updated_on: new Date(),
        updated_by: req.admin?.admin_id || null,
      },
    });

    // Log activity
    if (req.admin) {
      await Prisma.pam_activities.create({
        data: {
          user_id: req.admin.admin_id,
          activity_type: 'photo_status_toggle',
          message: `Changed photo ${photoId} status to ${newStatus === 1 ? 'active' : 'inactive'}`,
          ip_address: req.ip || 'unknown',
          user_agent: req.headers['user-agent'] || 'unknown',
          module: 'photo', 'action': 'toggle-status', activity_code: 'T202', request_method: 'patch', old_data: photo.is_active, new_data: newStatus
        },
      });
    }

    res.json(serializeBigInt({
      status: 'success',
      message: `Photo ${newStatus === 1 ? 'activated' : 'deactivated'} successfully`,
      data: {
        photo_id: updatedPhoto.photo_id,
        status: updatedPhoto.status,
        updated_at: updatedPhoto.updated_at,
      },
    }));

  } catch (err) {
    console.error('Toggle Photo status error:', err);
    // Prisma specific error handling
    if (err.name === 'PrismaClientKnownRequestError') {
      switch (err.code) {
        case 'P2025':
          return res.status(404).json({
            status: 'error',
            message: 'Photo not found',
          });
        case 'P2002':
          return res.status(400).json({
            status: 'error',
            message: 'Duplicate entry',
          });
        case 'P2003':
          return res.status(400).json({
            status: 'error',
            message: 'Foreign key constraint failed',
          });
      }
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to toggle photo status',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});
//verifyAdmin,
app.get('/api/edit-photos/:id', verifyAdmin, async (req, res) => { // pam_countries
  try {
    const photoId = parseInt(req.params.id);

    if (!photoId || isNaN(photoId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid photo ID'
      });
    }

    // Get photo basic data
    const photo = await Prisma.pam_photos.findUnique({
      where: {
        photo_id: photoId,
        is_trash: 0
      },
      include: {
        category: {
          select: {
            category_id: true,
            name: true,
            slug: true,
            status: true
          }
        },
        sub_category: {
          select: {
            sub_category_id: true,
            name: true,
            slug: true,
            status: true
          }
        },
        country: {
          select: {
            id: true,
            name: true, 
          }
        },
        state: {
          select: {
            id: true,
            name: true,
            status: true
          }
        },
        city: {
          select: {
            id: true,
            name: true,
            status: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            firstname: true,
            lastname: true,
            email: true
          }
        }
      }
    });

    if (!photo) {
      return res.status(404).json({
        status: 'error',
        message: 'Photo not found'
      });
    }

    // Get files SEPARATELY - using the same photoId
    const files = await Prisma.pam_photos_files.findMany({
      where: {
        photo_id: photoId, // This should match the type in database
        is_trash: 'N'
      },
      orderBy: {
        file_id: 'asc'
      }
    });

    // console.log('Files found:', files.length);
    
    // Get tags separately
    // const tags = await Prisma.pam_photo_tags.findMany({
    //   where: {
    //     photo_id: photoId
    //   },
    //   include: {
    //     tag: {
    //       select: {
    //         tag_id: true,
    //         photo_tag: true,
    //         photo_slug: true
    //       }
    //     }
    //   }
    // });

    // Process files
    const processedFiles = files.map(file => {
      let orientation = file.orientation || 'unknown';

      if ((!orientation || orientation === 'unknown') && file.Width && file.Height) {
        const width = file.Width || 0;
        const height = file.Height || 0;
        if (width > 0 && height > 0) {
          const ratio = width / height;
          if (ratio > 1.1) orientation = 'horizontal';
          else if (ratio < 0.9) orientation = 'vertical';
          else orientation = 'square';
        }
      }

      return {
        file_id: file.file_id.toString(),
        photo_id: file.photo_id.toString(),
        dir_path: file.dir_path,
        Image_Name: file.Image_Name,
        original_image_name: file.original_image_name,
        file_ext: file.file_ext,
        file_size: file.file_size,
        width: file.Width,
        height: file.Height,
        orientation: orientation,
        type: file.type,
        source: file.source,
        reference: file.reference,
        is_trash: file.is_trash,
        is_migrated: file.isMigrat === 1,
        migrated_file_path: file.migratedFilePath,
        migrated_file_name: file.migratedFileName,
        created_at: file.date_created,
        updated_at: file.updated_on,
        enter_by: file.enter_by,
        updated_by: file.updated_by,
        image_url: file.dir_path && file.Image_Name 
          ? `${file.dir_path}/${file.Image_Name}` 
          : null,
        thumbnail_url: file.dir_path && file.Image_Name
          ? `${file.dir_path}/${file.Image_Name}`
          : null
      };
    });

    // Prepare response
    const response = {
      status: 'success',
      data: {
        // Photo data
        id: photo.photo_id,
        photo_id: photo.photo_id,
        photo_title: photo.photo_title || '',
        event_name: photo.event_name || '',
        description: photo.description || '',
        source_name: photo.source_name || '',
        credit: photo.credit || 0,
        other_credit: photo.other_credit || '',
        max_download: photo.max_download || 0,
        download: photo.download || 0,
        price: photo.price || 0,
        media_type: photo.media_type || '',
        photography_time: photo.photography_time,
        entered_on: photo.entered_on,
        updated_on: photo.updated_on,
        enter_by: photo.enter_by || 0,
        updated_by: photo.updated_by || 0,
        author_id: photo.author_id || 0,
        category_id: photo.category_id || 0,
        sub_category_id: photo.sub_category_id || 0,
        country_id: photo.country_id || 0,
        state_id: photo.state_id || 0,
        city_id: photo.city_id || 0,
        
        // Related data
        category: photo.category,
        sub_category: photo.sub_category,
        country: photo.country,
        state: photo.state,
        city: photo.city,
        author: photo.user,
        
        // Status
        is_active: photo.is_active === 1,
        is_trash: photo.is_trash === 1,
        status: photo.is_active,
        
        // Files and tags
        files: processedFiles,
        total_files: processedFiles.length,
        cover_image: processedFiles[0] || null,
        image_url: processedFiles[0]?.image_url || null,
        
        // tags: tags.map(pt => ({
        //   id: pt.tag?.tag_id?.toString() || '',
        //   tag_id: pt.tag?.tag_id?.toString() || '',
        //   name: pt.tag?.photo_tag || '',
        //   slug: pt.tag?.photo_slug || ''
        // })),
        
        // Form data
        form_data: {
          title: photo.photo_title || '',
          event_name: photo.event_name || '',
          description: photo.description || '',
          author: photo.user ? `${photo.user.firstname || ''} ${photo.user.lastname || ''}`.trim() : '',
          photo_credit_id: photo.author_id?.toString() || '',
          category_id: photo.category_id?.toString() || '',
          sub_category_id: photo.sub_category_id?.toString() || '',
          country_id: photo.country_id?.toString() || '',
          state_id: photo.state_id?.toString() || '',
          city_id: photo.city_id?.toString() || '',
          source: photo.source_name || '',
          max_downloads: photo.max_download || 0,
          //tags: tags.map(pt => pt.tag?.photo_tag || '').filter(tag => tag),
          image_url: processedFiles[0]?.image_url || '',
          status: photo.is_active,
          photography_time: photo.photography_time ? 
            new Date(photo.photography_time).toISOString().split('T')[0] + "T00:00" : 
            new Date().toISOString().split('T')[0] + "T00:00"
        }
      }
    };

    res.json(serializeBigInt(response));

  } catch (error) {
    console.error('Error fetching photo details:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch photo details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/photos/set-cover-image/:id', verifyAdmin, async (req, res) => {
    try {
        const { id: photoId } = req.params;
        const { file_id } = req.body;
        const adminId = req.admin.admin_id;
        
        // Validate input
        if (!file_id) {
            return res.status(400).json({
                status: "error",
                message: "File ID is required"
            });
        }

        // Start a transaction
        const result = await Prisma.$transaction(async (tx) => {
            // 1. Verify the photo exists
            const photo = await tx.pam_photos.findUnique({
                where: { photo_id: BigInt(photoId) }
            });

            if (!photo) {
                throw new Error("Photo not found");
            }

            // 2. Verify the file exists and belongs to this photo
            const file = await tx.pam_photos_files.findFirst({
                where: {
                    file_id: BigInt(file_id),
                    photo_id: BigInt(photoId),
                    is_trash: "N" // Only consider non-trashed files
                }
            });

            if (!file) {
                throw new Error("File not found or doesn't belong to this photo");
            }

            // 3. Reset all files' is_cover to false for this photo
            await tx.pam_photos_files.updateMany({
                where: {
                    photo_id: BigInt(photoId),
                    is_cover: true
                },
                data: {
                    is_cover: false,
                    updated_by: adminId.toString(),
                    updated_on: new Date()
                }
            });

            // 4. Set the selected file as cover
            const updatedFile = await tx.pam_photos_files.update({
                where: { file_id: BigInt(file_id) },
                data: {
                    is_cover: true,
                    updated_by: adminId.toString(),
                    updated_on: new Date()
                }
            });

            // 5. Update the photo record
            const updatedPhoto = await tx.pam_photos.update({
                where: { photo_id: BigInt(photoId) },
                data: {
                    // Optionally update photo_title with cover image name
                    photo_title: file.Image_Name || file.original_image_name || photo.photo_title,
                    updated_by: adminId,
                    updated_on: new Date()
                }
            });

            return { updatedFile, updatedPhoto };
        });

        res.json({
            status: "success",
            message: "Cover image updated successfully",
            data: {
                photo_id: photoId,
                file_id: file_id,
                is_cover: true,
                image_url: result.updatedFile.Image_Name || result.updatedFile.original_image_name
            }
        });

    } catch (error) {
        console.error("Set cover image error:", error);
        
        if (error.message.includes("not found")) {
            return res.status(404).json({
                status: "error",
                message: error.message
            });
        }

        res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: error.message
        });
    }
});








// ------------------------- Dashboard APIs -------------------------
// Admin dashboard statistics
app.get('/api/admin/dashboard/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalPhotos,
      activePhotos,
      totalCategories,
      totalSubcategories,
      recentUsers,
      recentActivities
    ] = await Promise.all([
      // Total users
      Prisma.pam_users.count(),

      // Active users
      Prisma.pam_users.count({
        where: { is_active: 1 }
      }),

      // Total photos
      Prisma.pam_photos.count({
        where: { is_trash: 0 }
      }),

      // Active photos
      Prisma.pam_photos.count({
        where: {
          is_trash: 0,
          is_active: 1
        }
      }),

      // Total categories
      Prisma.pam_category.count({
        where: { status: 1 }
      }),

      // Total subcategories
      Prisma.pam_sub_category.count({
        where: { status: 1 }
      }),

      // Recent users (last 7 days)
      Prisma.pam_users.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          id: true,
          username: true,
          email: true,
          created_at: true
        }
      }),

      // Recent activities
      Prisma.pam_activities.findMany({
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          user_name: true,
          activity_type: true,
          module: true,
          created_at: true,
          status: true
        }
      })
    ]);

    res.json({
      status: 'success',
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          recent: recentUsers
        },
        photos: {
          total: totalPhotos,
          active: activePhotos
        },
        categories: {
          total: totalCategories,
          subcategories: totalSubcategories
        },
        recent_activities: recentActivities
      }
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch dashboard statistics'
    });
  }
});
// ------------------------- Dashboard APIs -------------------------


// ------------------------- Search APIs -------------------------
//
// Global search
//
app.get('/api/search', async (req, res) => {
  try {
    const { q = '', type = 'all', limit = 20 } = req.query;

    if (!q || q.trim() === '') {
      return res.json({
        status: 'success',
        data: {
          users: [],
          photos: [],
          categories: []
        }
      });
    }

    const searchTerm = q.trim();
    const results = {};

    if (type === 'all' || type === 'users') {
      results.users = await Prisma.pam_users.findMany({
        where: {
          OR: [
            { username: { contains: searchTerm } },
            { email: { contains: searchTerm } },
            { firstname: { contains: searchTerm } },
            { lastname: { contains: searchTerm } }
          ],
          is_active: 1
        },
        take: parseInt(limit),
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          email: true,
          photo: true
        }
      });
    }

    if (type === 'all' || type === 'photos') {
      results.photos = await Prisma.pam_photos.findMany({
        where: {
          OR: [
            { photo_title: { contains: searchTerm } },
            { description: { contains: searchTerm } },
            { event_name: { contains: searchTerm } }
          ],
          is_trash: 0,
          is_active: 1
        },
        take: parseInt(limit),
        select: {
          photo_id: true,
          photo_title: true,
          description: true,
          category_id: true
        }
      });
    }

    if (type === 'all' || type === 'categories') {
      results.categories = await Prisma.pam_category.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm } },
            { slug: { contains: searchTerm } }
          ],
          status: 1
        },
        take: parseInt(limit),
        select: {
          category_id: true,
          name: true,
          slug: true
        }
      });
    }

    res.json({
      status: 'success',
      data: results
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Search failed'
    });
  }
});

// Advanced photo search
app.get('/api/search/photos/advanced', async (req, res) => {
  try {
    const {
      q = '',
      category_id,
      sub_category_id,
      author_id,
      min_price,
      max_price,
      start_date,
      end_date,
      sort_by = 'created_at',
      sort_order = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {
      is_trash: 0,
      is_active: 1
    };

    // Text search
    if (q && q.trim() !== '') {
      const searchTerm = q.trim();
      where.OR = [
        { photo_title: { contains: searchTerm } },
        { description: { contains: searchTerm } },
        { event_name: { contains: searchTerm } }
      ];
    }

    // Category filter
    if (category_id && !isNaN(parseInt(category_id))) {
      where.category_id = parseInt(category_id);
    }

    // Sub-category filter
    if (sub_category_id && !isNaN(parseInt(sub_category_id))) {
      where.sub_category_id = parseInt(sub_category_id);
    }

    // Author filter
    if (author_id && !isNaN(parseInt(author_id))) {
      where.author_id = parseInt(author_id);
    }

    // Price range filter
    if (min_price || max_price) {
      where.price = {};
      if (min_price && !isNaN(parseFloat(min_price))) {
        where.price.gte = parseFloat(min_price);
      }
      if (max_price && !isNaN(parseFloat(max_price))) {
        where.price.lte = parseFloat(max_price);
      }
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
    const total = await Prisma.pam_photos.count({ where });

    // Get photos
    const photos = await Prisma.pam_photos.findMany({
      where,
      include: {
        pam_photos_files: {
          where: { is_trash: 'N' },
          take: 1,
          select: {
            file_id: true,
            dir_path: true,
            Image_Name: true
          }
        }
      },
      orderBy: { [sort_by]: sort_order },
      skip,
      take: limitNum
    });

    res.json({
      status: 'success',
      data: photos,
      pagination: {
        current_page: pageNum,
        total_pages: Math.ceil(total / limitNum),
        total_items: total,
        items_per_page: limitNum
      }
    });
  } catch (err) {
    console.error('Advanced photo search error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Search failed'
    });
  }
});

//
// ------------------------- Search APIs -------------------------
//


// ------------------------- User Management APIs -------------------------
//
// Get user profile by token
app.get('/api/user/profile', async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await Prisma.pam_users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true,
        role: true,
        is_active: true,
        is_verify: true,
        created_at: true
      }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.json({
      status: 'success',
      data: user
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch profile'
    });
  }
});

// Update user profile
app.put('/api/user/profile/update', async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstname, lastname, mobile_no, address } = req.body;

    const updatedUser = await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        firstname,
        lastname,
        mobile_no,
        address,
        updated_at: new Date()
      },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        email: true,
        mobile_no: true,
        address: true,
        photo: true
      }
    });

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
      data: updatedUser
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update profile'
    });
  }
});

// Change password
app.post('/api/user/change-password', async (req, res) => {
  try {
    const userId = req.user.id;
    const { current_password, new_password } = req.body;

    // Validate input
    if (!current_password || !new_password) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password and new password are required'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'New password must be at least 6 characters'
      });
    }

    // Get user with password
    const user = await Prisma.pam_users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await Prisma.pam_users.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        updated_at: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Password changed successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to change password'
    });
  }
});

// Forgot password request
app.post('/api/user/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }

    const user = await Prisma.pam_users.findFirst({
      where: { email }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User with this email not found'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    // Save reset token
    await Prisma.pam_users.update({
      where: { id: user.id },
      data: {
        password_reset_code: resetToken,
        reset_token_expiry: resetTokenExpiry
      }
    });

    // TODO: Send email with reset link
    // const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    res.json({
      status: 'success',
      message: 'Password reset instructions sent to your email'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process forgot password request'
    });
  }
});

// Reset password
app.post('/api/user/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({
        status: 'error',
        message: 'Token and new password are required'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'Password must be at least 6 characters'
      });
    }

    const user = await Prisma.pam_users.findFirst({
      where: {
        password_reset_code: token,
        reset_token_expiry: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password and clear reset token
    await Prisma.pam_users.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        password_reset_code: null,
        reset_token_expiry: null,
        updated_at: new Date()
      }
    });

    res.json({
      status: 'success',
      message: 'Password reset successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to reset password'
    });
  }
});

//
// ------------------------- User Management APIs -------------------------






app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: 'error',
        message: 'File too large. Maximum size is 10MB'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        status: 'error',
        message: 'Too many files. Maximum is 10'
      });
    }
    return res.status(400).json({
      status: 'error',
      message: `Multer error: ${err.message}`
    });
  }

  if (err.message.includes('Unexpected end of form')) {
    return res.status(400).json({
      status: 'error',
      message: 'Incomplete form data. Please check your network connection.'
    });
  }

  console.error('Server error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});

// verifyAdmin
app.get('/api/admin/settings', async (req, res) => {
  try {
    // Check if settings exist in database
    const settings = await Prisma.ci_settings.findFirst({
      where: { setting_key: 'general_settings' }
    });

    let settingsData = {};

    if (settings) {
      // Parse existing settings
      try {
        settingsData = JSON.parse(settings.setting_value);
      } catch (parseError) {
        console.error('Error parsing settings:', parseError);
      }
    } else {
      // Create default settings if not exists
      const defaultSettings = {
        // General Settings
        site_name: "Outlook India Admin",
        site_url: "https://admin.outlookindia.com",
        admin_email: "admin@outlookindia.com",
        support_email: "support@outlookindia.com",
        timezone: "Asia/Kolkata",
        date_format: "DD/MM/YYYY",
        language: "en",

        // Email Settings
        smtp_host: "smtp.gmail.com",
        smtp_port: "587",
        smtp_username: "",
        smtp_password: "",
        smtp_encryption: "tls",

        // Security Settings
        login_attempts: 5,
        session_timeout: 30,
        two_factor_auth: false,
        password_expiry: 90,
        ip_whitelist: "",

        // Notification Settings
        email_notifications: true,
        push_notifications: false,
        admin_notifications: true,
        user_notifications: true,

        // File Upload Settings
        max_upload_size: 10,
        allowed_file_types: "jpg,jpeg,png,gif,pdf,doc,docx",
        image_quality: 85,
        enable_cdn: false,

        // Maintenance
        maintenance_mode: false,
        maintenance_message: "Site is under maintenance. Please check back later.",
      };

      // Save default settings to database
      await Prisma.ci_settings.create({
        data: {
          setting_key: 'general_settings',
          setting_value: JSON.stringify(defaultSettings),
          created_by: 25, //req.admin.admin_id,
          updated_by: 25, //req.admin.admin_id,
        }
      });

      settingsData = defaultSettings;
    }

    res.json({
      status: 'success',
      message: 'Settings retrieved successfully',
      settings: settingsData
    });

  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch settings'
    });
  }
});
app.put('/api/admin/settings/update', async (req, res) => {
  try {
    const settingsData = req.body;

    // Validate required fields
    if (!settingsData.site_name || !settingsData.site_url || !settingsData.admin_email) {
      return res.status(400).json({
        status: 'error',
        message: 'Site name, URL, and admin email are required'
      });
    }

    // Validate email settings if provided
    if (settingsData.smtp_host) {
      if (!settingsData.smtp_port || !settingsData.smtp_username) {
        return res.status(400).json({
          status: 'error',
          message: 'SMTP port and username are required when SMTP host is provided'
        });
      }
    }

    // Check if settings exist
    const existingSettings = await Prisma.ci_settings.findFirst({
      where: { setting_key: 'general_settings' }
    });

    if (existingSettings) {
      // Update existing settings
      await Prisma.ci_settings.update({
        where: { setting_id: existingSettings.setting_id },
        data: {
          setting_value: JSON.stringify(settingsData),
          updated_by: 25,//    25, //req.admin.admin_id,
          updated_at: new Date()
        }
      });
    } else {
      // Create new settings entry
      await Prisma.ci_settings.create({
        data: {
          setting_key: 'general_settings',
          setting_value: JSON.stringify(settingsData),
          created_by: 25, //req.admin.admin_id,
          updated_by: 25, //req.admin.admin_id,
        }
      });
    }

    // Log the settings update
    // await Prisma.ci_activity.create({
    //   data: {
    //     admin_id: 25, //req.admin.admin_id,
    //     activity_type: 'settings_update',
    //     description: 'Updated system settings',
    //     ip_address: req.ip || 'unknown',
    //     user_agent: req.headers['user-agent'] || 'unknown'
    //   }
    // });

    res.json({
      status: 'success',
      message: 'Settings updated successfully'
    });

  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update settings'
    });
  }
});
app.post('/api/admin/settings/test-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email address is required'
      });
    }

    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid email address format'
      });
    }

    // Get current SMTP settings
    const settingsRecord = await Prisma.ci_settings.findFirst({
      where: { setting_key: 'general_settings' }
    });

    if (!settingsRecord) {
      return res.status(400).json({
        status: 'error',
        message: 'Email settings not configured. Please save settings first.'
      });
    }

    const settings = JSON.parse(settingsRecord.setting_value);
    const { smtp_host, smtp_port, smtp_username, smtp_password, smtp_encryption } = settings;

    // Check if SMTP is configured
    if (!smtp_host || !smtp_port || !smtp_username) {
      return res.status(400).json({
        status: 'error',
        message: 'SMTP settings not configured. Please configure email settings first.'
      });
    }

    // Here you would implement actual email sending logic
    // This is a placeholder - implement with nodemailer or your email service

    // Simulate email sending (replace with actual implementation)
    console.log('Test email details:', {
      to: email,
      smtp_host,
      smtp_port,
      smtp_username,
      smtp_encryption,
      timestamp: new Date().toISOString()
    });

    // Log the test email attempt
    await Prisma.ci_activity.create({
      data: {
        admin_id: 25, //req.admin.admin_id,
        activity_type: 'email_test',
        description: `Sent test email to ${email}`,
        ip_address: req.ip || 'unknown',
        user_agent: req.headers['user-agent'] || 'unknown'
      }
    });

    // Return success response
    res.json({
      status: 'success',
      message: `Test email sent successfully to ${email}. Please check your inbox.`
    });

  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send test email. Please check your SMTP configuration.'
    });
  }
});


app.listen(8011, () => console.log("Listening on port 8011"));

// const PORT = 4600;
// const HOST = '0.0.0.0';

// app.listen(PORT, HOST, () => {
//   console.log(`Server running on http://192.168.0.186:${PORT}`);
// });
