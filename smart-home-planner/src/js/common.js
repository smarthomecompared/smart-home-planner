// Common JavaScript for Smart Home Manager

function resolveAppBasePath() {
    const path = window.location.pathname || '';
    if (!path || path === '/') return '';
    if (path.endsWith('.html')) {
        const slashIndex = path.lastIndexOf('/');
        return slashIndex > 0 ? path.slice(0, slashIndex) : '';
    }
    return path.endsWith('/') ? path.slice(0, -1) : path;
}

const APP_BASE_PATH = resolveAppBasePath();

function buildAppUrl(path) {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    return APP_BASE_PATH ? `${APP_BASE_PATH}/${cleanPath}` : `/${cleanPath}`;
}

const STORAGE_API_URL = buildAppUrl('api/storage');
const SAMPLE_DATA_URL = buildAppUrl('json/sample.json');
const DEFAULT_DEMO_STATE = {
    enabled: false,
    snapshot: null
};

function isIngressRuntime() {
    const pathname = window.location.pathname || '';
    return pathname.includes('/api/hassio_ingress/');
}

function isLocalAddonRuntime() {
    if (isIngressRuntime()) return false;
    const host = (window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
}

let runtimeInfoPromise = null;

async function getRuntimeInfo() {
    if (!runtimeInfoPromise) {
        runtimeInfoPromise = fetch(buildAppUrl('api/runtime'), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Runtime request failed: ${response.status}`);
                }
                return response.json();
            })
            .catch(() => ({
                isLocalRuntime: isLocalAddonRuntime(),
                isAddonRuntime: !isLocalAddonRuntime()
            }));
    }
    return runtimeInfoPromise;
}

function buildHome(name) {
    return {
        id: `home-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name,
        createdAt: new Date().toISOString()
    };
}

function buildNetwork(name) {
    return {
        id: `network-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name,
        createdAt: new Date().toISOString()
    };
}

function buildDefaultStorage() {
    return {
        devices: [],
        areas: [],
        floors: [],
        homes: [],
        networks: [],
        selectedHomeId: '',
        settings: null,
        mapPositions: null,
        demo: { ...DEFAULT_DEMO_STATE },
        ui: {}
    };
}

function mergeStorage(raw) {
    const base = buildDefaultStorage();
    const merged = { ...base, ...(raw || {}) };
    merged.demo = { ...base.demo, ...(raw && raw.demo ? raw.demo : {}) };
    merged.ui = { ...base.ui, ...(raw && raw.ui ? raw.ui : {}) };
    return merged;
}

let storageCache = null;
let storageLoadPromise = null;
let storageSavePromise = Promise.resolve();

function enqueueStorageWrite(task) {
    storageSavePromise = storageSavePromise.then(task, task);
    return storageSavePromise;
}

async function loadStorage() {
    if (storageCache) return storageCache;
    if (!storageLoadPromise) {
        storageLoadPromise = fetch(STORAGE_API_URL, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Storage request failed: ${response.status}`);
                }
                const payload = await response.json();
                return mergeStorage(payload);
            })
            .catch((error) => {
                console.error('Failed to load storage:', error);
                return mergeStorage({});
            })
            .then((storage) => {
                storageCache = storage;
                storageLoadPromise = null;
                return storage;
            });
    }
    return storageLoadPromise;
}

async function saveStorage(nextStorage) {
    return enqueueStorageWrite(async () => {
        const payload = mergeStorage(nextStorage);
        storageCache = payload;
        const response = await fetch(STORAGE_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`Storage write failed: ${response.status}`);
        }
        return payload;
    });
}

async function patchStorage(patch) {
    return enqueueStorageWrite(async () => {
        const storage = await loadStorage();
        const payload = mergeStorage({ ...storage, ...(patch || {}) });
        storageCache = payload;
        const response = await fetch(STORAGE_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`Storage write failed: ${response.status}`);
        }
        return payload;
    });
}

