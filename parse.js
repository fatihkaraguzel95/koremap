/* parse.js — Google Maps / Takeout ciktilarini {name,lat,lng,...} listesine cevirir.
   Desteklenen: Saved Places.json (GeoJSON), liste CSV'leri, KML, GPX, duz JSON dizisi. */

/* ---------- yardimcilar ---------- */

const KR_BOUNDS = { minLat: 32.5, maxLat: 39.6, minLng: 124.0, maxLng: 132.5 };

export const inKorea = (lat, lng) =>
  lat >= KR_BOUNDS.minLat && lat <= KR_BOUNDS.maxLat &&
  lng >= KR_BOUNDS.minLng && lng <= KR_BOUNDS.maxLng;

/** RFC4180 uyumlu, tirnak icinde virgul/newline destekleyen CSV ayristirici. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

/* Google Maps URL'lerinden koordinat cikarma. Sira onemli:
   !3d!4d gercek mekan noktasi, @ ise sadece kamera merkezi. */
const COORD_RX = [
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|ll|center|sll|daddr|saddr|destination)=(?:loc:)?(-?\d{1,3}\.\d+)%2C\s*(-?\d{1,3}\.\d+)/i,
  /[?&](?:q|ll|center|sll|daddr|saddr|destination)=(?:loc:)?(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/i,
  /[@/](-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/,
];

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function coordsFromUrl(url) {
  if (!url) return null;
  const dec = safeDecode(url);
  for (const src of [url, dec]) {
    for (const rx of COORD_RX) {
      const m = src.match(rx);
      if (!m) continue;
      const lat = +m[1], lng = +m[2];
      if (Number.isFinite(lat) && Number.isFinite(lng) &&
          Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) {
        return { lat, lng };
      }
    }
  }
  return null;
}

/** `?q=` koordinat degil de adres tasiyorsa onu dondur (Takeout'ta cok yaygin). */
export function addressFromUrl(url) {
  if (!url) return '';
  const m = url.match(/[?&]q=([^&]+)/);
  if (!m) return '';
  const v = safeDecode(m[1].replace(/\+/g, ' ')).trim();
  if (!v || /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(v)) return '';
  return v;
}

/** Nesnede, adi verilen anahtarlardan ilk dolu olani (buyuk/kucuk harf duyarsiz). */
function pick(obj, ...names) {
  if (!obj || typeof obj !== 'object') return '';
  const map = {};
  for (const k of Object.keys(obj)) map[k.toLowerCase().replace(/[\s_]/g, '')] = obj[k];
  for (const n of names) {
    const v = map[n.toLowerCase().replace(/[\s_]/g, '')];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

export const UNNAMED = 'İsimsiz yer';

let seq = 0;
const mk = (o) => ({
  id: 'p' + (++seq) + '-' + Math.random().toString(36).slice(2, 7),
  name: (o.name || '').trim() || UNNAMED,
  unnamed: !(o.name || '').trim(),
  note: (o.note || '').trim(),
  address: (o.address || '').trim(),
  category: (o.category || 'Genel').trim(),
  lat: Number.isFinite(o.lat) ? o.lat : null,
  lng: Number.isFinite(o.lng) ? o.lng : null,
  url: (o.url || '').trim(),
  geocoded: !!o.geocoded,
});

/* ---------- format ayristiricilari ---------- */

function fromGeoJSON(data, category) {
  const feats = Array.isArray(data) ? data : (data.features || []);
  const out = [];
  for (const f of feats) {
    const props = f.properties || f.Properties || f;
    const loc = pick(props, 'location', 'Location') || {};
    const geo = pick(loc, 'geocoordinates', 'Geo Coordinates') || {};

    let lat = null, lng = null;
    // Takeout, konumu bilinmeyen kayitlar icin [0,0] yazar — bunu "yok" say.
    const c = f.geometry && f.geometry.coordinates;
    if (Array.isArray(c) && c.length >= 2 && (+c[0] || +c[1])) { lng = +c[0]; lat = +c[1]; }
    if (!Number.isFinite(lat)) {
      const la = pick(geo, 'latitude', 'lat'), ln = pick(geo, 'longitude', 'lng', 'lon');
      if (la !== '' && ln !== '' && (+la || +ln)) { lat = +la; lng = +ln; }
    }

    const url = String(pick(props, 'googlemapsurl', 'Google Maps URL', 'url') || '');
    if (!Number.isFinite(lat)) {
      const fromUrl = coordsFromUrl(url);
      if (fromUrl) ({ lat, lng } = fromUrl);
    }

    // Adres: once acik alan, yoksa URL'deki ?q=<adres>
    const urlAddr = addressFromUrl(url);
    const address = String(pick(loc, 'address', 'Address') || pick(props, 'address') || '') || urlAddr;

    // Isim: mekan adi > URL'deki adresin ilk anlamli parcasi > adres
    let name = String(pick(loc, 'name', 'Business Name', 'businessname') ||
                      pick(props, 'name', 'title', 'Title') || '');
    if (!name && urlAddr) name = urlAddr.split(',')[0].trim();
    if (!name && address) name = address.split(',')[0].trim();

    // "No location information..." bir not degil, bir durum bildirimi — nota tasima.
    let note = String(pick(props, 'comment', 'Comment', 'note', 'Note', 'description') || '');
    if (/^no location information/i.test(note)) note = '';

    out.push(mk({ name, address, note, category, url, lat, lng }));
  }
  return out;
}

function fromCSV(text, category) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const idx = (...names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iName = idx('title', 'name', 'başlık', 'baslik', 'ad', 'i̇sim', 'isim', 'place');
  const iUrl  = idx('url', 'google maps url', 'link', 'bağlantı', 'baglanti');
  const iNote = idx('note', 'comment', 'notlar', 'not', 'yorum', 'açıklama', 'aciklama', 'description');
  const iAddr = idx('address', 'adres', 'formatted address');
  const iLat  = idx('latitude', 'lat', 'enlem');
  const iLng  = idx('longitude', 'lng', 'lon', 'boylam');
  // Basliksiz/tanimsiz CSV: ilk sutunu isim varsay
  const nameCol = iName === -1 ? 0 : iName;
  const start = (iName === -1 && iUrl === -1 && iLat === -1) ? 0 : 1;

  const out = [];
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    const at = i => (i >= 0 && i < row.length ? String(row[i]).trim() : '');
    const url = at(iUrl);
    let lat = null, lng = null;
    if (iLat >= 0 && at(iLat)) { lat = +at(iLat); lng = +at(iLng); }
    if (!Number.isFinite(lat)) {
      const c = coordsFromUrl(url);
      if (c) ({ lat, lng } = c);
    }
    const name = at(nameCol);
    if (!name && !url) continue;
    out.push(mk({ name, url, note: at(iNote), address: at(iAddr), category, lat, lng }));
  }
  return out;
}

function fromXML(text, category) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const out = [];
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : ''; };

  // KML
  for (const pm of doc.querySelectorAll('Placemark')) {
    const co = txt(pm, 'Point > coordinates') || txt(pm, 'coordinates');
    if (!co) continue;
    const [lng, lat] = co.split(/[,\s]+/).map(Number);
    if (!Number.isFinite(lat)) continue;
    const folder = pm.closest('Folder');
    out.push(mk({
      name: txt(pm, 'name'),
      note: txt(pm, 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      category: (folder && txt(folder, ':scope > name')) || category,
      lat, lng,
    }));
  }
  // GPX
  for (const wp of doc.querySelectorAll('wpt')) {
    const lat = +wp.getAttribute('lat'), lng = +wp.getAttribute('lon');
    if (!Number.isFinite(lat)) continue;
    out.push(mk({ name: txt(wp, 'name'), note: txt(wp, 'desc'), category, lat, lng }));
  }
  return out;
}

/* ---------- genel giris noktasi ---------- */

/** Dosya adindan makul bir kategori/liste adi uret. */
export function categoryFromFilename(filename) {
  let n = filename.replace(/\.[^.]+$/, '').replace(/^.*[\\/]/, '');
  const known = {
    'saved places': 'Yıldızlı', 'starred places': 'Yıldızlı',
    'want to go': 'Gitmek İstediklerim', 'favorite places': 'Favoriler',
    'favourite places': 'Favoriler', 'labeled places': 'Etiketli',
  };
  const low = n.toLowerCase();
  for (const k in known) if (low.includes(k)) return known[k];
  return n.replace(/[_-]+/g, ' ').trim() || 'Genel';
}

/** Tek bir dosyanin metnini ayristirir. */
export function parseFile(filename, text) {
  const category = categoryFromFilename(filename);
  const ext = (filename.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const head = text.slice(0, 400).trim();

  if (ext === 'json' || ext === 'geojson' || head.startsWith('{') || head.startsWith('[')) {
    try { return fromGeoJSON(JSON.parse(text), category); } catch { /* csv olarak dene */ }
  }
  if (ext === 'kml' || ext === 'gpx' || ext === 'xml' || head.startsWith('<')) {
    return fromXML(text, category);
  }
  return fromCSV(text, category);
}

const normName = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ayni yeri iki kez eklememek icin: koordinat + isim.
   Koordinat 5 haneye (~1 m) bakiyor ve isim de anahtara giriyor; aksi halde
   ayni binadaki iki ayri mekan (ust kattaki mescit ile marketi gibi) tek
   kayda dusuyordu. Ayni yer iki listede duruyorsa yine tek kalir. */
export function dedupe(places) {
  const seen = new Set(), out = [];
  for (const p of places) {
    const key = Number.isFinite(p.lat)
      ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}|${normName(p.name)}`
      : 'n:' + normName(p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
