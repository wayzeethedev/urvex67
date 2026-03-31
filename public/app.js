/* ═══════════════════════════════════════════
   URBEX·DB — app.js
   ═══════════════════════════════════════════ */

'use strict';

// ─── CONFIG ───────────────────────────────────
const API_BASE = '/api';
const CACHE_KEY = 'urbex_locations_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// ─── STATE ────────────────────────────────────
let map, clusterGroup;
let locations = [];         // master array
let markerMap = {};         // id → leaflet marker
let currentLocationId = null;
let isAddMode = false;
let searchQuery = '';
let editingId = null;       // non-null when editing

// ─── CACHE ────────────────────────────────────
const Cache = {
  get() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return null;
      return data;
    } catch { return null; }
  },
  set(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
  },
  clear() { try { localStorage.removeItem(CACHE_KEY); } catch {} },
  patch(updatedLoc) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      obj.data = obj.data.map(l => l._id === updatedLoc._id ? updatedLoc : l);
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch {}
  },
  remove(id) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      obj.data = obj.data.filter(l => l._id !== id);
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch {}
  },
  add(loc) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      obj.data.push(loc);
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch {}
  }
};

// ─── API ──────────────────────────────────────
const Api = {
  async get(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
    return res.json();
  },
  async delete(path) {
    const res = await fetch(API_BASE + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  }
};

// ─── TOAST ────────────────────────────────────
function toast(msg, type = 'info', duration = 2800) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ─── MODAL HELPERS ────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById(id).addEventListener('mousedown', function outsideClose(e) {
    if (e.target === this) { closeModal(id); this.removeEventListener('mousedown', outsideClose); }
  });
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ─── MARKER ICONS ─────────────────────────────
function createIcon(visited) {
  return L.divIcon({
    html: `<div class="urbex-marker ${visited ? 'visited' : 'unvisited'}"></div>`,
    iconSize: [28, 28],
    iconAnchor: [8, 28],
    popupAnchor: [6, -28],
    className: ''
  });
}

// ─── MAP INIT ─────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 5);

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  });
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri', maxZoom: 19 }
  );

  osmLayer.addTo(map);

  L.control.layers(
    { 'Street Map': osmLayer, 'Satellite': satelliteLayer },
    {},
    { position: 'topright' }
  ).addTo(map);

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  clusterGroup = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
  map.addLayer(clusterGroup);

  // Add mode click
  map.on('click', e => {
    if (!isAddMode) return;
    exitAddMode();
    openFormModal(null, e.latlng.lat, e.latlng.lng);
  });
}

// ─── RENDER MARKERS ───────────────────────────
function renderMarkers() {
  clusterGroup.clearLayers();
  markerMap = {};

  locations.forEach(loc => {
    const marker = L.marker([loc.latitude, loc.longitude], { icon: createIcon(loc.visited) });
    marker.on('click', () => openDetailModal(loc._id));
    markerMap[loc._id] = marker;
    clusterGroup.addLayer(marker);
  });
  updateCount();
}

function updateMarkerIcon(id) {
  const loc = locations.find(l => l._id === id);
  if (!loc || !markerMap[id]) return;
  markerMap[id].setIcon(createIcon(loc.visited));
}

function updateCount() {
  document.getElementById('location-count').textContent =
    `${locations.length} site${locations.length !== 1 ? 's' : ''}`;
}

// ─── LOAD LOCATIONS ───────────────────────────
async function loadLocations() {
  const overlay = document.getElementById('loading-overlay');

  const cached = Cache.get();
  if (cached) {
    locations = cached;
    renderMarkers();
    overlay.classList.add('hidden');
    // Background refresh
    fetchAndRefresh();
    return;
  }

  try {
    const data = await Api.get('/locations');
    locations = data;
    Cache.set(data);
    renderMarkers();
  } catch (err) {
    toast('Failed to load locations', 'error');
    console.error(err);
  } finally {
    overlay.classList.add('hidden');
  }
}

async function fetchAndRefresh() {
  try {
    const data = await Api.get('/locations');
    locations = data;
    Cache.set(data);
    renderMarkers();
  } catch (err) {
    console.warn('Background refresh failed:', err);
  }
}

// ─── ADD MODE ─────────────────────────────────
function enterAddMode() {
  isAddMode = true;
  document.getElementById('map').classList.add('add-mode');
  document.getElementById('add-mode-banner').classList.remove('hidden');
  document.getElementById('fab-add').classList.add('active-mode');
}
function exitAddMode() {
  isAddMode = false;
  document.getElementById('map').classList.remove('add-mode');
  document.getElementById('add-mode-banner').classList.add('hidden');
  document.getElementById('fab-add').classList.remove('active-mode');
}