// Data Management Functions
async function loadData() {
    const storage = await loadStorage();
    let devices = storage.devices || [];
    let areas = storage.areas || [];
    let floors = storage.floors || [];
    let homes = storage.homes || [];
    let networks = storage.networks || [];
    let selectedHomeId = storage.selectedHomeId || '';
    let didUpdate = false;

    if (!Array.isArray(homes) || homes.length === 0) {
        homes = [buildHome(DEFAULT_HOME_NAME)];
        selectedHomeId = homes[0].id;
        didUpdate = true;
    }

    if (!selectedHomeId || !homes.some(home => home.id === selectedHomeId)) {
        selectedHomeId = homes[0].id;
        didUpdate = true;
    }

    const homeIds = new Set(homes.map(home => home.id));

    if (!Array.isArray(networks) || networks.length === 0) {
        networks = [buildNetwork('vlan0')];
        didUpdate = true;
    }

    devices = (devices || []).map(device => {
        if (!device.homeId || !homeIds.has(device.homeId)) {
            didUpdate = true;
            return {
                ...device,
                homeId: selectedHomeId
            };
        }
        return device;
    });

    areas = (areas || []).map(area => {
        if (!area.homeId || !homeIds.has(area.homeId)) {
            didUpdate = true;
            return {
                ...area,
                homeId: selectedHomeId
            };
        }
        return area;
    });

    floors = (floors || []).map(floor => {
        if (!floor.homeId || !homeIds.has(floor.homeId)) {
            didUpdate = true;
            return {
                ...floor,
                homeId: selectedHomeId
            };
        }
        return floor;
    });

    if (didUpdate) {
        await patchStorage({
            devices,
            areas,
            floors,
            homes,
            networks,
            selectedHomeId
        });
    }

    return {
        devices: devices,
        areas: areas,
        floors: floors,
        homes: homes,
        networks: networks,
        selectedHomeId: selectedHomeId
    };
}

async function saveData(data) {
    const storage = await loadStorage();
    await saveStorage({
        ...storage,
        ...data,
        settings: data.settings ? data.settings : storage.settings
    });
}

// Settings Management Functions
function getDefaultSettings() {
    const mapType = (value) => {
        const normalized = normalizeOptionValue(value);
        return value === normalized ? formatDeviceType(value) : value;
    };
    const mapConnectivity = (value) => {
        const normalized = normalizeOptionValue(value);
        return value === normalized ? formatConnectivity(value) : value;
    };
    return {
        brands: [...(DEFAULT_BRANDS || [])],
        types: (DEFAULT_TYPES || []).map(mapType),
        connectivity: (DEFAULT_CONNECTIVITY || []).map(mapConnectivity),
        batteryTypes: [...(DEFAULT_BATTERY_TYPES || [])]
    };
}

async function loadSettings() {
    const storage = await loadStorage();
    const defaults = getDefaultSettings();
    let settings = storage.settings || defaults;
    settings = ensureFriendlySettings({
        brands: settings.brands || defaults.brands,
        types: settings.types || defaults.types,
        connectivity: settings.connectivity || defaults.connectivity,
        batteryTypes: settings.batteryTypes || defaults.batteryTypes
    });
    if (!storage.settings) {
        await saveStorage({ ...storage, settings });
    }
    return settings;
}

async function saveSettings(settings) {
    const storage = await loadStorage();
    await saveStorage({
        ...storage,
        settings
    });
}

async function getSelectedHomeId() {
    const data = await loadData();
    return data.selectedHomeId;
}

// Utility Functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function normalizeOptionValue(value) {
    if (value === null || value === undefined) return '';
    const normalized = String(value)
        .trim()
        .toLowerCase()
        .replace(/\s*&\s*/g, '-')
        .replace(/\//g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (normalized === 'wi-fi') return 'wifi';
    return normalized;
}

function ensureFriendlyList(values, formatter) {
    const result = [];
    const seen = new Set();
    (values || []).forEach((value) => {
        const raw = String(value || '').trim();
        if (!raw) return;
        const normalized = normalizeOptionValue(raw);
        let label = raw;
        if (normalized && normalized === raw && typeof formatter === 'function') {
            const formatted = formatter(normalized);
            label = formatted || raw;
        }
        const key = normalizeOptionValue(label);
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(label);
    });
    return result;
}

