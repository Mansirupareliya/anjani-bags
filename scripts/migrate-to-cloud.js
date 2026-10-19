// One-time copy of local bags, settings and photos to Vercel (Blob + Upstash Redis).
// Usage (from the project folder):
//   vercel env pull .env.local
//   node --env-file=.env.local scripts/migrate-to-cloud.js
const fs = require('fs');
const path = require('path');
const { put } = require('@vercel/blob');
const store = require('../storage');

const ROOT = path.join(__dirname, '..');
const readLocal = name => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name + '.json'), 'utf8')); } catch { return null; }
};

(async () => {
  if (!store.CLOUD) {
    console.error('Cloud storage keys not found. Run "vercel env pull .env.local" first and pass --env-file=.env.local');
    process.exit(1);
  }
  const products = readLocal('products') || [];
  const settings = readLocal('settings');
  const existing = await store.read('products', []);
  if (existing.length) {
    console.error(`The live site already has ${existing.length} bag(s). Stopping so nothing is overwritten.`);
    process.exit(1);
  }

  for (const p of products) {
    const urls = [];
    for (const local of p.photos) {
      const file = path.join(ROOT, 'uploads', path.basename(local));
      if (!fs.existsSync(file)) { console.warn('  missing photo, skipped:', local); continue; }
      const blob = await put('bags/' + path.basename(file), fs.readFileSync(file), { access: 'public', addRandomSuffix: true, token: store.BLOB_TOKEN });
      urls.push(blob.url);
    }
    p.photos = urls;
    console.log(`✓ ${p.name} (${urls.length} photo(s))`);
  }

  await store.write('products', products);
  if (settings) await store.write('settings', settings);
  console.log(`\nDone: ${products.length} bag(s)${settings ? ' and settings' : ''} copied to the live site.`);
})().catch(err => { console.error(err); process.exit(1); });
