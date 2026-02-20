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
const HA_AREAS_API_URL = buildAppUrl('api/ha/areas');
const HA_FLOORS_API_URL = buildAppUrl('api/ha/floors');
const HA_DEVICES_API_URL = buildAppUrl('api/ha/devices');
const HA_LABELS_API_URL = buildAppUrl('api/ha/labels');

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
        networks: [],
        excluded_devices: [],
        settings: null,
        mapPositions: null,
        ui: {}
    };
}

function mergeStorage(raw) {
    const base = buildDefaultStorage();
    const source = raw && typeof raw === 'object' ? raw : {};
    const excludedDevices = Array.isArray(source.excluded_devices)
        ? source.excluded_devices
        : (Array.isArray(source.excludedDevices) ? source.excludedDevices : base.excluded_devices);
    return {
        devices: Array.isArray(source.devices) ? source.devices : base.devices,
        networks: Array.isArray(source.networks) ? source.networks : base.networks,
        excluded_devices: excludedDevices
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        settings: source.settings || base.settings,
        mapPositions: source.mapPositions || base.mapPositions,
        ui: source.ui && typeof source.ui === 'object' ? { ...base.ui, ...source.ui } : base.ui
    };
}

async function loadHaRegistry(url) {
    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Registry request failed: ${response.status}`);
        }
        const payload = await response.json();
        return Array.isArray(payload) ? payload : [];
    } catch (error) {
        console.error(`Failed to load registry from ${url}:`, error);
        return [];
    }
}

function normalizeDeviceId(value) {
    return String(value || '').trim();
}

function normalizeHaIntegrationFlag(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeHaDeviceIds(values) {
    const result = [];
    const seen = new Set();
    const source = Array.isArray(values) ? values : (values ? [values] : []);
    source.forEach((value) => {
        const normalized = normalizeDeviceId(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
}

async function addDeviceToExcludedListIfInHa(deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);
    if (!normalizedId) return false;

    const haDevices = await loadHaRegistry(HA_DEVICES_API_URL);
    const existsInHaRegistry = haDevices.some((device) => normalizeDeviceId(device && device.id) === normalizedId);
    if (!existsInHaRegistry) {
        return false;
    }

    const storage = await loadStorage();
    const currentExcluded = Array.isArray(storage.excluded_devices)
        ? storage.excluded_devices.map(normalizeDeviceId).filter(Boolean)
        : [];
    if (currentExcluded.includes(normalizedId)) {
        return true;
    }

    await patchStorage({
        excluded_devices: [...currentExcluded, normalizedId]
    });
    return true;
}

function normalizeFloors(rawFloors) {
    return (rawFloors || [])
        .filter(item => item && typeof item === 'object')
        .map((item, index) => {
            const id = String(item.floor_id || '').trim();
            if (!id) return null;
            const name = String(item.name || '').trim() || id;
            const parsedLevel = Number(item.level);
            const level = Number.isFinite(parsedLevel) ? parsedLevel : null;
            return {
                id,
                name,
                level
            };
        })
        .filter(Boolean);
}

function normalizeAreas(rawAreas) {
    return (rawAreas || [])
        .filter(item => item && typeof item === 'object')
        .map((item, index) => {
            const id = String(item.area_id || '').trim();
            if (!id) return null;
            const name = String(item.name || '').trim() || id;
            const floor = String(item.floor_id || '').trim();
            return {
                id,
                name,
                floor
            };
        })
        .filter(Boolean);
}

function normalizeLabels(rawLabels) {
    return (rawLabels || [])
        .filter(item => item && typeof item === 'object')
        .map((item) => {
            const id = String(item.label_id || item.id || '').trim();
            if (!id) return null;
            const name = String(item.name || '').trim() || id;
            const color = String(item.color || '').trim();
            const icon = String(item.icon || '').trim();
            return {
                id,
                name,
                color,
                icon
            };
        })
        .filter(Boolean);
}

const LABEL_COLOR_MAP = {
    red: '#ef4444',
    pink: '#ec4899',
    purple: '#a855f7',
    indigo: '#6366f1',
    blue: '#3b82f6',
    'light-blue': '#38bdf8',
    cyan: '#06b6d4',
    teal: '#14b8a6',
    green: '#22c55e',
    'light-green': '#4ade80',
    lime: '#84cc16',
    yellow: '#eab308',
    amber: '#f59e0b',
    orange: '#f97316',
    'deep-orange': '#ea580c',
    brown: '#a16207',
    grey: '#94a3b8',
    gray: '#94a3b8',
    'blue-grey': '#64748b',
    'blue-gray': '#64748b'
};

function resolveLabelColor(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = raw.toLowerCase();
    if (LABEL_COLOR_MAP[normalized]) {
        return LABEL_COLOR_MAP[normalized];
    }
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) {
        return raw;
    }
    if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) {
        return raw;
    }
    return raw;
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
    const devices = Array.isArray(storage.devices) ? storage.devices : [];
    let networks = Array.isArray(storage.networks) ? storage.networks : [];
    const rawAreas = await loadHaRegistry(HA_AREAS_API_URL);
    const rawFloors = await loadHaRegistry(HA_FLOORS_API_URL);
    const rawLabels = await loadHaRegistry(HA_LABELS_API_URL);
    const areas = normalizeAreas(rawAreas);
    const floors = normalizeFloors(rawFloors);
    const labels = normalizeLabels(rawLabels);
    let didUpdate = false;

    if (!Array.isArray(networks) || networks.length === 0) {
        networks = [buildNetwork('vlan0')];
        didUpdate = true;
    }

    devices.forEach((device) => {
        if (!device || typeof device !== 'object') return;
        const currentIds = normalizeHaDeviceIds(device.haDeviceIds || device.homeAssistantDeviceIds);
        let nextIds = currentIds;
        if (!nextIds.length && normalizeHaIntegrationFlag(device.homeAssistant)) {
            const fallbackId = normalizeDeviceId(device.id);
            nextIds = fallbackId ? [fallbackId] : [];
        }
        const shouldUpdateIds = !Array.isArray(device.haDeviceIds) ||
            currentIds.length !== nextIds.length ||
            currentIds.some((value, index) => value !== nextIds[index]);
        if (shouldUpdateIds) {
            device.haDeviceIds = nextIds;
            didUpdate = true;
        }
        if (device.homeAssistantDeviceIds) {
            delete device.homeAssistantDeviceIds;
            didUpdate = true;
        }
    });

    if (didUpdate) {
        await patchStorage({
            devices,
            networks
        });
    }

    return {
        devices: devices,
        areas: areas,
        floors: floors,
        networks: networks,
        labels: labels
    };
}

async function saveData(data) {
    const storage = await loadStorage();
    const payload = mergeStorage({
        ...storage,
        ...data,
        settings: data.settings ? data.settings : storage.settings
    });
    await saveStorage(payload);
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
        batteryTypes: [...(DEFAULT_BATTERY_TYPES || [])],
        haAreaSyncTarget: 'controlled'
    };
}

function normalizeHaAreaSyncTarget(value) {
    return value === 'installed' ? 'installed' : 'controlled';
}

async function loadSettings() {
    const storage = await loadStorage();
    const defaults = getDefaultSettings();
    let settings = storage.settings || defaults;
    settings = ensureFriendlySettings({
        brands: settings.brands || defaults.brands,
        types: settings.types || defaults.types,
        connectivity: settings.connectivity || defaults.connectivity,
        batteryTypes: settings.batteryTypes || defaults.batteryTypes,
        haAreaSyncTarget: settings.haAreaSyncTarget || defaults.haAreaSyncTarget
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
        batteryTypes: ensureFriendlyList(settings.batteryTypes, formatDeviceType),
        haAreaSyncTarget: normalizeHaAreaSyncTarget(settings.haAreaSyncTarget)
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

function ensureToastContainer() {
    let container = document.getElementById('app-toast-container');
    if (container) return container;
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', ensureToastContainer, { once: true });
        return null;
    }

    container = document.createElement('div');
    container.id = 'app-toast-container';
    container.className = 'app-toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
    return container;
}

function dismissToast(toastEl) {
    if (!toastEl || !toastEl.parentNode) return;
    toastEl.classList.remove('is-visible');
    setTimeout(() => {
        if (toastEl.parentNode) {
            toastEl.parentNode.removeChild(toastEl);
        }
    }, 180);
}

function showToast(message, type = 'success', options = {}) {
    const text = String(message || '').trim();
    if (!text) return;

    const container = ensureToastContainer();
    if (!container) return;

    const normalizedType = type === 'error' ? 'error' : 'success';
    container.querySelectorAll('.app-toast').forEach((toast) => dismissToast(toast));

    const toastEl = document.createElement('div');
    toastEl.className = `app-toast app-toast-${normalizedType}`;
    toastEl.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');
    toastEl.textContent = text;
    container.appendChild(toastEl);

    requestAnimationFrame(() => {
        toastEl.classList.add('is-visible');
    });

    const duration = Number.isFinite(options.duration) ? Number(options.duration) : 3200;
    if (duration > 0) {
        setTimeout(() => dismissToast(toastEl), duration);
    }
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
    return area ? area.name : 'Unknown';
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

function getSiteNavIconMarkup(href) {
    const cleanHref = String(href || '').split('?')[0];
    if (cleanHref.endsWith('index.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-7 9 7"></path><path d="M6 9.5v10.5h12v-10.5"></path><path d="M10 20v-5h4v5"></path></svg>';
    }
    if (cleanHref.endsWith('devices.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M7 7v10"></path><path d="M17 7v10"></path><path d="M4 17h16"></path></svg>';
    }
    if (cleanHref.endsWith('settings.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h10"></path><path d="M4 18h16"></path></svg>';
    }
    if (cleanHref.endsWith('debug-settings.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6"></path><path d="M10 3v3"></path><path d="M14 3v3"></path><rect x="6" y="6" width="12" height="10" rx="2"></rect><path d="M10 16v3"></path><path d="M14 16v3"></path><path d="M9 10h6"></path><path d="M9 13h6"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle></svg>';
}

function initPrimaryNavIcons() {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    nav.querySelectorAll('a').forEach((link) => {
        if (link.querySelector('.site-nav-icon')) return;

        const labelText = String(link.textContent || '').trim();
        if (!labelText) return;

        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'site-nav-icon';
        iconWrapper.setAttribute('aria-hidden', 'true');
        iconWrapper.innerHTML = getSiteNavIconMarkup(link.getAttribute('href'));

        const labelWrapper = document.createElement('span');
        labelWrapper.className = 'site-nav-label';
        labelWrapper.textContent = labelText;

        link.textContent = '';
        link.appendChild(iconWrapper);
        link.appendChild(labelWrapper);
    });
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

document.addEventListener('DOMContentLoaded', async () => {
    await initDebugSettingsNav();
    initPrimaryNavIcons();
    initMobileNav();
    initIconTooltips();
});
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
window.showToast = showToast;
