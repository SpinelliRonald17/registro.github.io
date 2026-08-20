const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (PNG, JPG, WebP, GIF).'));
  },
});

function removeUpload(url) {
  if (!url) return;
  const rel = url.replace(/^\//, '');
  const file = path.join(__dirname, '..', 'public', rel);
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) fs.unlinkSync(file);
  } catch (err) {
    /* ignore */
  }
}

module.exports = { upload, removeUpload };
