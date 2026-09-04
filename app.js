import { parseFile, dedupe, inKorea, UNNAMED } from './parse.js';

/* ================= sabitler ================= */

const STORE_KEY = 'koremap.places.v2';
const PREF_KEY = 'koremap.prefs.v1';
const APPNAME = location.hostname || 'koremap';
const SEOUL = [37.5665, 126.9780];

const PALETTE = ['#e8452b', '#f59e0b', '#10b981', '#2b7fff', '#8b5cf6',
                 '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

const DEMO = [
  { name: '광장시장 (Gwangjang Market)', category: 'Yemek', lat: 37.5700, lng: 126.9997, note: 'Bindaetteok ve mayak gimbap.' },
  { name: '경복궁 (Gyeongbokgung)', category: 'Gezi', lat: 37.5796, lng: 126.9770, note: 'Nöbet değişimi 10:00 ve 14:00.' },
  { name: 'N서울타워 (N Seoul Tower)', category: 'Gezi', lat: 37.5512, lng: 126.9882 },
  { name: '홍대 (Hongdae)', category: 'Gece', lat: 37.5563, lng: 126.9236 },
  { name: '성수동 (Seongsu-dong)', category: 'Kafe', lat: 37.5445, lng: 127.0557, note: 'Kahve sokağı.' },
  { name: '해운대 해수욕장 (Haeundae Beach)', category: 'Gezi', lat: 35.1587, lng: 129.1604, note: 'Busan.' },
];

/* ================= durum ================= */

const state = {
  places: [],
  cats: new Set(),          // aktif kategori filtreleri (bos = hepsi)
  q: '',
  sort: 'name',             // 'name' | 'dist' | 'cat'
  selected: null,
  me: null,                 // {lat,lng}
  view: 'list',             // 'list' | 'detail'
};

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Id'ler harita marker'larini ve secimi adresliyor; iki kayit ayni id'yi
   tasirsa yanlis yer aciliyor. Farkli kaynaklardan (depo + gomulu liste +
   ice aktarma) birlesen kayitlarda buna karsi son bir kontrol. */
function ensureUniqueIds(places) {
  const seen = new Set();
  for (const p of places) {
    if (!p.id || seen.has(p.id)) {
      let i = 2, base = p.id || 'p';
      while (seen.has(base + '~' + i)) i++;
      p.id = base + '~' + i;
    }
    seen.add(p.id);
  }
  return places;
}

/* ================= depolama ================= */

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state.places = ensureUniqueIds(JSON.parse(raw));
  } catch { state.places = []; }
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    // 'dist' yalnizca konum varken anlamli; oturum basinda konum henuz yok.
    if (p.sort && p.sort !== 'dist') state.sort = p.sort;
  } catch { /* yoksay */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.places));
    localStorage.setItem(PREF_KEY, JSON.stringify({ sort: state.sort }));
  } catch (e) {
    toast('Kaydedilemedi — depolama dolu olabilir.');
  }
}

/* ================= yardimcilar ================= */

const colorCache = new Map();
function colorFor(cat) {
  let c = colorCache.get(cat);
  if (c) return c;
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  c = PALETTE[h % PALETTE.length];
  colorCache.set(cat, c);
  return c;
}