function ensureFriendlySettings(settings) {
    return {
        brands: ensureFriendlyList(settings.brands, formatDeviceType),
        types: ensureFriendlyList(settings.types, formatDeviceType),
        connectivity: ensureFriendlyList(settings.connectivity, formatConnectivity),
        batteryTypes: ensureFriendlyList(settings.batteryTypes, formatDeviceType)
    };
}

function getFriendlyOption(options, value, fallbackFormatter) {
    if (!value) return '';
    const normalized = normalizeOptionValue(value);
    if (Array.isArray(options)) {
        const match = options.find(option => normalizeOptionValue(option) === normalized);
        if (match) return match;
    }
    if (typeof fallbackFormatter === 'function') {
        const fallback = fallbackFormatter(value);
        return fallback || value;
    }
    return value;
}

function formatConnectivity(value) {
    if (!value) return '';
    const normalized = normalizeOptionValue(value);
    if (normalized === 'wifi' || normalized === 'wi-fi') return 'Wi-Fi';
    if (normalized === 'z-wave') return 'Z-Wave';
    if (normalized === 'zigbee') return 'Zigbee';
    if (normalized === 'bluetooth') return 'Bluetooth';
    if (normalized === 'matter') return 'Matter';
    return normalized
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function isWifiConnectivity(value) {
    const normalized = normalizeOptionValue(value);
    return normalized === 'wifi' || normalized === 'ethernet';
}

function ensureDialogModal() {
    if (document.getElementById('app-dialog-modal')) {
        return;
    }
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', ensureDialogModal, { once: true });
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal is-hidden';
    modal.id = 'app-dialog-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal-overlay" id="app-dialog-overlay"></div>
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
            <div class="modal-header">
                <div class="modal-title" id="app-dialog-title"></div>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" id="app-dialog-close" aria-label="Close dialog" title="Close dialog">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6l12 12"></path>
                        <path d="M18 6l-12 12"></path>
                    </svg>
                </button>
            </div>
            <div class="dialog-message" id="app-dialog-message"></div>
            <div class="modal-actions" id="app-dialog-actions">
                <button class="btn btn-secondary" type="button" id="app-dialog-cancel">Cancel</button>
                <button class="btn btn-primary" type="button" id="app-dialog-confirm">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const overlay = modal.querySelector('#app-dialog-overlay');
    const closeBtn = modal.querySelector('#app-dialog-close');
    overlay.addEventListener('click', () => closeDialog(false));
    closeBtn.addEventListener('click', () => closeDialog(false));
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (modal.classList.contains('is-hidden')) return;
        closeDialog(false);
    });
}

let dialogResolve = null;

function openDialog({ title, message, confirmText, cancelText, showCancel }) {
    ensureDialogModal();
    const modal = document.getElementById('app-dialog-modal');
    if (!modal) return Promise.resolve(false);

    const titleEl = modal.querySelector('#app-dialog-title');
    const messageEl = modal.querySelector('#app-dialog-message');
    const confirmBtn = modal.querySelector('#app-dialog-confirm');
    const cancelBtn = modal.querySelector('#app-dialog-cancel');
    const closeBtn = modal.querySelector('#app-dialog-close');

    const shouldShowCancel = Boolean(showCancel);
    titleEl.textContent = title || 'Notice';
    messageEl.textContent = message || '';
    confirmBtn.textContent = confirmText || 'OK';
    cancelBtn.textContent = cancelText || 'Cancel';
    cancelBtn.style.display = shouldShowCancel ? 'inline-flex' : 'none';
    closeBtn.style.display = shouldShowCancel ? 'none' : 'inline-flex';

    confirmBtn.onclick = () => closeDialog(true);
    cancelBtn.onclick = () => closeDialog(false);
    closeBtn.onclick = () => closeDialog(false);

    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        confirmBtn.focus();
    }, 0);

    return new Promise(resolve => {
        dialogResolve = resolve;
    });
}

