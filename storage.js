// Where bags, settings and photos are kept.
//  - On your computer: JSON files in data/ and photos in uploads/
//  - On Vercel: Upstash Redis (bag details & settings) + Vercel Blob (photos),
//    because Vercel does not keep files written by the server.
const path = require('path');
const fs = require('fs');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CLOUD = !!(REDIS_URL && REDIS_TOKEN && process.env.BLOB_READ_WRITE_TOKEN);

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

let redis;
if (CLOUD) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
} else if (!process.env.VERCEL) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function notConnected() {
  throw new Error('Storage is not connected. In Vercel, add Upstash Redis and Vercel Blob to this project, then redeploy.');
}

async function read(key, fallback) {
  if (CLOUD) return (await redis.get('anjani:' + key)) ?? fallback;
  if (process.env.VERCEL) notConnected();
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, key + '.json'), 'utf8')); } catch { return fallback; }
}

async function write(key, value) {
  if (CLOUD) return redis.set('anjani:' + key, value);
  if (process.env.VERCEL) notConnected();
  const file = path.join(DATA_DIR, key + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// only accept photo URLs that we stored ourselves
function isOwnPhoto(url) {
  if (typeof url !== 'string') return false;
  if (!CLOUD) return /^\/uploads\/[\w.-]+$/.test(url);
  try { return new URL(url).hostname.endsWith('.blob.vercel-storage.com'); } catch { return false; }
}

async function removePhoto(url) {
  try {
    if (CLOUD) await require('@vercel/blob').del(url);
    else await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url)));
  } catch { /* already gone */ }
}

module.exports = { CLOUD, UPLOAD_DIR, read, write, isOwnPhoto, removePhoto };
