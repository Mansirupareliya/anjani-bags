const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null ? '-' : '₹' + Number(n).toLocaleString('en-IN');

let token = sessionStorage.getItem('anjaniToken') || '';
let products = [], settings = {};
let editingId = null;
// photo list in the form: { url } for already saved, { file, url: blob } for new
let photos = [];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') logout();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- login ----------
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const { token: t } = await api('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#password').value })
    });
    token = t; sessionStorage.setItem('anjaniToken', t);
    showDash();
  } catch (err) {
    $('#loginErr').textContent = err.message;
    const box = $('#loginForm'); box.classList.remove('shake'); box.offsetWidth; box.classList.add('shake');
  }
};
function logout() {
  token = ''; sessionStorage.removeItem('anjaniToken');
  $('#dash').hidden = true; $('#login').hidden = false;
}
$('#logout').onclick = logout;

async function showDash() {
  $('#login').hidden = true; $('#dash').hidden = false;
  await loadAll();
}

async function loadAll() {
  [settings, products] = await Promise.all([api('/api/settings'), api('/api/products')]);
  $('#catSelect').innerHTML = '<option value="">- Select -</option>' +
    settings.categories.map(c => `<option>${esc(c)}</option>`).join('');
  const f = $('#setForm');
  ['phone', 'whatsapp', 'email', 'address', 'statDesigns', 'statClients', 'statYears'].forEach(k => f[k].value = settings[k] ?? '');
  f.categories.value = settings.categories.join('\n');
  renderList();
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  $('#tab-products').hidden = b.dataset.tab !== 'products';
  $('#tab-settings').hidden = b.dataset.tab !== 'settings';
});

// ---------- photos ----------
function addFiles(files) {
  [...files].filter(f => f.type.startsWith('image/')).forEach(file => photos.push({ file, url: URL.createObjectURL(file) }));
  renderPreviews();
}
$('#photos').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });

let dragFrom = null;
function renderPreviews() {
  $('#previews').innerHTML = photos.map((p, i) => `
    <div class="pv" draggable="true" data-i="${i}">
      <img src="${esc(p.url)}" alt="">
      <button type="button" data-del="${i}" title="Remove">×</button>
    </div>`).join('');
  $('#previews').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const [p] = photos.splice(+b.dataset.del, 1);
    if (p.file) URL.revokeObjectURL(p.url);
    renderPreviews();
  });
  // drag to reorder (first = cover)
  $('#previews').querySelectorAll('.pv').forEach(el => {
    el.ondragstart = () => { dragFrom = +el.dataset.i; el.classList.add('dragging'); };
    el.ondragend = () => el.classList.remove('dragging');
    el.ondragover = e => e.preventDefault();
    el.ondrop = e => {
      e.preventDefault(); e.stopPropagation();
      const to = +el.dataset.i;
      if (dragFrom == null || dragFrom === to) return;
      photos.splice(to, 0, photos.splice(dragFrom, 1)[0]);
      dragFrom = null; renderPreviews();
    };
  });
}

// ---------- save ----------
function resetForm() {
  $('#bagForm').reset();
  photos.forEach(p => p.file && URL.revokeObjectURL(p.url));
  photos = []; editingId = null;
  renderPreviews();
  $('#formTitle').textContent = 'Add New Bag';
  $('#saveBtn').textContent = 'Save Bag';
  $('#cancelEdit').hidden = true;
}
$('#cancelEdit').onclick = resetForm;

// Photos are uploaded one by one first (to Vercel Blob on the live site, or to
// this server locally), then the bag is saved with its photo URLs in display order.
let uploadMode = null;
const getUploadMode = async () =>
  uploadMode ??= (await fetch('/api/config').then(r => r.json()).catch(() => ({}))).uploadMode || 'local';

