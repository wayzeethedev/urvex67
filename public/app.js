/* ═══════════════════════════════════════════
   URBEX·DB — app.js (FIXED)
   ═══════════════════════════════════════════ */

'use strict';

// ─── CONFIG ───────────────────────────────────
const API_BASE = '/api';
const CACHE_KEY = 'urbex_locations_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// ─── STATE ────────────────────────────────────
let map;
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
      // Make sure we're not adding duplicates
      if (!obj.data.some(l => l._id === loc._id)) {
        obj.data.push(loc);
        localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
      }
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
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`PATCH ${path} failed: ${res.status} - ${errorText}`);
    }
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
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.addEventListener('mousedown', function outsideClose(e) {
    if (e.target === this) { 
      closeModal(id); 
      this.removeEventListener('mousedown', outsideClose); 
    }
  });
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

// ─── MARKER ICONS (BETTER STYLING) ─────────────────────────────
function createIcon(visited) {
  return L.divIcon({
    html: `
      <div class="urbex-marker ${visited ? 'visited' : 'unvisited'}">
        <div class="marker-pulse"></div>
        <div class="marker-core"></div>
        <div class="marker-shadow"></div>
      </div>
    `,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    popupAnchor: [0, -38],
    className: 'custom-marker'
  });
}

// ─── MAP INIT ─────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([45.0, -93.0], 8);

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

  // Add mode click
  map.on('click', e => {
    if (!isAddMode) return;
    exitAddMode();
    openFormModal(null, e.latlng.lat, e.latlng.lng);
  });
}

// ─── RENDER MARKERS (NO CLUSTERING) ───────────────────────────
function renderMarkers() {
  // Clear existing markers from map
  Object.values(markerMap).forEach(marker => {
    map.removeLayer(marker);
  });
  markerMap = {};

  locations.forEach(loc => {
    const marker = L.marker([loc.latitude, loc.longitude], { icon: createIcon(loc.visited) });
    marker.on('click', () => openDetailModal(loc._id));
    marker.on('mouseover', () => {
      marker.bindTooltip(loc.title, { 
        permanent: false, 
        direction: 'top',
        offset: [0, -20],
        className: 'marker-tooltip'
      }).openTooltip();
    });
    markerMap[loc._id] = marker;
    marker.addTo(map);
  });
  updateCount();
}

function updateMarkerIcon(id) {
  const loc = locations.find(l => l._id === id);
  if (!loc || !markerMap[id]) return;
  markerMap[id].setIcon(createIcon(loc.visited));
}

function updateCount() {
  const countEl = document.getElementById('location-count');
  if (countEl) {
    countEl.textContent = `${locations.length} site${locations.length !== 1 ? 's' : ''}`;
  }
}

// ─── LOAD LOCATIONS ───────────────────────────
async function loadLocations() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('hidden');

  const cached = Cache.get();
  if (cached) {
    locations = cached;
    renderMarkers();
    if (overlay) overlay.classList.add('hidden');
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
    if (overlay) overlay.classList.add('hidden');
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
  const mapEl = document.getElementById('map');
  const banner = document.getElementById('add-mode-banner');
  const fab = document.getElementById('fab-add');
  if (mapEl) mapEl.classList.add('add-mode');
  if (banner) banner.classList.remove('hidden');
  if (fab) fab.classList.add('active-mode');
}
function exitAddMode() {
  isAddMode = false;
  const mapEl = document.getElementById('map');
  const banner = document.getElementById('add-mode-banner');
  const fab = document.getElementById('fab-add');
  if (mapEl) mapEl.classList.remove('add-mode');
  if (banner) banner.classList.add('hidden');
  if (fab) fab.classList.remove('active-mode');
}