function distance(a, b) {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtDist = (m) => m < 950 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const pinCache = new Map();
const pinSvg = (color, cls = 'pin') => {
  const k = cls + '|' + color;
  let v = pinCache.get(k);
  if (v === undefined) {
    v = `<svg class="${cls}" viewBox="0 0 30 38" aria-hidden="true">` +
        `<path d="M15 1.5C8 1.5 2.5 7 2.5 14c0 8.7 12.5 22.5 12.5 22.5S27.5 22.7 27.5 14C27.5 7 22 1.5 15 1.5z" ` +
        `fill="${color}" stroke="#fff" stroke-width="2.2"/>` +
        `<circle cx="15" cy="14" r="4.4" fill="#fff"/></svg>`;
    pinCache.set(k, v);
  }
  return v;
};

/* ================= Naver baglantilari ================= */

function naverLinks(p, mode /* place | transit | car | walk */) {
  // Adi olmayan kayitlarda isim aramasi ise yaramaz — koordinati etiket olarak kullan.
  const label = p.unnamed ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : p.name;
  const n = encodeURIComponent(label);
  if (mode === 'place') {
    return {
      app: `nmap://place?lat=${p.lat}&lng=${p.lng}&name=${n}&appname=${APPNAME}`,
      web: p.unnamed
        ? `https://map.naver.com/p/?c=${p.lng},${p.lat},17,0,0,0,dh`
        : `https://map.naver.com/p/search/${n}?c=${p.lng},${p.lat},16,0,0,0,dh`,
    };
  }
  const appMode = mode === 'transit' ? 'public' : mode;
  return {
    app: `nmap://route/${appMode}?dlat=${p.lat}&dlng=${p.lng}&dname=${n}&appname=${APPNAME}`,
    web: `https://map.naver.com/p/directions/-/${p.lng},${p.lat},${n}/-/${mode}`,
  };
}

/** Once Naver uygulamasini dene; acilmazsa ~1.3 sn sonra web haritaya dus.
   Yalnizca sayfanin gercekten arka plana dusmesi iptal sayilir — `blur` tek
   basina guvenilir degil, deep link denemesi pencereyi anlik blur'layabiliyor. */
let naverPending = false;
function openNaver(appUrl, webUrl) {
  if (naverPending) return;              // cift dokunusta iki yonlendirme olmasin
  naverPending = true;
  setTimeout(() => { naverPending = false; }, 1600);
  let switched = false;
  const cancel = () => { if (document.hidden) switched = true; };
  document.addEventListener('visibilitychange', cancel);
  window.addEventListener('pagehide', () => { switched = true; }, { once: true });

  setTimeout(() => {
    document.removeEventListener('visibilitychange', cancel);
    if (!switched && !document.hidden) window.location.href = webUrl;
  }, 1300);

  window.location.href = appUrl;
}

// Telefonda sorun ayiklamak icin (konsoldan: KOREMAP.naverLinks(KOREMAP.state.places[0],'transit'))
window.KOREMAP = { naverLinks, state, render: () => render(), visible: () => visible() };

/* ================= harita ================= */

let map, layer, meMarker, markers = new Map();

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, tap: true })
        .setView(SEOUL, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  layer = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({
        maxClusterRadius: 46,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: (c) => {
          const n = c.getChildCount();
          const s = n < 10 ? 34 : n < 100 ? 40 : 46;
          return L.divIcon({
            html: `<div class="mk-cluster" style="width:${s}px;height:${s}px">${n}</div>`,
            className: '', iconSize: [s, s],
          });
        },
      })
    : L.layerGroup();
  layer.addTo(map);

  map.on('click', () => { if (state.view === 'detail') showList(); });
}

/* Vurgu, marker'in kendi ikonuna islenir — kume acilip kapandiginda DOM yeniden
   olusuyor, dolayisiyla disaridan eklenen CSS sinifi kayboluyor. */
function iconFor(p) {
  const cls = (p.id === state.selected ? ' sel' : '') + (p.approx ? ' approx' : '');
  return L.divIcon({
    html: `<span class="pin-wrap${cls}" data-id="${p.id}">${pinSvg(colorFor(p.category))}</span>`,
    className: '', iconSize: [30, 38], iconAnchor: [15, 37], popupAnchor: [0, -34],
  });
}

/* Pin'leri yeniden cizmek 4x yavas CPU'da ~100 ms suruyor ve render() cogu zaman
   ayni pin kumesiyle cagriliyor (siralama degisimi, GPS guncellemesi...).
   Imza ayniysa dokunma; secim vurgusu zaten ayri guncelleniyor. */
let markerSig = null;
function renderMarkers(list = visible()) {
  let sig = list.length + '#';
  for (const p of list) {
    if (Number.isFinite(p.lat)) sig += `${p.id}@${p.lat},${p.lng}${p.approx ? 'a' : ''};`;
  }
  if (sig === markerSig) { highlightMarker(); return; }
  markerSig = sig;

  layer.clearLayers();
  markers.clear();
  for (const p of list) {
    if (!Number.isFinite(p.lat)) continue;
    const m = L.marker([p.lat, p.lng], { icon: iconFor(p), title: p.name });
    m.on('click', () => selectPlace(p.id, false));
    markers.set(p.id, m);
    layer.addLayer(m);
  }
  lastSelected = state.selected;  // ikonlar zaten dogru durumla olusturuldu
}

let lastSelected = null;
function highlightMarker() {
  for (const id of [lastSelected, state.selected]) {
    if (!id) continue;
    const m = markers.get(id), p = state.places.find(x => x.id === id);
    if (m && p) {
      m.setIcon(iconFor(p));
      m.setZIndexOffset(id === state.selected ? 800 : 0);
    }
  }
  lastSelected = state.selected;
}