function closeDialog(result) {
    const modal = document.getElementById('app-dialog-modal');
    if (!modal) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    const resolve = dialogResolve;
    dialogResolve = null;
    if (resolve) {
        resolve(Boolean(result));
    }
}

function showAlert(message, options = {}) {
    return openDialog({
        title: options.title || 'Notice',
        message,
        confirmText: options.confirmText || 'OK',
        showCancel: false
    });
}

function showConfirm(message, options = {}) {
    return openDialog({
        title: options.title || 'Confirm',
        message,
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        showCancel: true
    });
}

function getFloorById(floors, id) {
    return floors.find(f => f.id === id);
}

function getFloorName(floors, id) {
    const floor = getFloorById(floors, id);
    return floor ? floor.name : 'Unknown';
}

function getAreaById(areas, id) {
    return areas.find(area => String(area.id) === String(id));
}

function getAreaName(areas, id) {
    const area = getAreaById(areas, id);
    if (area) {
        return area.name;
    }
    if (typeof id === 'string') {
        const trimmedId = id.trim();
        if (!trimmedId) {
            return 'Unknown';
        }
        const areaByName = areas.find(areaItem =>
            (areaItem.name || '').toLowerCase() === trimmedId.toLowerCase()
        );
        return areaByName ? areaByName.name : 'Unknown';
    }
    return 'Unknown';
}

function getDeviceById(devices, id) {
    return devices.find(d => d.id === id);
}

// Format device type for display
function formatDeviceType(type) {
    if (!type) return '';
    return type.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function initMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.site-nav');
    if (!toggle || !nav) {
        return;
    }

    const closeNav = () => {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    nav.addEventListener('click', (event) => {
        if (event.target && event.target.tagName === 'A' && window.innerWidth <= 640) {
            closeNav();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 640) {
            closeNav();
        }
    });
}

async function initDebugSettingsNav() {
    const runtime = await getRuntimeInfo();
    if (!runtime || !runtime.isLocalRuntime) return;

    const nav = document.querySelector('.site-nav');
    if (!nav) return;
    if (nav.querySelector('a[href="debug-settings.html"]')) return;

    const debugLink = document.createElement('a');
    debugLink.href = 'debug-settings.html';
    debugLink.textContent = 'Debug Settings';
    if ((window.location.pathname || '').endsWith('/debug-settings.html')) {
        nav.querySelectorAll('a.active').forEach(link => link.classList.remove('active'));
        debugLink.classList.add('active');
    }
    nav.appendChild(debugLink);
}

function applyIconTooltip(el) {
    if (!el || !el.classList || !el.classList.contains('btn-icon')) return;
    if (el.classList.contains('no-tooltip')) return;
    if (el.dataset.tooltip) return;
    const label = el.getAttribute('title') || el.getAttribute('aria-label') || '';
    if (!label) return;
    el.dataset.tooltip = label;
    if (el.hasAttribute('title')) {
        el.removeAttribute('title');
    }
}

function initIconTooltips() {
    document.querySelectorAll('.btn-icon').forEach(applyIconTooltip);
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.classList.contains('btn-icon')) {
                    applyIconTooltip(node);
                }
                node.querySelectorAll?.('.btn-icon').forEach(applyIconTooltip);
            });
        });
    });
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

async function getUiPreference(key) {
    const storage = await loadStorage();
    return storage.ui ? storage.ui[key] : null;
}

async function setUiPreference(key, value) {
    const storage = await loadStorage();
    const nextUi = { ...(storage.ui || {}) };
    if (value === null || value === undefined) {
        delete nextUi[key];
    } else {
        nextUi[key] = value;
    }
    await patchStorage({ ui: nextUi });
}

async function loadMapPositions() {
    const storage = await loadStorage();
    return storage.mapPositions || {};
}

async function saveMapPositions(positions) {
    await patchStorage({ mapPositions: positions || {} });
}

async function clearMapPositions() {
    await patchStorage({ mapPositions: null });
}

async function isDemoModeEnabled() {
    const storage = await loadStorage();
    return Boolean(storage.demo && storage.demo.enabled);
}