function uploadLocal(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('photo', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = ev => ev.lengthComputable && onProgress(ev.loaded);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 401) { logout(); return reject(new Error('Please log in again')); }
      xhr.status < 300 ? resolve(data.url) : reject(new Error(data.error || 'Photo upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

async function uploadBlob(file, onProgress) {
  const { upload } = await import('/js/vendor/blob-client.js');
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const res = await upload('bags/' + safeName, file, {
    access: 'public',
    handleUploadUrl: '/api/blob-upload',
    headers: { Authorization: 'Bearer ' + token },
    onUploadProgress: p => onProgress(p.loaded)
  });
  return res.url;
}

$('#bagForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const btn = $('#saveBtn'), bar = $('#progress');
  btn.disabled = true; bar.hidden = false;
  const setBar = pct => bar.firstElementChild.style.width = pct + '%';
  try {
    // upload new photos, keeping the arranged order
    const pending = photos.filter(p => p.file);
    const total = pending.reduce((s, p) => s + p.file.size, 0) || 1;
    const loaded = new Map();
    const progress = (p, n) => { loaded.set(p, n); setBar([...loaded.values()].reduce((a, b) => a + b, 0) / total * 95); };
    const send = (await getUploadMode()) === 'blob' ? uploadBlob : uploadLocal;
    for (const p of pending) {
      p.saved = p.saved || await send(p.file, n => progress(p, n));
      progress(p, p.file.size);
    }

    const body = {
      name: f.name.value, category: f.category.value, description: f.description.value,
      gsm: f.gsm.value, size: f.size.value, unit: f.unit.value, mrp: f.mrp.value, price: f.price.value,
      featured: f.featured.checked,
      photos: photos.map(p => p.saved || p.url)
    };
    await api(editingId ? '/api/products/' + editingId : '/api/products', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setBar(100);
    toast(editingId ? 'Bag updated ✓' : 'Bag added ✓');
    resetForm();
    loadAll();
  } catch (err) {
    toast(err.message || 'Save failed');
  } finally {
    btn.disabled = false; bar.hidden = true; setBar(0);
  }
};

// ---------- list ----------
function renderList() {
  const q = $('#filter').value.toLowerCase();
  const list = products.filter(p => (p.name + p.category).toLowerCase().includes(q));
  $('#count').textContent = `(${products.length})`;
  $('#list').innerHTML = list.length ? list.map(p => `
    <div class="item">
      ${p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="">` : '<div class="ph">👜</div>'}
      <div class="txt">
        <b>${esc(p.name)}</b>
        <small>${esc(p.category || 'No category')} · ${money(p.price)} ${p.mrp ? '· MRP ' + money(p.mrp) : ''} · ${p.photos.length} photo(s)</small>
      </div>
      <div class="acts">
        <button class="btn small ghost" data-edit="${p.id}">Edit</button>
        <button class="btn small danger" data-del="${p.id}">Delete</button>
      </div>
    </div>`).join('') : '<p class="none">No bags yet. Add your first bag!</p>';
  $('#list').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => startEdit(b.dataset.edit));
  $('#list').querySelectorAll('[data-del]').forEach(b => b.onclick = () => removeBag(b.dataset.del));
}
$('#filter').oninput = renderList;

function startEdit(id) {
  const p = products.find(x => x.id === id);
  resetForm();
  editingId = id;
  const f = $('#bagForm');
  ['name', 'category', 'description', 'gsm', 'size', 'unit'].forEach(k => f[k].value = p[k] || '');
  f.mrp.value = p.mrp ?? ''; f.price.value = p.price ?? '';
  f.featured.checked = !!p.featured;
  photos = p.photos.map(url => ({ url }));
  renderPreviews();
  $('#formTitle').textContent = 'Edit Bag';
  $('#saveBtn').textContent = 'Update Bag';
  $('#cancelEdit').hidden = false;
  f.scrollIntoView({ behavior: 'smooth' });
}

async function removeBag(id) {
  const p = products.find(x => x.id === id);
  if (!confirm(`Delete "${p.name}" and all its photos?`)) return;
  try {
    await api('/api/products/' + id, { method: 'DELETE' });
    if (editingId === id) resetForm();
    toast('Bag deleted');
    loadAll();
  } catch (err) { toast(err.message); }
}

// ---------- settings ----------
$('#setForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const body = {
    phone: f.phone.value, whatsapp: f.whatsapp.value, email: f.email.value, address: f.address.value,
    statDesigns: +f.statDesigns.value || 0, statClients: +f.statClients.value || 0, statYears: +f.statYears.value || 0,
    categories: f.categories.value.split('\n').map(s => s.trim()).filter(Boolean)
  };
  try {
    await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Settings saved ✓');
    loadAll();
  } catch (err) { toast(err.message); }
};

if (token) showDash().catch(logout);