function fitAll(list = visible()) {
  const pts = list.filter(p => Number.isFinite(p.lat)).map(p => [p.lat, p.lng]);
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], 15);
  else map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 15 });
}

/* ================= filtreleme / siralama ================= */

function visible() {
  const q = state.q.trim().toLowerCase();
  let out = state.places.filter(p => {
    if (state.cats.size && !state.cats.has(p.category)) return false;
    if (!q) return true;
    return (p.name + ' ' + p.note + ' ' + p.address + ' ' + p.category).toLowerCase().includes(q);
  });
  const byName = (a, b) => a.name.localeCompare(b.name, 'tr');
  if (state.sort === 'dist' && state.me) {
    out.sort((a, b) => {
      const da = Number.isFinite(a.lat) ? distance(state.me, a) : Infinity;
      const db = Number.isFinite(b.lat) ? distance(state.me, b) : Infinity;
      return da - db || byName(a, b);
    });
  } else if (state.sort === 'cat') {
    out.sort((a, b) => a.category.localeCompare(b.category, 'tr') || byName(a, b));
  } else {
    out.sort(byName);
  }
  return out;
}

/* ================= alt panel (sheet) ================= */

const sheet = $('#sheet');
const fabs = $('#fabs');
let snap = { full: 0, half: 0, peek: 0 }, snapName = 'half';

function measureSnaps() {
  const H = sheet.offsetHeight;
  snap = { full: 0, half: Math.round(H * 0.50), peek: Math.max(0, H - 118) };
}
function setSheet(name, animate = true) {
  snapName = name;
  measureSnaps();
  sheet.classList.toggle('dragging', !animate);
  sheet.style.transform = `translateY(${snap[name]}px)`;
  fabs.style.bottom = (sheet.offsetHeight - snap[name] + 12) + 'px';
  if (!animate) requestAnimationFrame(() => sheet.classList.remove('dragging'));
}

function initSheetDrag() {
  const grab = $('#grab');
  let startY = 0, startT = 0, lastY = 0, lastT = 0, dragging = false;

  const down = (e) => {
    dragging = true;
    measureSnaps();
    startY = lastY = e.clientY;
    startT = lastT = performance.now();
    sheet.classList.add('dragging');
    grab.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!dragging) return;
    const y = Math.min(snap.peek, Math.max(0, snap[snapName] + (e.clientY - startY)));
    sheet.style.transform = `translateY(${y}px)`;
    fabs.style.bottom = (sheet.offsetHeight - y + 12) + 'px';
    lastY = e.clientY; lastT = performance.now();
  };
  const up = (e) => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const cur = Math.min(snap.peek, Math.max(0, snap[snapName] + (e.clientY - startY)));
    const v = (lastY - startY) / Math.max(1, lastT - startT);  // px/ms
    const order = ['full', 'half', 'peek'];
    let target;
    if (Math.abs(v) > 0.5) {
      const i = order.indexOf(snapName);
      target = order[Math.min(order.length - 1, Math.max(0, i + (v > 0 ? 1 : -1)))];
    } else {
      target = order.reduce((best, n) =>
        Math.abs(snap[n] - cur) < Math.abs(snap[best] - cur) ? n : best, 'half');
    }
    setSheet(target);
  };

  grab.addEventListener('pointerdown', down);
  grab.addEventListener('pointermove', move);
  grab.addEventListener('pointerup', up);
  grab.addEventListener('pointercancel', up);
  grab.addEventListener('click', () => {
    setSheet(snapName === 'full' ? 'peek' : snapName === 'half' ? 'full' : 'half');
  });
  window.addEventListener('resize', () => setSheet(snapName, false));
}

/* ================= gorunumler ================= */

function render() {
  const list = visible();           // filtre + siralama render basina bir kez
  renderChips();
  renderMarkers(list);
  if (state.view === 'detail' && state.selected) renderDetail();
  else renderList(list);
}