// ─── FORM MODAL ───────────────────────────────
function openFormModal(id = null, lat = '', lng = '') {
  editingId = id;
  const title = document.getElementById('form-modal-title');
  const submitBtn = document.getElementById('form-submit');

  if (id) {
    const loc = locations.find(l => l._id === id);
    if (!loc) {
      toast('Location not found', 'error');
      return;
    }
    if (title) title.textContent = 'EDIT LOCATION';
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    const fTitle = document.getElementById('f-title');
    const fDesc = document.getElementById('f-desc');
    const fImage = document.getElementById('f-image');
    const fLat = document.getElementById('f-lat');
    const fLng = document.getElementById('f-lng');
    if (fTitle) fTitle.value = loc.title || '';
    if (fDesc) fDesc.value = loc.description || '';
    if (fImage) fImage.value = loc.imageUrl || '';
    if (fLat) fLat.value = loc.latitude || '';
    if (fLng) fLng.value = loc.longitude || '';
  } else {
    if (title) title.textContent = 'ADD LOCATION';
    if (submitBtn) submitBtn.textContent = 'Save Location';
    const fTitle = document.getElementById('f-title');
    const fDesc = document.getElementById('f-desc');
    const fImage = document.getElementById('f-image');
    const fLat = document.getElementById('f-lat');
    const fLng = document.getElementById('f-lng');
    if (fTitle) fTitle.value = '';
    if (fDesc) fDesc.value = '';
    if (fImage) fImage.value = '';
    if (fLat) fLat.value = lat !== '' ? Number(lat).toFixed(6) : '';
    if (fLng) fLng.value = lng !== '' ? Number(lng).toFixed(6) : '';
  }

  openModal('form-modal');
}

async function handleFormSubmit() {
  const title = document.getElementById('f-title')?.value.trim();
  const description = document.getElementById('f-desc')?.value.trim();
  const imageUrl = document.getElementById('f-image')?.value.trim();
  const latitude = parseFloat(document.getElementById('f-lat')?.value);
  const longitude = parseFloat(document.getElementById('f-lng')?.value);

  if (!title) { toast('Title is required', 'error'); return; }
  if (isNaN(latitude) || isNaN(longitude)) { toast('Valid coordinates required', 'error'); return; }

  const btn = document.getElementById('form-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    if (editingId) {
      const updated = await Api.patch(`/locations/${editingId}`, { title, description, imageUrl, latitude, longitude });
      const idx = locations.findIndex(l => l._id === editingId);
      if (idx !== -1) locations[idx] = updated;
      Cache.patch(updated);
      updateMarkerIcon(editingId);
      // Update position if coords changed
      if (markerMap[editingId]) markerMap[editingId].setLatLng([updated.latitude, updated.longitude]);
      
      // Update currentLocationId if this is the currently open location
      if (currentLocationId === editingId) {
        currentLocationId = updated._id;
      }
      
      toast('Location updated', 'success');
      closeModal('form-modal');
      openDetailModal(editingId);
    } else {
      const created = await Api.post('/locations', { title, description, imageUrl, latitude, longitude });
      locations.push(created);
      Cache.add(created);
      const marker = L.marker([created.latitude, created.longitude], { icon: createIcon(created.visited) });
      marker.on('click', () => openDetailModal(created._id));
      marker.on('mouseover', () => {
        marker.bindTooltip(created.title, { 
          permanent: false, 
          direction: 'top',
          offset: [0, -20],
          className: 'marker-tooltip'
        }).openTooltip();
      });
      markerMap[created._id] = marker;
      marker.addTo(map);
      updateCount();
      toast('Location saved', 'success');
      if (map) map.flyTo([created.latitude, created.longitude], 14, { duration: 0.8 });
      closeModal('form-modal');
      openDetailModal(created._id);
    }
  } catch (err) {
    toast('Failed to save location', 'error');
    console.error(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = editingId ? 'Save Changes' : 'Save Location';
    }
  }
}