function updateDemoBanner(enabled) {
    const shouldShow = Boolean(enabled);
    const existingBanner = document.getElementById('demo-mode-banner');
    if (existingBanner) {
        existingBanner.remove();
    }
    let badge = document.getElementById('demo-mode-badge');
    if (!shouldShow) {
        if (badge) {
            badge.remove();
        }
        document.body.classList.remove('demo-mode');
        return;
    }
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'demo-mode-badge';
        badge.className = 'demo-mode-badge';
        badge.textContent = 'Demo mode';
        badge.setAttribute('data-tooltip', 'Sample mode data is loaded for demonstration purposes. Go to Settings to disable.');
        badge.setAttribute('tabindex', '0');
    }
    const headerBrand = document.querySelector('header .header-brand');
    if (headerBrand) {
        headerBrand.appendChild(badge);
    } else {
        document.body.prepend(badge);
    }
    document.body.classList.add('demo-mode');
}

async function enableDemoMode() {
    const storage = await loadStorage();
    if (storage.demo && storage.demo.enabled) {
        updateDemoBanner(true);
        return true;
    }
    if (!storage.demo || !storage.demo.snapshot) {
        const snapshot = {
            ...(await loadData()),
            settings: await loadSettings(),
            mapPositions: storage.mapPositions || null
        };
        storage.demo = {
            ...(storage.demo || {}),
            snapshot
        };
        await saveStorage(storage);
    }

    const response = await fetch(SAMPLE_DATA_URL, { cache: 'no-store' });
    if (!response.ok) {
        showAlert('Unable to load demo data.');
        return false;
    }
    const demoData = await response.json();

    if (Array.isArray(demoData.devices)) {
        demoData.devices = demoData.devices.map(device => ({
            ...device,
            brand: normalizeOptionValue(device.brand),
            type: normalizeOptionValue(device.type),
            connectivity: normalizeOptionValue(device.connectivity),
            batteryType: normalizeOptionValue(device.batteryType)
        }));
    }

    await saveData(demoData);
    if (demoData.settings) {
        await saveSettings(demoData.settings);
    }

    const nextStorage = await loadStorage();
    nextStorage.mapPositions = demoData.mapPositions || null;
    nextStorage.demo = {
        ...(nextStorage.demo || {}),
        enabled: true
    };
    await saveStorage(nextStorage);
    updateDemoBanner(true);
    return true;
}

async function disableDemoMode() {
    const storage = await loadStorage();
    const snapshot = storage.demo ? storage.demo.snapshot : null;
    if (snapshot) {
        await saveData(snapshot);
        if (snapshot.settings) {
            await saveSettings(snapshot.settings);
        }
        const nextStorage = await loadStorage();
        nextStorage.mapPositions = snapshot.mapPositions || null;
        nextStorage.demo = {
            ...(nextStorage.demo || {}),
            snapshot: null,
            enabled: false
        };
        await saveStorage(nextStorage);
    } else {
        storage.demo = {
            ...(storage.demo || {}),
            enabled: false
        };
        await saveStorage(storage);
    }
    updateDemoBanner(false);
    return true;
}

document.addEventListener('DOMContentLoaded', async () => {
    await initDebugSettingsNav();
    initMobileNav();
    initIconTooltips();
    updateDemoBanner(await isDemoModeEnabled());
});

window.isDemoModeEnabled = isDemoModeEnabled;
window.updateDemoBanner = updateDemoBanner;
window.enableDemoMode = enableDemoMode;
window.disableDemoMode = disableDemoMode;
window.loadMapPositions = loadMapPositions;
window.saveMapPositions = saveMapPositions;
window.clearMapPositions = clearMapPositions;
window.getUiPreference = getUiPreference;
window.setUiPreference = setUiPreference;
window.APP_BASE_PATH = APP_BASE_PATH;
window.buildAppUrl = buildAppUrl;
window.isIngressRuntime = isIngressRuntime;
window.isLocalAddonRuntime = isLocalAddonRuntime;
window.getRuntimeInfo = getRuntimeInfo;