let chipSig = null;
function renderChips() {
  const counts = new Map();
  for (const p of state.places) counts.set(p.category, (counts.get(p.category) || 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'tr'));
  const box = $('#chips');

  // Yeniden yazmak seridin yatay kaydirmasini basa aliyor — icerik ayniysa dokunma.
  const sig = cats.map(c => `${c}:${counts.get(c)}:${state.cats.has(c) ? 1 : 0}`).join('|');
  if (sig === chipSig) return;
  chipSig = sig;

  if (cats.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = cats.map(c => `
    <button class="chip ${state.cats.has(c) ? 'on' : ''}" data-cat="${esc(c)}">
      <span class="dot" style="background:${colorFor(c)}"></span>${esc(c)}
      <span style="opacity:.6">${counts.get(c)}</span>
    </button>`).join('');
}

let listSig = null, listScroll = 0;
function renderList(list = visible()) {
  state.view = 'list';
  let nCoord = 0, nName = 0;
  for (const p of state.places) { if (needsCoord(p)) nCoord++; else if (needsName(p)) nName++; }
  const sortLabel = { name: 'A → Z', dist: 'Yakınlık', cat: 'Liste' }[state.sort];
  const issue = [
    nCoord ? `${nCoord} yerin konumu` : '',
    nName ? `${nName} yerin adı` : '',
  ].filter(Boolean).join(', ');

  const body = $('#sheetBody');
  if (!state.places.length) {
    listSig = 'empty';
    body.innerHTML = `<div class="empty"><b>Henüz yer yok</b>
      Kayıtlı Kore listeni geri yükle ya da yeni bir Takeout dosyası aktar.
      <div class="row-btns" style="margin-top:16px">
        <button class="btn naver" id="restoreSeed">Kayıtlı listem</button>
        <button class="btn" id="openImport">İçe aktar</button>
      </div></div>`;
    return;
  }

  /* Ayni liste yeniden ciziliyorsa (GPS guncellemesi, uzaklik tazeleme...)
     kullanicinin kaydirma konumunu koru; liste degistiyse basa don. */
  // list bos olabilir (arama hicbir sey bulmadiginda) — indisli erisim korumali.
  const sig = `${state.sort}|${list.length}|${list[0]?.id ?? ""}|${list[list.length - 1]?.id ?? ""}|${nCoord},${nName}`;
  const keepScroll = sig === listSig;
  listSig = sig;
  if (!keepScroll) listScroll = 0;

  body.innerHTML = `
    <div class="list-head">
      <b>${list.length} yer</b>
      ${list.length !== state.places.length ? `<span>/ ${state.places.length}</span>` : ''}
      <button class="sort" id="sortBtn">${sortLabel}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    ${issue ? `<div class="banner">
      <span><b>${issue} eksik.</b> Google dışa aktarımı bunları vermemiş.
      OpenStreetMap'ten tamamlamayı deneyebilirim (~1 sn/kayıt).</span>
      <button id="fixBtn">Tamamla</button></div>` : ''}
    ${list.map(p => {
      const d = (state.me && Number.isFinite(p.lat)) ? distance(state.me, p) : null;
      const meta = [p.category, p.address || p.note].filter(Boolean).join(' · ');
      return `<button class="row ${Number.isFinite(p.lat) ? '' : 'nocoord'}" data-id="${p.id}">
        <span class="sq" style="background:${colorFor(p.category)}22">${pinSvg(colorFor(p.category), '')}</span>
        <span class="tx"><span class="nm">${esc(p.name)}</span>
          ${meta ? `<span class="mt">${esc(meta)}</span>` : ''}</span>
        ${d !== null ? `<span class="dist">${fmtDist(d)}</span>` : ''}
      </button>`;
    }).join('') || `<div class="empty"><b>Eşleşme yok</b>Aramayı veya filtreyi değiştir.</div>`}`;

  /* scrollTop'a yazmak 451 satirlik listede zorunlu reflow tetikliyor (~90 ms).
     Liste degistiyse basa almak sart; ayni liste yeniden ciziliyorsa yalnizca
     geri yuklenecek gercek bir konum varsa dokun. */
  if (!keepScroll) body.scrollTop = 0;
  else if (listScroll) body.scrollTop = listScroll;
}

function renderDetail() {
  const p = state.places.find(x => x.id === state.selected);
  if (!p) return showList();
  state.view = 'detail';
  const c = colorFor(p.category);
  const hasCoord = Number.isFinite(p.lat);
  const d = (state.me && hasCoord) ? distance(state.me, p) : null;

  $('#sheetBody').innerHTML = `
    <button class="det-back" id="backBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.6" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>Listeye dön</button>

    <div class="det-top">
      <span class="sq" style="background:${c}22">${pinSvg(c, '')}</span>
      <div><h2>${esc(p.name)}</h2>
        <div class="sub">${esc(p.category)}${d !== null ? ' · ' + fmtDist(d) + ' uzakta' : ''}</div></div>
    </div>

    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}

    ${hasCoord ? `
      <div class="acts">
        <button class="btn naver wide" data-go="transit">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M4 16V6a3 3 0 013-3h10a3 3 0 013 3v10"/>
               <path d="M4 11h16M8 20h8M7.5 16h.01M16.5 16h.01M9 20l-1.5 2M15 20l1.5 2"/></svg>
          Naver ile git (toplu taşıma)</button>
        <button class="btn" data-go="car">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"
               stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M3 17v-4l2-5a2 2 0 012-1.4h10A2 2 0 0119 8l2 5v4"/>
               <path d="M3 13h18M7 17v2M17 17v2"/><circle cx="7.5" cy="13.5" r=".6" fill="currentColor"/>
               <circle cx="16.5" cy="13.5" r=".6" fill="currentColor"/></svg>Araba</button>
        <button class="btn" data-go="walk">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"
               stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="1.8"/>
               <path d="M11 21l1.5-6L9.5 12l1-5 3 1.5 2.5 2.5M10.5 7L7 9.5M12.5 15L15 21"/></svg>Yürüyerek</button>
        <button class="btn ghost wide" data-go="place">Naver'da yeri göster</button>
        ${p.unnamed ? `<button class="btn ghost wide" id="fixOne">Bu noktanın adını OpenStreetMap'te bul</button>` : ''}
      </div>` : `
      <div class="acts">
        <button class="btn naver wide" id="searchNaver">Naver'da adıyla ara</button>
        <button class="btn ghost wide" id="fixOne">Konumunu OpenStreetMap'te bul</button>
      </div>`}

    <dl class="meta">
      ${p.address ? `<div><dt>Adres</dt><dd>${esc(p.address)}</dd></div>` : ''}
      ${p.geocoded ? `<div><dt>Kaynak</dt><dd>OpenStreetMap${p.approx ? ' — <b>yaklaşık konum</b>, Naver’da doğrula' : ''}</dd></div>` : ''}
      ${hasCoord ? `<div><dt>Koordinat</dt><dd class="mono">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</dd></div>` : ''}
      <div><dt>Liste</dt><dd>${esc(p.category)}</dd></div>
    </dl>

    <div class="row-btns">
      ${hasCoord ? `<button class="btn ghost" id="copyCoord">Koordinatı kopyala</button>` : ''}
      <button class="btn ghost" id="googleOpen">Google Maps</button>
    </div>`;
}

function showList() {
  state.selected = null;
  highlightMarker();
  renderList();
}

function selectPlace(id, fromList) {
  state.selected = id;
  const p = state.places.find(x => x.id === id);
  renderDetail();
  highlightMarker();
  if (p && Number.isFinite(p.lat)) {
    setSheet('half');
    /* Pin'i ekranin degil, panelin ustunde kalan gorunur alanin ortasina hizala.
       setView + panBy animasyonlari birbirini kesiyordu; bunun yerine harita
       merkezini dogrudan piksel uzayinda kaydirip tek setView yapiyoruz. */
    const center = () => {
      const z = Math.max(map.getZoom(), 15);
      const visible = window.innerHeight - (sheet.offsetHeight - snap.half);
      const shift = window.innerHeight / 2 - visible / 2;   // pin bu kadar yukari cikmali
      const pt = map.project([p.lat, p.lng], z).add([0, shift]);
      map.setView(map.unproject(pt, z), z, { animate: true });
      highlightMarker();
    };
    const m = markers.get(id);
    // Kume icindeyse once kumeyi ac ki pin gercekten gorunsun.
    if (m && typeof layer.zoomToShowLayer === 'function') layer.zoomToShowLayer(m, center);
    else center();
  } else if (fromList) {
    setSheet('half');
  }
}

/* ================= konum ================= */

let watchId = null, lastFix = null, lastFixAt = 0;
function toggleLocate() {
  const btn = $('#locateBtn');
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null; state.me = null; lastFix = null;
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    btn.classList.remove('on');
    if (state.sort === 'dist') { state.sort = 'name'; save(); }
    render();
    return;
  }
  if (!navigator.geolocation) return toast('Bu tarayıcı konum desteklemiyor.');
  btn.classList.add('on');
  let first = true;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!meMarker) {
        meMarker = L.marker([state.me.lat, state.me.lng], {
          icon: L.divIcon({ html: '<div class="me-dot"></div>', className: '', iconSize: [16, 16] }),
          interactive: false, zIndexOffset: 1000,
        }).addTo(map);
      } else meMarker.setLatLng([state.me.lat, state.me.lng]);
      if (first) {
        first = false;
        map.setView([state.me.lat, state.me.lng], 14);
        state.sort = 'dist'; save();
        toast(inKorea(state.me.lat, state.me.lng) ? 'Konum bulundu — yakınlığa göre sıralandı.'
                                                  : 'Konum bulundu (Kore dışındasın).');
        lastFix = { ...state.me }; lastFixAt = Date.now();
        render();
        return;
      }
      // Her GPS tikinda listeyi bastan kurmak gereksiz: kayda deger bir mesafe
      // yuruyunce ya da en gec 8 sn'de bir yenile.
      const moved = !lastFix || distance(lastFix, state.me) > 25;
      if (moved || Date.now() - lastFixAt > 8000) {
        lastFix = { ...state.me }; lastFixAt = Date.now();
        if (state.view !== 'detail') render();
      }
    },
    () => { btn.classList.remove('on'); watchId = null; toast('Konum alınamadı. İzin verildi mi?'); },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 }
  );
}

