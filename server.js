// Anjani Bags - simple catalogue server with admin uploads
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'anjani@123';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  phone: '+91 98765 43210',
  whatsapp: '919876543210',
  email: 'info@anjanibags.com',
  address: 'Surat, Gujarat, India',
  statDesigns: 500,
  statClients: 1000,
  statYears: 15,
  categories: ['Gold Bags', 'Grocery Bags', 'Business Bags', 'Jewellery Bags']
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const getProducts = () => readJson(PRODUCTS_FILE, []);
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) });

// ---------- uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp|gif|avif)$/.test(file.mimetype))
});

function removePhoto(url) {
  const file = path.join(UPLOAD_DIR, path.basename(url));
  fs.promises.unlink(file).catch(() => {});
}

// ---------- auth ----------
const tokens = new Set();
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tokens.has(token)) return res.status(401).json({ error: 'Please log in again' });
  next();
}

function productFromBody(body) {
  const num = v => (v === '' || v == null ? null : Number(v));
  return {
    name: String(body.name || '').trim(),
    category: String(body.category || '').trim(),
    description: String(body.description || '').trim(),
    gsm: String(body.gsm || '').trim(),
    size: String(body.size || '').trim(),
    mrp: num(body.mrp),
    price: num(body.price),
    unit: String(body.unit || 'piece').trim(),
    featured: body.featured === 'true' || body.featured === 'on'
  };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/settings', (req, res) => res.json(getSettings()));
app.put('/api/settings', requireAdmin, (req, res) => {
  const s = { ...getSettings(), ...req.body };
  if (!Array.isArray(s.categories)) s.categories = DEFAULT_SETTINGS.categories;
  writeJson(SETTINGS_FILE, s);
  res.json(s);
});

app.get('/api/products', (req, res) => {
  let list = getProducts();
  if (req.query.category) list = list.filter(p => p.category === req.query.category);
  res.json(list.sort((a, b) => b.createdAt - a.createdAt));
});

app.get('/api/products/:id', (req, res) => {
  const p = getProducts().find(p => p.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/login', (req, res) => {
  const given = Buffer.from(String(req.body.password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.add(token);
  res.json({ token });
});

app.post('/api/products', requireAdmin, upload.array('photos', 12), (req, res) => {
  const data = productFromBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'Bag name is required' });
  const product = {
    id: crypto.randomBytes(6).toString('hex'),
    ...data,
    photos: (req.files || []).map(f => '/uploads/' + f.filename),
    createdAt: Date.now()
  };
  const list = getProducts();
  list.push(product);
  writeJson(PRODUCTS_FILE, list);
  res.json(product);
});

app.put('/api/products/:id', requireAdmin, upload.array('photos', 12), (req, res) => {
  const list = getProducts();
  const idx = list.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const old = list[idx];
  let keep = old.photos;
  try { if (req.body.keepPhotos) keep = JSON.parse(req.body.keepPhotos); } catch {}
  keep = keep.filter(u => old.photos.includes(u));
  old.photos.filter(u => !keep.includes(u)).forEach(removePhoto);
  list[idx] = {
    ...old,
    ...productFromBody(req.body),
    photos: [...keep, ...(req.files || []).map(f => '/uploads/' + f.filename)],
    updatedAt: Date.now()
  };
  writeJson(PRODUCTS_FILE, list);
  res.json(list[idx]);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const list = getProducts();
  const p = list.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.photos.forEach(removePhoto);
  writeJson(PRODUCTS_FILE, list.filter(x => x.id !== p.id));
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Anjani Bags running:  http://localhost:${PORT}`);
  console.log(`Admin panel:          http://localhost:${PORT}/admin`);
});