// ─── FORM MODAL ───────────────────────────────
function openFormModal(id = null, lat = '', lng = '') {
  editingId = id;
  const title = document.getElementById('form-modal-title');
  const submitBtn = document.getElementById('form-submit');

  if (id) {
    const loc = locations.find(l => l._id === id);
    if (!loc) return;
    title.textContent = 'EDIT LOCATION';
    submitBtn.textContent = 'Save Changes';
    document.getElementById('f-title').value = loc.title || '';
    document.getElementById('f-desc').value = loc.description || '';
    document.getElementById('f-image').value = loc.imageUrl || '';
    document.getElementById('f-lat').value = loc.latitude || '';
    document.getElementById('f-lng').value = loc.longitude || '';
  } else {
    title.textContent = 'ADD LOCATION';
    submitBtn.textContent = 'Save Location';
    document.getElementById('f-title').value = '';
    document.getElementById('f-desc').value = '';
    document.getElementById('f-image').value = '';
    document.getElementById('f-lat').value = lat !== '' ? Number(lat).toFixed(6) : '';
    document.getElementById('f-lng').value = lng !== '' ? Number(lng).toFixed(6) : '';
  }

  openModal('form-modal');
}

async function handleFormSubmit() {
  const title = document.getElementById('f-title').value.trim();
  const description = document.getElementById('f-desc').value.trim();
  const imageUrl = document.getElementById('f-image').value.trim();
  const latitude = parseFloat(document.getElementById('f-lat').value);
  const longitude = parseFloat(document.getElementById('f-lng').value);

  if (!title) { toast('Title is required', 'error'); return; }
  if (isNaN(latitude) || isNaN(longitude)) { toast('Valid coordinates required', 'error'); return; }

  const btn = document.getElementById('form-submit');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if (editingId) {
      const updated = await Api.patch(`/locations/${editingId}`, { title, description, imageUrl, latitude, longitude });
      const idx = locations.findIndex(l => l._id === editingId);
      if (idx !== -1) locations[idx] = updated;
      Cache.patch(updated);
      updateMarkerIcon(editingId);
      // Update position if coords changed
      if (markerMap[editingId]) markerMap[editingId].setLatLng([updated.latitude, updated.longitude]);
      toast('Location updated', 'success');
      closeModal('form-modal');
      openDetailModal(editingId);
    } else {
      const created = await Api.post('/locations', { title, description, imageUrl, latitude, longitude });
      locations.push(created);
      Cache.add(created);
      const marker = L.marker([created.latitude, created.longitude], { icon: createIcon(created.visited) });
      marker.on('click', () => openDetailModal(created._id));
      markerMap[created._id] = marker;
      clusterGroup.addLayer(marker);
      updateCount();
      toast('Location saved', 'success');
      map.flyTo([created.latitude, created.longitude], 14, { duration: 0.8 });
      closeModal('form-modal');
      openDetailModal(created._id);
    }
  } catch (err) {
    toast('Failed to save location', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? 'Save Changes' : 'Save Location';
  }
}

// ─── DETAIL MODAL ─────────────────────────────
function openDetailModal(id) {
  const loc = locations.find(l => l._id === id);
  if (!loc) return;
  currentLocationId = id;

  // Image
  const wrap = document.getElementById('detail-image-wrap');
  const img = document.getElementById('detail-image');
  if (loc.imageUrl) {
    img.src = loc.imageUrl;
    img.onerror = () => { wrap.classList.add('no-image'); };
    wrap.classList.remove('no-image');
    wrap.style.display = '';
  } else {
    wrap.classList.add('no-image');
    wrap.style.display = 'none';
  }

  document.getElementById('detail-title').textContent = loc.title || 'Untitled';
  document.getElementById('detail-desc').textContent = loc.description || 'No description.';
  document.getElementById('detail-coords').textContent =
    `${Number(loc.latitude).toFixed(6)}, ${Number(loc.longitude).toFixed(6)}`;

  const badge = document.getElementById('detail-visited-badge');
  const toggleBtn = document.getElementById('detail-visited-toggle');
  if (loc.visited) {
    badge.textContent = 'VISITED';
    badge.className = 'visited-badge visited';
    toggleBtn.textContent = 'Mark as Unvisited';
  } else {
    badge.textContent = 'UNVISITED';
    badge.className = 'visited-badge unvisited';
    toggleBtn.textContent = 'Mark as Visited';
  }

  openModal('detail-modal');
}