/* ================= ice aktarma ================= */

/** DecompressionStream ile minimal ZIP okuyucu (Takeout .zip dosyalari icin). */
async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  // EOCD imzasini sondan ara
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP dizini bulunamadı');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  if (off === 0xffffffff) throw new Error('ZIP64 desteklenmiyor');

  const out = [];
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + cmtLen;

    if (!/\.(csv|json|geojson|kml|gpx)$/i.test(name) || name.includes('__MACOSX')) continue;

    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    let bytes;
    if (method === 0) bytes = raw;
    else if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
    } else continue;
    out.push({ name, text: dec.decode(bytes) });
  }
  return out;
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  let docs = [];
  try {
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        const inner = await readZip(f);
        if (!inner.length) toast(`${f.name} içinde okunabilir dosya yok.`);
        docs.push(...inner);
      } else {
        docs.push({ name: f.name, text: await f.text() });
      }
    }
  } catch (e) {
    return toast('Dosya okunamadı: ' + e.message);
  }

  let found = [];
  for (const d of docs) {
    try { found.push(...parseFile(d.name, d.text)); }
    catch { /* bu dosyayi atla */ }
  }
  if (!found.length) return toast('Bu dosyalarda tanıyabildiğim yer yok.');

  // "Sadece Kore" secili ise yurt disi kayitlari ele. Koordinati olmayanlar
  // nerede oldugu bilinmedigi icin korunur — sonra OSM ile cozulebilirler.
  let skipped = 0;
  if ($('#krOnly').checked) {
    const kept = found.filter(p => !Number.isFinite(p.lat) || inKorea(p.lat, p.lng));
    skipped = found.length - kept.length;
    found = kept;
  }
  if (!found.length) {
    return toast(`Kore'de kayıt bulunamadı (${skipped} yer başka ülkelerde).`, 4200);
  }

  const before = state.places.length;
  state.places = ensureUniqueIds(dedupe([...state.places, ...found]));
  const added = state.places.length - before;
  save();

  $('#scrim').hidden = true;
  state.q = ''; $('#search').value = ''; state.cats.clear();
  render();
  fitAll();
  setSheet('half');

  const noCoord = found.filter(p => !Number.isFinite(p.lat)).length;
  toast(`${added} yer eklendi` +
        (found.length - added ? ` · ${found.length - added} tekrar` : '') +
        (skipped ? ` · ${skipped} Kore dışı atlandı` : '') +
        (noCoord ? ` · ${noCoord} koordinatsız` : ''), 4200);
}

