// Where bags, settings and photos are kept.
//  - On your computer: JSON files in data/ and photos in uploads/
//  - On Vercel: Redis (bag details & settings) + Vercel Blob (photos),
//    because Vercel does not keep files written by the server.
const path = require('path');
const fs = require('fs');

// Vercel lets you give storage keys a custom prefix (e.g. STORAGE_KV_REST_API_URL),
// so match on the end of the name.
const findEnv = (...suffixes) => {
  for (const s of suffixes) {
    const key = Object.keys(process.env).find(k => k === s || k.endsWith('_' + s));
    if (key && process.env[key]) return process.env[key];
  }
};

// Upstash REST keys (Upstash for Redis), or a plain redis:// URL (the "Redis" integration)
const REST_URL = findEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL');
const REST_TOKEN = findEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');
const REDIS_URL = findEnv('REDIS_URL', 'KV_URL');
// older Blob stores give a read-write token; newer ones give a store id and sign in with Vercel OIDC
const BLOB_TOKEN = findEnv('BLOB_READ_WRITE_TOKEN');
const BLOB_STORE_ID = findEnv('BLOB_STORE_ID');
const HAS_BLOB = !!(BLOB_TOKEN || BLOB_STORE_ID);
const blobAuth = BLOB_TOKEN ? { token: BLOB_TOKEN } : BLOB_STORE_ID ? { storeId: BLOB_STORE_ID } : {};

const HAS_REDIS = !!((REST_URL && REST_TOKEN) || REDIS_URL);
const CLOUD = HAS_REDIS && HAS_BLOB;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

let db;
if (CLOUD && REST_URL && REST_TOKEN) {
  const { Redis } = require('@upstash/redis');
  const r = new Redis({ url: REST_URL, token: REST_TOKEN });
  db = { get: k => r.get(k), set: (k, v) => r.set(k, v) };
} else if (CLOUD) {
  const { createClient } = require('redis');
  const r = createClient({ url: REDIS_URL });
  r.on('error', err => console.error('Redis error:', err.message));
  const ready = r.connect();
  db = {
    get: async k => { await ready; const v = await r.get(k); return v == null ? null : JSON.parse(v); },
    set: async (k, v) => { await ready; return r.set(k, JSON.stringify(v)); }
  };
} else if (!process.env.VERCEL) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function notConnected() {
  const missing = [!HAS_BLOB && 'Vercel Blob', !HAS_REDIS && 'Upstash for Redis'].filter(Boolean).join(' and ');
  throw new Error(`Storage is not connected: ${missing} not found. In Vercel → Storage, connect it to this project, then redeploy.`);
}

async function read(key, fallback) {
  if (CLOUD) return (await db.get('anjani:' + key)) ?? fallback;
  if (process.env.VERCEL) notConnected();
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, key + '.json'), 'utf8')); } catch { return fallback; }
}

async function write(key, value) {
  if (CLOUD) return db.set('anjani:' + key, value);
  if (process.env.VERCEL) notConnected();
  const file = path.join(DATA_DIR, key + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// ---------- photos ----------
// Public Blob stores give a normal https link. Private stores can't be opened by
// visitors, so those photos are served through this site at /api/photo/<pathname>.
const PHOTO_ROUTE = '/api/photo/';
let blobAccess = process.env.BLOB_ACCESS || null; // 'public' | 'private', found on first upload

async function savePhoto(buffer, filename, contentType) {
  const ext = (path.extname(filename).toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const name = Date.now() + '-' + require('crypto').randomBytes(5).toString('hex') + ext;
  if (!CLOUD) {
    if (process.env.VERCEL) notConnected();
    await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer);
    return '/uploads/' + name;
  }
  const { put } = require('@vercel/blob');
  const upload = access => put('bags/' + name, buffer, { access, contentType, ...blobAuth });
  let blob;
  if (blobAccess) blob = await upload(blobAccess);
  else {
    try { blob = await upload('public'); blobAccess = 'public'; }
    catch (err) {
      // a private store refuses public uploads
      blob = await upload('private').catch(() => { throw err; });
      blobAccess = 'private';
    }
  }
  return blobAccess === 'private' ? PHOTO_ROUTE + blob.pathname : blob.url;
}

async function servePhoto(pathname, req, res) {
  const { get } = require('@vercel/blob');
  const result = await get(pathname, { access: 'private', ifNoneMatch: req.headers['if-none-match'], ...blobAuth });
  if (!result) return res.status(404).end();
  // file names are unique, so browsers and Vercel's CDN can keep them for a year
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (result.statusCode === 304) return res.status(304).end();
  res.set('Content-Type', result.blob.contentType);
  res.set('ETag', result.blob.etag);
  require('stream').Readable.fromWeb(result.stream).pipe(res);
}

// only accept photo URLs that we stored ourselves
function isOwnPhoto(url) {
  if (typeof url !== 'string') return false;
  if (!CLOUD) return /^\/uploads\/[\w.-]+$/.test(url);
  if (/^\/api\/photo\/bags\/[\w.-]+$/.test(url)) return true;
  try { return new URL(url).hostname.endsWith('.blob.vercel-storage.com'); } catch { return false; }
}

async function removePhoto(url) {
  try {
    if (!CLOUD) return await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url)));
    const target = url.startsWith(PHOTO_ROUTE) ? url.slice(PHOTO_ROUTE.length) : url;
    await require('@vercel/blob').del(target, blobAuth);
  } catch { /* already gone */ }
}

// which storage pieces were found (names only, never the secret values)
const status = () => ({
  blob: HAS_BLOB, blobAuth: BLOB_TOKEN ? 'token' : BLOB_STORE_ID ? 'oidc' : null, blobAccess,
  redis: HAS_REDIS, redisType: REST_URL ? 'upstash' : REDIS_URL ? 'redis-url' : null
});

module.exports = { CLOUD, UPLOAD_DIR, read, write, savePhoto, servePhoto, isOwnPhoto, removePhoto, status };