// ─── DETAIL MODAL ─────────────────────────────
function openDetailModal(id) {
  // Find location using the provided ID
  const loc = locations.find(l => l._id === id);
  if (!loc) {
    console.error('Location not found for ID:', id);
    console.log('Available locations:', locations.map(l => ({ _id: l._id, title: l.title })));
    toast('Location not found. Please refresh the page.', 'error');
    return;
  }
  
  // Store the actual location ID (use the one from the location object to ensure consistency)
  currentLocationId = loc._id;
  
  // Image
  const wrap = document.getElementById('detail-image-wrap');
  const img = document.getElementById('detail-image');
  if (wrap && img) {
    if (loc.imageUrl && loc.imageUrl.trim()) {
      img.src = loc.imageUrl;
      img.onerror = () => { 
        if (wrap) wrap.classList.add('no-image'); 
      };
      wrap.classList.remove('no-image');
      wrap.style.display = '';
    } else {
      wrap.classList.add('no-image');
      wrap.style.display = 'none';
    }
  }

  const titleEl = document.getElementById('detail-title');
  const descEl = document.getElementById('detail-desc');
  const coordsEl = document.getElementById('detail-coords');
  
  if (titleEl) titleEl.textContent = loc.title || 'Untitled';
  if (descEl) descEl.textContent = loc.description || 'No description.';
  if (coordsEl) coordsEl.textContent = `${Number(loc.latitude).toFixed(6)}, ${Number(loc.longitude).toFixed(6)}`;

  const badge = document.getElementById('detail-visited-badge');
  const toggleBtn = document.getElementById('detail-visited-toggle');
  if (badge && toggleBtn) {
    if (loc.visited) {
      badge.textContent = 'VISITED';
      badge.className = 'visited-badge visited';
      toggleBtn.textContent = 'Mark as Unvisited';
    } else {
      badge.textContent = 'UNVISITED';
      badge.className = 'visited-badge unvisited';
      toggleBtn.textContent = 'Mark as Visited';
    }
  }

  openModal('detail-modal');
}

async function toggleVisited() {
  // Validate currentLocationId exists
  if (!currentLocationId) {
    toast('No location selected', 'error');
    console.error('currentLocationId is null');
    return;
  }
  
  const loc = locations.find(l => l._id === currentLocationId);
  if (!loc) {
    toast('Location not found. Please refresh the page.', 'error');
    console.error('Location not found with ID:', currentLocationId);
    console.log('Available location IDs:', locations.map(l => l._id));
    return;
  }

  const btn = document.getElementById('detail-visited-toggle');
  if (btn) btn.disabled = true;

  try {
    const updated = await Api.patch(`/locations/${currentLocationId}`, { visited: !loc.visited });
    const idx = locations.findIndex(l => l._id === currentLocationId);
    if (idx !== -1) locations[idx] = updated;
    Cache.patch(updated);
    updateMarkerIcon(currentLocationId);
    openDetailModal(currentLocationId); // re-render detail
    toast(updated.visited ? 'Marked as visited ✓' : 'Marked as unvisited', 'success');
  } catch (err) {
    toast('Update failed: ' + err.message, 'error');
    console.error('Error updating visited status:', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── DELETE ───────────────────────────────────
function promptDelete() {
  openModal('confirm-modal');
}

async function confirmDelete() {
  closeModal('confirm-modal');
  const id = currentLocationId;

  if (!id) {
    toast('No location selected', 'error');
    return;
  }

  try {
    await Api.delete(`/locations/${id}`);
    locations = locations.filter(l => l._id !== id);
    Cache.remove(id);
    if (markerMap[id]) {
      map.removeLayer(markerMap[id]);
      delete markerMap[id];
    }
    updateCount();
    closeModal('detail-modal');
    currentLocationId = null; // Clear the current ID
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
  if (clearBtn) clearBtn.style.display = searchQuery ? '' : 'none';

  if (!searchQuery) {
    // Show all markers normally
    Object.values(markerMap).forEach(m => {
      const el = m.getElement();
      if (el) {
        el.style.opacity = '1';
        el.style.filter = 'none';
      }
    });
    return;
  }

  const matched = locations.filter(l => l.title.toLowerCase().includes(searchQuery));
  const matchedIds = new Set(matched.map(l => l._id));

  Object.entries(markerMap).forEach(([id, marker]) => {
    const el = marker.getElement();
    if (!el) return;
    if (matchedIds.has(id)) {
      el.style.opacity = '1';
      el.style.filter = 'none';
    } else {
      el.style.opacity = '0.4';
      el.style.filter = 'grayscale(0.5)';
    }
  });

  // Pan to first result
  if (matched.length === 1 && map) {
    map.flyTo([matched[0].latitude, matched[0].longitude], 14, { duration: 0.6 });
  }
}

// ─── LOCATE ME ────────────────────────────────
function locateMe() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      if (map) map.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 0.8 });
    },
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
  const imgEl = document.getElementById('lightbox-img');
  const lightbox = document.getElementById('lightbox');
  if (imgEl) imgEl.src = src;
  if (lightbox) lightbox.classList.remove('hidden');
}
function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (lightbox) lightbox.classList.add('hidden');
}