/* ================= OSM ile koordinat bulma ================= */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const needsCoord = (p) => !Number.isFinite(p.lat);
const needsName = (p) => p.unnamed && Number.isFinite(p.lat);
const needsFix = (p) => needsCoord(p) || needsName(p);

async function nom(path) {
  const r = await fetch(NOMINATIM + path, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* Nominatim tam adreslerde sik sik bos doner ("Özlüce, Çiçek Cd. No:49, 16120
   Nilüfer/Bursa" gibi). Kademeli olarak sadelestirilmis sorgular uret. */
function queryVariants(p) {
  const name = p.name === UNNAMED ? '' : p.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const addr = (p.address || '').replace(/\//g, ', ').replace(/\s*,\s*/g, ', ').trim();
  const parts = addr.split(', ').filter(Boolean);
  // Adres zaten isimle basliyorsa tekrar etme
  const head = name && !addr.toLowerCase().startsWith(name.toLowerCase()) ? name + ', ' : '';

  const out = [
    head + addr,
    // ev/kapi numaralarini ve posta kodunu at
    parts.filter(s => !/^(no[:.]?\s*)?\d+([-/]\d+)?$/i.test(s) && !/^\d{4,6}$/.test(s))
         .map(s => s.replace(/\s*no[:.]?\s*\d+([-/]\d+)?/i, '').trim()).join(', '),
    parts.slice(-2).join(', '),   // ilce, sehir
    parts.slice(-1)[0] || '',     // sadece sehir
    name,
  ];
  return [...new Set(out.map(s => s.trim()).filter(s => s.length > 2))];
}

/** Adresten koordinat bul (ileri geocoding). */
async function forwardFix(p) {
  const variants = queryVariants(p);
  for (let i = 0; i < variants.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 1100));  // Nominatim: 1 istek/sn
    let j;
    try { j = await nom('/search?format=jsonv2&limit=1&q=' + encodeURIComponent(variants[i])); }
    catch { continue; }
    if (!j.length) continue;
    p.lat = +j[0].lat; p.lng = +j[0].lon;
    p.geocoded = true;
    p.approx = i > 0;                         // sadelestirilmis sorgu -> yaklasik konum
    if (j[0].display_name) p.address = j[0].display_name;
    return true;
  }
  return false;
}

/** Koordinattan isim/adres bul (ters geocoding) — Takeout'un isimsiz pin'leri icin. */
async function reverseFix(p) {
  const j = await nom(`/reverse?format=jsonv2&zoom=18&lat=${p.lat}&lon=${p.lng}`);
  if (!j || j.error) return false;
  const a = j.address || {};
  const label = j.name ||
    [a.road, a.house_number].filter(Boolean).join(' ') ||
    a.neighbourhood || a.suburb || a.quarter || a.village || a.town || a.city_district;
  if (!label) return false;
  const area = a.suburb || a.town || a.city || a.county || a.state || '';
  p.name = area && !label.includes(area) ? `${label}, ${area}` : label;
  p.unnamed = false;
  p.geocoded = true;
  if (!p.address && j.display_name) p.address = j.display_name;
  return true;
}

let fixing = false;
async function fixPlaces(only) {
  if (fixing) return toast('Zaten çalışıyor…');
  const targets = only ? [only] : state.places.filter(needsFix);
  if (!targets.length) return toast('Düzeltilecek bir şey yok.');
  fixing = true;

  const bar = document.createElement('div');
  bar.className = 'prog';
  bar.innerHTML = '<i></i>';
  $('#sheetBody').prepend(bar);

  let ok = 0;
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    try {
      if (needsCoord(p)) { if (await forwardFix(p)) ok++; }
      else if (needsName(p)) { if (await reverseFix(p)) ok++; }
    } catch { /* bu kaydi atla, akisi bozma */ }
    bar.firstChild.style.width = ((i + 1) / targets.length * 100) + '%';
    // Nominatim kullanim kosulu: saniyede en fazla 1 istek.
    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 1100));
  }

  fixing = false;
  save();
  render();
  toast(`${ok}/${targets.length} kayıt tamamlandı.` +
        (ok < targets.length ? " Kalanları Naver'da elle arayabilirsin." : ''));
}

