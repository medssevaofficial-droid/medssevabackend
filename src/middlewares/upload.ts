import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx'];

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`INVALID_FILE_TYPE:Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX`));
  }
  cb(null, true);
};

export const prescriptionUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
}).single('file');

export const uploadToCloudinary = (buffer: Buffer, originalName: string, mimeType: string): Promise<{ secure_url: string; public_id: string }> => {
  return new Promise((resolve, reject) => {
    const ext = originalName.split('.').pop()?.toLowerCase() || 'bin';
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
    const resourceType = isImage ? 'image' : 'raw';

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'medseva/prescriptions',
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Cloudinary upload failed'));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

export { cloudinary };