async function toggleVisited() {
  const loc = locations.find(l => l._id === currentLocationId);
  if (!loc) return;

  const btn = document.getElementById('detail-visited-toggle');
  btn.disabled = true;

  try {
    const updated = await Api.patch(`/locations/${currentLocationId}`, { visited: !loc.visited });
    const idx = locations.findIndex(l => l._id === currentLocationId);
    if (idx !== -1) locations[idx] = updated;
    Cache.patch(updated);
    updateMarkerIcon(currentLocationId);
    openDetailModal(currentLocationId); // re-render detail
    toast(updated.visited ? 'Marked as visited ✓' : 'Marked as unvisited', 'success');
  } catch (err) {
    toast('Update failed', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// ─── DELETE ───────────────────────────────────
function promptDelete() {
  openModal('confirm-modal');
}

async function confirmDelete() {
  closeModal('confirm-modal');
  const id = currentLocationId;

  try {
    await Api.delete(`/locations/${id}`);
    locations = locations.filter(l => l._id !== id);
    Cache.remove(id);
    if (markerMap[id]) {
      clusterGroup.removeLayer(markerMap[id]);
      delete markerMap[id];
    }
    updateCount();
    closeModal('detail-modal');
    toast('Location deleted', 'info');
  } catch (err) {
    toast('Delete failed', 'error');
    console.error(err);
  }
}

// ─── SEARCH ───────────────────────────────────
const debounce = (fn, delay) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
};

function applySearch(query) {
  searchQuery = query.toLowerCase().trim();
  const clearBtn = document.getElementById('search-clear');
  clearBtn.style.display = searchQuery ? '' : 'none';

  if (!searchQuery) {
    // Show all
    Object.values(markerMap).forEach(m => {
      const el = m.getElement();
      if (el) el.classList.remove('dimmed');
    });
    return;
  }

  const matched = locations.filter(l => l.title.toLowerCase().includes(searchQuery));
  const matchedIds = new Set(matched.map(l => l._id));

  Object.entries(markerMap).forEach(([id, marker]) => {
    const el = marker.getElement();
    if (!el) return;
    if (matchedIds.has(id)) {
      el.classList.remove('dimmed');
    } else {
      el.classList.add('dimmed');
    }
  });

  // Pan to first result
  if (matched.length === 1) {
    map.flyTo([matched[0].latitude, matched[0].longitude], 14, { duration: 0.6 });
  }
}

// ─── LOCATE ME ────────────────────────────────
function locateMe() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => map.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 0.8 }),
    () => toast('Could not get location', 'error')
  );
}

// ─── MAPS LINKS ───────────────────────────────
function openAppleMaps() {
  const loc = locations.find(l => l._id === currentLocationId);
  if (!loc) return;
  window.open(`https://maps.apple.com/?ll=${loc.latitude},${loc.longitude}&q=${encodeURIComponent(loc.title)}`, '_blank');
}
function openGoogleMaps() {
  const loc = locations.find(l => l._id === currentLocationId);
  if (!loc) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`, '_blank');
}

// ─── LIGHTBOX ─────────────────────────────────
function openLightbox(src) {
  if (!src) return;
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
}

// ─── CLOSE MODAL DELEGATE ─────────────────────
document.addEventListener('click', e => {
  if (e.target.dataset.close) closeModal(e.target.dataset.close);
});

// ─── KEYBOARD ─────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!document.getElementById('lightbox').classList.contains('hidden')) { closeLightbox(); return; }
    if (!document.getElementById('confirm-modal').classList.contains('hidden')) { closeModal('confirm-modal'); return; }
    if (!document.getElementById('detail-modal').classList.contains('hidden')) { closeModal('detail-modal'); return; }
    if (!document.getElementById('form-modal').classList.contains('hidden')) { closeModal('form-modal'); return; }
    if (isAddMode) exitAddMode();
  }
});

// ─── EVENT BINDINGS ───────────────────────────
document.getElementById('fab-add').addEventListener('click', () => {
  if (isAddMode) { exitAddMode(); } else { enterAddMode(); }
});
document.getElementById('cancel-add-mode').addEventListener('click', exitAddMode);
document.getElementById('locate-btn').addEventListener('click', locateMe);

document.getElementById('form-submit').addEventListener('click', handleFormSubmit);
document.getElementById('form-cancel').addEventListener('click', () => closeModal('form-modal'));

document.getElementById('detail-visited-toggle').addEventListener('click', toggleVisited);
document.getElementById('detail-edit').addEventListener('click', () => {
  closeModal('detail-modal');
  openFormModal(currentLocationId);
});
document.getElementById('detail-delete').addEventListener('click', promptDelete);

document.getElementById('open-apple-maps').addEventListener('click', openAppleMaps);
document.getElementById('open-google-maps').addEventListener('click', openGoogleMaps);

document.getElementById('detail-image-wrap').addEventListener('click', () => {
  const src = document.getElementById('detail-image').src;
  if (src) openLightbox(src);
});

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);

document.getElementById('confirm-ok').addEventListener('click', confirmDelete);
document.getElementById('confirm-cancel').addEventListener('click', () => closeModal('confirm-modal'));

const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', debounce(e => applySearch(e.target.value), 220));
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const query = e.target.value.toLowerCase().trim();
    if (!query) return;
    const first = locations.find(l => l.title.toLowerCase().includes(query));
    if (first) map.flyTo([first.latitude, first.longitude], 14, { duration: 0.7 });
  }
});
document.getElementById('search-clear').addEventListener('click', () => {
  searchInput.value = '';
  applySearch('');
});

// ─── INIT ─────────────────────────────────────
(async function init() {
  initMap();
  await loadLocations();
})();
