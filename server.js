// Anjani Bags - catalogue server with admin uploads.
// Runs locally with `npm start`, and on Vercel as a serverless Express app.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const store = require('./storage');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'anjani@123';
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const SESSION_DAYS = 7;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

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

const getProducts = () => store.read('products', []);
const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await store.read('settings', {})) });

// ---------- auth ----------
// Signed tokens (not kept in memory) so they work across Vercel's serverless instances.
const sign = data => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
function makeToken() {
  const expires = String(Date.now() + SESSION_DAYS * 864e5);
  return expires + '.' + sign(expires);
}
function validToken(token) {
  const [expires, mac] = String(token || '').split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const good = Buffer.from(sign(expires));
  const given = Buffer.from(mac);
  return good.length === given.length && crypto.timingSafeEqual(good, given);
}
const bearer = req => (req.headers.authorization || '').replace('Bearer ', '');
function requireAdmin(req, res, next) {
  if (!validToken(bearer(req))) return res.status(401).json({ error: 'Please log in again' });
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
    featured: body.featured === true || body.featured === 'true',
    photos: (Array.isArray(body.photos) ? body.photos : []).filter(store.isOwnPhoto).slice(0, 20)
  };
}

// async route helper so storage errors become JSON replies
const h = fn => (req, res, next) => fn(req, res, next).catch(next);

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(store.UPLOAD_DIR, { maxAge: '7d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/config', (req, res) => res.json({ uploadMode: store.CLOUD ? 'blob' : 'local' }));

app.post('/api/login', (req, res) => {
  const given = Buffer.from(String(req.body.password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token: makeToken() });
});

// --- photo uploads ---
// Local: the photo is sent to this server and saved in uploads/.
// destination is a function on purpose: given a string, multer creates the folder
// at startup, which crashes on Vercel's read-only disk.
const localUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + ext);
    }
  }),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (req, file, cb) => cb(null, IMAGE_TYPES.includes(file.mimetype))
});
app.post('/api/upload', requireAdmin, (req, res, next) => {
  if (store.CLOUD) return res.status(400).json({ error: 'Use cloud upload' });
  localUpload.single('photo')(req, res, err => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Only image files are allowed' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
});

// Vercel: the browser uploads straight to Vercel Blob; this only hands out a short-lived permission.
app.post('/api/blob-upload', h(async (req, res) => {
  const { handleUpload } = require('@vercel/blob/client');
  const result = await handleUpload({
    request: req,
    body: req.body,
    onBeforeGenerateToken: async () => {
      if (!validToken(bearer(req))) throw new Error('Please log in again');
      return { allowedContentTypes: IMAGE_TYPES, maximumSizeInBytes: MAX_PHOTO_BYTES, addRandomSuffix: true };
    }
  });
  res.json(result);
}));

// --- settings ---
app.get('/api/settings', h(async (req, res) => res.json(await getSettings())));
app.put('/api/settings', requireAdmin, h(async (req, res) => {
  const s = { ...(await getSettings()), ...req.body };
  if (!Array.isArray(s.categories)) s.categories = DEFAULT_SETTINGS.categories;
  await store.write('settings', s);
  res.json(s);
}));

// --- products ---
app.get('/api/products', h(async (req, res) => {
  let list = await getProducts();
  if (req.query.category) list = list.filter(p => p.category === req.query.category);
  res.json(list.sort((a, b) => b.createdAt - a.createdAt));
}));

app.get('/api/products/:id', h(async (req, res) => {
  const p = (await getProducts()).find(p => p.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
}));

app.post('/api/products', requireAdmin, h(async (req, res) => {
  const data = productFromBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'Bag name is required' });
  const product = { id: crypto.randomBytes(6).toString('hex'), ...data, createdAt: Date.now() };
  const list = await getProducts();
  list.push(product);
  await store.write('products', list);
  res.json(product);
}));

app.put('/api/products/:id', requireAdmin, h(async (req, res) => {
  const list = await getProducts();
  const idx = list.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const data = productFromBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'Bag name is required' });
  const old = list[idx];
  list[idx] = { ...old, ...data, updatedAt: Date.now() };
  await store.write('products', list);
  await Promise.all(old.photos.filter(u => !data.photos.includes(u)).map(store.removePhoto));
  res.json(list[idx]);
}));

app.delete('/api/products/:id', requireAdmin, h(async (req, res) => {
  const list = await getProducts();
  const p = list.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  await store.write('products', list.filter(x => x.id !== p.id));
  await Promise.all(p.photos.map(store.removePhoto));
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Anjani Bags running:  http://localhost:${PORT}`);
    console.log(`Admin panel:          http://localhost:${PORT}/admin`);
    console.log(`Storage:              ${store.CLOUD ? 'Vercel Blob + Upstash Redis' : 'local files (data/, uploads/)'}`);
  });
}