/* ================= olaylar ================= */

function initEvents() {
  /* Yazarken her harfte tum pin'ler yeniden ciziliyordu (orta seviye telefonda
     ~200 ms takilma). Girdi aninda tepki veriyor, agir kisim geciktiriliyor. */
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    state.q = e.target.value;
    $('#clearBtn').hidden = !state.q;
    if (state.q && snapName === 'peek') setSheet('half');
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (state.view === 'detail') showList(); else render();
    }, 140);
  });
  $('#clearBtn').addEventListener('click', () => {
    state.q = ''; $('#search').value = ''; $('#clearBtn').hidden = true; render();
  });

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const c = b.dataset.cat;
    state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
    if (state.view === 'detail') showList(); else render();
    fitAll();
  });

  $('#locateBtn').addEventListener('click', toggleLocate);
  $('#fitBtn').addEventListener('click', () => { fitAll(); toast('Tüm yerlere yakınlaştırıldı.'); });
  $('#importBtn').addEventListener('click', () => { $('#scrim').hidden = false; });
  $('#closeModal').addEventListener('click', () => { $('#scrim').hidden = true; });
  $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim') $('#scrim').hidden = true; });

  $('#fileInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('#pickBtn').addEventListener('click', () => $('#fileInput').click());
  $('#demoBtn').addEventListener('click', addDemo);
  $('#seedBtn').addEventListener('click', restoreSeed);
  $('#clearAll').addEventListener('click', () => {
    if (!state.places.length) return toast('Zaten boş.');
    if (!confirm(`${state.places.length} yerin tamamı silinsin mi?`)) return;
    state.places = []; state.cats.clear(); state.selected = null;
    save(); render(); toast('Temizlendi.');
  });

  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => importFiles(e.dataTransfer.files));

  // Liste kaydirmasini ayri tut: detaydan geri donunce detayin kaydirmasi degil,
  // listenin birakildigi yer geri gelmeli.
  $('#sheetBody').addEventListener('scroll', (e) => {
    if (state.view === 'list') listScroll = e.target.scrollTop;
  }, { passive: true });

  // panel govdesi — olay delegasyonu
  $('#sheetBody').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) return selectPlace(row.dataset.id, true);

    const id = e.target.id;
    if (id === 'backBtn') return showList();
    if (id === 'sortBtn') {
      const opts = state.me ? ['name', 'dist', 'cat'] : ['name', 'cat'];
      state.sort = opts[(opts.indexOf(state.sort) + 1) % opts.length];
      save(); renderList(); return;
    }
    if (id === 'fixBtn') return fixPlaces();
    if (id === 'openImport') { $('#scrim').hidden = false; return; }
    if (id === 'restoreSeed') return restoreSeed();

    const p = state.places.find(x => x.id === state.selected);
    if (!p) return;

    const go = e.target.closest('[data-go]');
    if (go) {
      const { app, web } = naverLinks(p, go.dataset.go);
      return openNaver(app, web);
    }
    if (id === 'searchNaver') {
      const n = encodeURIComponent(p.name);
      return openNaver(`nmap://search?query=${n}&appname=${APPNAME}`,
                       `https://map.naver.com/p/search/${n}`);
    }
    if (id === 'fixOne') return fixPlaces(p);
    if (id === 'copyCoord') {
      navigator.clipboard.writeText(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)
        .then(() => toast('Koordinat kopyalandı — Naver aramasına yapıştırabilirsin.'))
        .catch(() => toast('Kopyalanamadı.'));
      return;
    }
    if (id === 'googleOpen') {
      const u = p.url || (Number.isFinite(p.lat)
        ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`);
      window.open(u, '_blank', 'noopener');
    }
  });
}

function addDemo() {
  const now = DEMO.map((d, i) => ({
    id: 'demo' + i, name: d.name, note: d.note || '', address: '',
    category: d.category, lat: d.lat, lng: d.lng, url: '', geocoded: false,
  }));
  state.places = ensureUniqueIds(dedupe([...state.places, ...now]));
  save();
  $('#scrim').hidden = true;
  render(); fitAll(); setSheet('half');
  toast('Demo veri yüklendi.');
}

/* ================= gomulu liste ================= */

/* data/places.json uygulamayla birlikte geliyor — Google Takeout'tan cozulmus
   Kore listeleri. Ilk aciliste (ve surum degistiginde) otomatik yuklenir.
   "Tumunu sil" surumu koruyor, boylece silinen liste kendiliginden geri gelmez. */
const SEED_URL = './data/places.json';
const SEED_KEY = 'koremap.seed.v1';

async function restoreSeed() {
  const n = await loadSeed(true);
  $('#scrim').hidden = true;
  state.q = ''; $('#search').value = ''; $('#clearBtn').hidden = true;
  state.cats.clear();
  render();
  if (n) { fitAll(); setSheet('peek'); }
  toast(n ? `${n} yer geri yüklendi.` : 'Kayıtlı listedeki her şey zaten ekli.');
}

async function loadSeed(force = false) {
  let data;
  try {
    const r = await fetch(SEED_URL, { cache: 'no-cache' });
    if (!r.ok) return 0;
    data = await r.json();
  } catch { return 0; }
  if (!data || !Array.isArray(data.places) || !data.places.length) return 0;

  const ver = String(data.version ?? '1');
  if (!force && localStorage.getItem(SEED_KEY) === ver) return 0;

  const before = state.places.length;
  state.places = ensureUniqueIds(dedupe([...state.places, ...data.places]));
  try { localStorage.setItem(SEED_KEY, ver); } catch { /* onemli degil */ }
  save();
  return state.places.length - before;
}

/* ================= baslangic ================= */

load();
initMap();
initSheetDrag();
initEvents();
render();
setSheet(state.places.length ? 'peek' : 'half', false);
if (state.places.length) fitAll();

(async () => {
  const added = await loadSeed();
  if (added) {
    render();
    fitAll();
    setSheet('peek');
    toast(`${added} kayıtlı Kore yeri yüklendi.`, 3200);
  } else if (!state.places.length) {
    $('#scrim').hidden = false;   // gomulu liste yoksa ice aktarmayi teklif et
  }
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* onemli degil */ });
}
