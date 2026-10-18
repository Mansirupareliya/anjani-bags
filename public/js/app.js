const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

let products = [];
let settings = {};
let current = null, photoIdx = 0;

// ---------- loader, nav, reveal ----------
window.addEventListener('load', () => setTimeout(() => $('#loader').classList.add('done'), 500));
window.addEventListener('scroll', () => $('#nav').classList.toggle('scrolled', scrollY > 40));
$('#burger').onclick = () => { $('#menu').classList.toggle('open'); $('#burger').classList.toggle('open'); };
document.addEventListener('click', e => {
  if ($('#menu').classList.contains('open') && !e.target.closest('#menu, #burger')) {
    $('#menu').classList.remove('open'); $('#burger').classList.remove('open');
  }
});
document.querySelectorAll('#menu a').forEach(a => a.onclick = () => { $('#menu').classList.remove('open'); $('#burger').classList.remove('open'); });
$('#year').textContent = new Date().getFullYear();

const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .15 });
const observe = root => root.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el));
observe(document);

// counters
const countIO = new IntersectionObserver(entries => entries.forEach(e => {
  if (!e.isIntersecting) return;
  const el = e.target, end = +el.dataset.count, t0 = performance.now();
  const step = t => {
    const p = Math.min((t - t0) / 1600, 1);
    el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  countIO.unobserve(el);
}));

// sparkles
for (let i = 0; i < 26; i++) {
  const s = document.createElement('i');
  s.style.left = Math.random() * 100 + '%';
  s.style.top = Math.random() * 100 + '%';
  s.style.animationDelay = (Math.random() * 3) + 's';
  s.style.scale = .5 + Math.random();
  $('#sparkles').appendChild(s);
}

// ---------- data ----------
async function init() {
  $('#grid').innerHTML = '<div class="skeleton"></div>'.repeat(4);
  [settings, products] = await Promise.all([
    fetch('/api/settings').then(r => r.json()),
    fetch('/api/products').then(r => r.json())
  ]);
  renderContact();
  renderStats();
  renderMarquee();
  renderFilters();
  renderGrid();
  const id = new URLSearchParams(location.search).get('bag');
  if (id) openProduct(id);
}

function waLink(text) {
  return `https://wa.me/${String(settings.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

// hero numbers come from admin settings; animate only once they are known
function renderStats() {
  ['statDesigns', 'statClients', 'statYears'].forEach(k => {
    const el = document.getElementById(k);
    if (settings[k] != null && settings[k] !== '') el.dataset.count = parseInt(settings[k]) || 0;
    countIO.observe(el);
  });
}

function renderContact() {
  $('#cPhone').href = 'tel:' + String(settings.phone).replace(/\s/g, '');
  $('#cPhone span').textContent = settings.phone;
  $('#cMail').href = 'mailto:' + settings.email;
  $('#cMail span').textContent = settings.email;
  $('#cAddr span').textContent = settings.address;
  $('#cWa').href = $('#waFloat').href = waLink('Hello Shree Anjani Bag, I want to know about your bags.');
}

function renderMarquee() {
  const cats = settings.categories || [];
  $('#marquee').innerHTML = [...cats, 'Custom Printing', 'Bulk Orders', ...cats, 'Custom Printing', 'Bulk Orders']
    .map(c => `<span>${esc(c)}</span>`).join('');
}

// ---------- filters ----------
const priceOf = p => p.price ?? p.mrp;
const gsmNum = g => parseFloat(g) || 0;

function renderFilters() {
  const opts = list => list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const cats = [...new Set([...(settings.categories || []), ...products.map(p => p.category).filter(Boolean)])];
  $('#fCat').insertAdjacentHTML('beforeend', opts(cats));
  const gsms = [...new Set(products.map(p => p.gsm).filter(Boolean))].sort((a, b) => gsmNum(a) - gsmNum(b));
  $('#fGsm').insertAdjacentHTML('beforeend', gsms.map(g => `<option value="${esc(g)}">${esc(g)} GSM</option>`).join(''));
  const prices = products.map(priceOf).filter(v => v != null);
  if (prices.length) {
    $('#fMin').placeholder = 'Min ' + Math.floor(Math.min(...prices));
    $('#fMax').placeholder = 'Max ' + Math.ceil(Math.max(...prices));
  }
}

function getFilters() {
  return {
    q: $('#search').value.trim().toLowerCase(),
    cat: $('#fCat').value,
    gsm: $('#fGsm').value,
    min: $('#fMin').value === '' ? null : +$('#fMin').value,
    max: $('#fMax').value === '' ? null : +$('#fMax').value,
    sort: $('#fSort').value
  };
}

function filteredProducts() {
  const f = getFilters();
  const list = products.filter(p => {
    const price = priceOf(p);
    return (!f.cat || p.category === f.cat) &&
      (!f.gsm || p.gsm === f.gsm) &&
      (f.min == null || (price != null && price >= f.min)) &&
      (f.max == null || (price != null && price <= f.max)) &&
      (!f.q || (p.name + ' ' + p.description + ' ' + p.category).toLowerCase().includes(f.q));
  });
  // bags without a price / GSM always go last
  const by = (get, dir) => (a, b) => {
    const x = get(a), y = get(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return (x - y) * dir;
  };
  if (f.sort === 'low') list.sort(by(priceOf, 1));
  if (f.sort === 'high') list.sort(by(priceOf, -1));
  if (f.sort === 'gsm') list.sort(by(p => gsmNum(p.gsm) || null, 1));
  const active = [f.q, f.cat, f.gsm, f.min != null, f.max != null].filter(Boolean).length;
  $('#fReset').hidden = !active && f.sort === 'new';
  renderChips();
  return list;
}

['#search', '#fMin', '#fMax'].forEach(s => $(s).oninput = renderGrid);
['#fCat', '#fGsm', '#fSort'].forEach(s => $(s).onchange = renderGrid);
$('#fReset').onclick = () => { $('#filterBar').reset(); closeDrop(); renderGrid(); };

// ---------- phone filter buttons ----------
const CHIPS = [
  { key: 'fCat', label: 'Category' },
  { key: 'fGsm', label: 'GSM' },
  { key: 'price', label: 'Price' },
  { key: 'fSort', label: 'Sort by' }
];
let openChip = null;

function chipText(c) {
  if (c.key === 'price') {
    const min = $('#fMin').value, max = $('#fMax').value;
    if (min === '' && max === '') return null;
    return min !== '' && max !== '' ? `₹${min} – ₹${max}` : min !== '' ? `₹${min}+` : `Up to ₹${max}`;
  }
  const sel = document.getElementById(c.key);
  if (c.key === 'fSort' ? sel.value === 'new' : !sel.value) return null;
  return sel.options[sel.selectedIndex].text;
}

function renderChips() {
  const anyActive = !$('#fReset').hidden;
  $('#mChips').innerHTML = CHIPS.map(c => {
    const val = chipText(c);
    return `<button type="button" class="m-chip ${val ? 'set' : ''} ${openChip === c.key ? 'open' : ''}" data-key="${c.key}">
      ${esc(val || c.label)} <i>▾</i></button>`;
  }).join('') + (anyActive ? '<button type="button" class="m-chip clear" data-key="clear">✕ Clear</button>' : '');
  $('#mChips').querySelectorAll('.m-chip').forEach(b => b.onclick = () => {
    if (b.dataset.key === 'clear') return $('#fReset').click();
    openChip === b.dataset.key ? closeDrop() : openDrop(b.dataset.key);
  });
}

function openDrop(key) {
  openChip = key;
  const drop = $('#mDrop');
  if (key === 'price') {
    drop.innerHTML = `
      <div class="m-price">
        <input type="number" id="mMin" min="0" inputmode="numeric" placeholder="${esc($('#fMin').placeholder)}" value="${esc($('#fMin').value)}">
        <span>–</span>
        <input type="number" id="mMax" min="0" inputmode="numeric" placeholder="${esc($('#fMax').placeholder)}" value="${esc($('#fMax').value)}">
      </div>
      <div class="m-actions">
        <button type="button" class="m-btn ghost" id="mPriceClear">Clear</button>
        <button type="button" class="m-btn" id="mPriceApply">Apply</button>
      </div>`;
    const apply = (min, max) => { $('#fMin').value = min; $('#fMax').value = max; closeDrop(); renderGrid(); };
    $('#mPriceApply').onclick = () => apply($('#mMin').value, $('#mMax').value);
    $('#mPriceClear').onclick = () => apply('', '');
  } else {
    const sel = document.getElementById(key);
    drop.innerHTML = [...sel.options].map(o =>
      `<button type="button" class="m-opt ${o.value === sel.value ? 'on' : ''}" data-v="${esc(o.value)}">${esc(o.text)}</button>`).join('');
    drop.querySelectorAll('.m-opt').forEach(b => b.onclick = () => { sel.value = b.dataset.v; closeDrop(); renderGrid(); });
  }
  drop.hidden = false;
  drop.style.animation = 'none'; drop.offsetHeight; drop.style.animation = '';
  renderChips();
}

function closeDrop() {
  openChip = null;
  $('#mDrop').hidden = true;
  renderChips();
}

// composedPath, because tapping a chip re-renders it and detaches e.target
document.addEventListener('click', e => {
  if (openChip && !e.composedPath().includes($('#mFilters'))) closeDrop();
});

function priceHtml(p) {
  if (p.price == null && p.mrp == null) return '<span class="price">Price on request</span>';
  const main = p.price ?? p.mrp;
  const cut = p.price != null && p.mrp != null && p.mrp > p.price ? `<s>${money(p.mrp)}</s>` : '';
  return `<span class="price">${money(main)}${cut} <small>/ ${esc(p.unit || 'piece')}</small></span>`;
}

function renderGrid() {
  const list = filteredProducts();
  $('#empty').hidden = list.length > 0;
  $('#empty').textContent = products.length ? 'No bags match these filters.' : 'No bags here yet. Please check back soon.';
  $('#resultCount').textContent = products.length ? `Showing ${list.length} of ${products.length} bags` : '';
  $('#grid').innerHTML = list.map((p, i) => {
    const off = p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
    const imgs = p.photos.length
      ? `<img src="${esc(p.photos[0])}" alt="${esc(p.name)}" loading="lazy">` +
        (p.photos[1] ? `<img class="second" src="${esc(p.photos[1])}" alt="" loading="lazy">` : '')
      : '<div class="noimg">👜</div>';
    return `
      <div class="card" style="animation-delay:${Math.min(i, 12) * .06}s" data-id="${p.id}">
        <div class="pic">
          ${off ? `<span class="badge off">${off}% OFF</span>` : ''}
          ${p.featured ? '<span class="badge star">★ Bestseller</span>' : ''}
          ${imgs}
        </div>
        <div class="info">
          <h3>${esc(p.name)}</h3>
          <div class="meta">${[p.gsm && p.gsm + ' GSM', p.size, p.photos.length > 1 && p.photos.length + ' photos'].filter(Boolean).map(esc).join(' · ')}</div>
          ${priceHtml(p)}
        </div>
      </div>`;
  }).join('');
  $('#grid').querySelectorAll('.card').forEach(c => c.onclick = () => openProduct(c.dataset.id));
}

// ---------- modal ----------
function openProduct(id) {
  current = products.find(p => p.id === id);
  if (!current) return;
  photoIdx = 0;
  $('#mCat').textContent = current.category || 'Bag';
  $('#mName').textContent = current.name;
  $('#mPrice').innerHTML = priceHtml(current);
  $('#mSpecs').innerHTML = [
    current.gsm && ['GSM', current.gsm],
    current.size && ['Size', current.size],
    current.mrp != null && ['MRP', money(current.mrp)]
  ].filter(Boolean).map(([k, v]) => `<span><b>${k}:</b> ${esc(v)}</span>`).join('');
  $('#mDesc').textContent = current.description;
  $('#mEnquire').href = waLink(`Hello Shree Anjani Bag, I am interested in "${current.name}". ${location.origin}/?bag=${current.id}`);
  $('#thumbs').innerHTML = current.photos.map((src, i) => `<img src="${esc(src)}" data-i="${i}" alt="">`).join('');
  $('#thumbs').querySelectorAll('img').forEach(t => t.onclick = () => showPhoto(+t.dataset.i));
  const many = current.photos.length > 1;
  $('#prevPhoto').hidden = $('#nextPhoto').hidden = $('#photoCount').hidden = !many;
  showPhoto(0);
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function showPhoto(i) {
  const n = current.photos.length;
  if (!n) { $('#mainImg').removeAttribute('src'); return; }
  photoIdx = (i + n) % n;
  const img = $('#mainImg');
  img.style.animation = 'none'; img.offsetHeight; img.style.animation = '';
  img.src = current.photos[photoIdx];
  $('#photoCount').textContent = `${photoIdx + 1} / ${n}`;
  $('#thumbs').querySelectorAll('img').forEach((t, k) => t.classList.toggle('active', k === photoIdx));
}
function closeModal() {
  $('#modal').hidden = true;
  document.body.style.overflow = '';
  if (location.search) history.replaceState(null, '', location.pathname);
}
$('#prevPhoto').onclick = () => showPhoto(photoIdx - 1);
$('#nextPhoto').onclick = () => showPhoto(photoIdx + 1);
$('#closeModal').onclick = closeModal;
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', e => {
  if ($('#modal').hidden) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'ArrowLeft') showPhoto(photoIdx - 1);
  if (e.key === 'ArrowRight') showPhoto(photoIdx + 1);
});
let touchX = null;
$('#mainPhoto').addEventListener('touchstart', e => touchX = e.touches[0].clientX, { passive: true });
$('#mainPhoto').addEventListener('touchend', e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) showPhoto(photoIdx + (dx < 0 ? 1 : -1));
  touchX = null;
});

init();