// ─── CLOSE MODAL DELEGATE ─────────────────────
document.addEventListener('click', e => {
  if (e.target.dataset?.close) closeModal(e.target.dataset.close);
});

// ─── KEYBOARD ─────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const lightbox = document.getElementById('lightbox');
    const confirmModal = document.getElementById('confirm-modal');
    const detailModal = document.getElementById('detail-modal');
    const formModal = document.getElementById('form-modal');
    
    if (lightbox && !lightbox.classList.contains('hidden')) { 
      closeLightbox(); 
      return; 
    }
    if (confirmModal && !confirmModal.classList.contains('hidden')) { 
      closeModal('confirm-modal'); 
      return; 
    }
    if (detailModal && !detailModal.classList.contains('hidden')) { 
      closeModal('detail-modal'); 
      return; 
    }
    if (formModal && !formModal.classList.contains('hidden')) { 
      closeModal('form-modal'); 
      return; 
    }
    if (isAddMode) exitAddMode();
  }
});

// ─── EVENT BINDINGS ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fabAdd = document.getElementById('fab-add');
  const cancelAddMode = document.getElementById('cancel-add-mode');
  const locateBtn = document.getElementById('locate-btn');
  const formSubmit = document.getElementById('form-submit');
  const formCancel = document.getElementById('form-cancel');
  const detailVisitedToggle = document.getElementById('detail-visited-toggle');
  const detailEdit = document.getElementById('detail-edit');
  const detailDelete = document.getElementById('detail-delete');
  const openAppleMapsBtn = document.getElementById('open-apple-maps');
  const openGoogleMapsBtn = document.getElementById('open-google-maps');
  const detailImageWrap = document.getElementById('detail-image-wrap');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxBackdrop = document.getElementById('lightbox-backdrop');
  const confirmOk = document.getElementById('confirm-ok');
  const confirmCancel = document.getElementById('confirm-cancel');
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  if (fabAdd) fabAdd.addEventListener('click', () => {
    if (isAddMode) { exitAddMode(); } else { enterAddMode(); }
  });
  if (cancelAddMode) cancelAddMode.addEventListener('click', exitAddMode);
  if (locateBtn) locateBtn.addEventListener('click', locateMe);
  if (formSubmit) formSubmit.addEventListener('click', handleFormSubmit);
  if (formCancel) formCancel.addEventListener('click', () => closeModal('form-modal'));
  if (detailVisitedToggle) detailVisitedToggle.addEventListener('click', toggleVisited);
  if (detailEdit) detailEdit.addEventListener('click', () => {
    closeModal('detail-modal');
    openFormModal(currentLocationId);
  });
  if (detailDelete) detailDelete.addEventListener('click', promptDelete);
  if (openAppleMapsBtn) openAppleMapsBtn.addEventListener('click', openAppleMaps);
  if (openGoogleMapsBtn) openGoogleMapsBtn.addEventListener('click', openGoogleMaps);
  if (detailImageWrap) detailImageWrap.addEventListener('click', () => {
    const img = document.getElementById('detail-image');
    if (img && img.src) openLightbox(img.src);
  });
  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxBackdrop) lightboxBackdrop.addEventListener('click', closeLightbox);
  if (confirmOk) confirmOk.addEventListener('click', confirmDelete);
  if (confirmCancel) confirmCancel.addEventListener('click', () => closeModal('confirm-modal'));
  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => applySearch(e.target.value), 220));
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const query = e.target.value.toLowerCase().trim();
        if (!query) return;
        const first = locations.find(l => l.title.toLowerCase().includes(query));
        if (first && map) map.flyTo([first.latitude, first.longitude], 14, { duration: 0.7 });
      }
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      applySearch('');
    });
  }
});

// ─── INIT ─────────────────────────────────────
(async function init() {
  initMap();
  await loadLocations();
})();