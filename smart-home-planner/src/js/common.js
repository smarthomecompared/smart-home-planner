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
const HA_CONFIG_API_URL = buildAppUrl('api/ha/config');
const HA_BACKUPS_STATUS_API_URL = buildAppUrl('api/ha/backups-status');

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
        testCases: [],
        testCaseRuns: [],
        networks: [],
        excluded_devices: [],
        settings: null,
        mapPositions: null,
        mapImagePositions: null,
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
        testCases: Array.isArray(source.testCases) ? source.testCases : base.testCases,
        testCaseRuns: Array.isArray(source.testCaseRuns) ? source.testCaseRuns : base.testCaseRuns,
        networks: Array.isArray(source.networks) ? source.networks : base.networks,
        excluded_devices: excludedDevices
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        settings: source.settings || base.settings,
        mapPositions: source.mapPositions || base.mapPositions,
        mapImagePositions: source.mapImagePositions || base.mapImagePositions,
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

let haConfigPromise = null;
let haBackupsStatusPromise = null;

async function loadHaConfig() {
    if (!haConfigPromise) {
        haConfigPromise = fetch(HA_CONFIG_API_URL, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Config request failed: ${response.status}`);
                }
                return response.json();
            })
            .catch((error) => {
                console.error(`Failed to load Home Assistant config:`, error);
                return {};
            });
    }
    return haConfigPromise;
}

async function loadHaBackupsStatus() {
    if (!haBackupsStatusPromise) {
        haBackupsStatusPromise = fetch(HA_BACKUPS_STATUS_API_URL, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Backups status request failed: ${response.status}`);
                }
                return response.json();
            })
            .catch((error) => {
                console.error(`Failed to load Home Assistant backups status:`, error);
                // Allow subsequent calls to retry instead of keeping a failed promise forever.
                haBackupsStatusPromise = null;
                return { error: error?.message || 'Unable to load backup status' };
            });
    }
    return haBackupsStatusPromise;
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
    red: '#f0383b',
    pink: '#d9569b',
    purple: '#8f6aff',
    indigo: '#4d6aff',
    blue: '#006fff',
    'light-blue': '#339fff',
    cyan: '#00a0e0',
    teal: '#00a0e0',
    green: '#38cc65',
    'light-green': '#52d67f',
    lime: '#52d67f',
    yellow: '#e0a51e',
    amber: '#f5a524',
    orange: '#f6862d',
    'deep-orange': '#d97a1f',
    brown: '#a5761c',
    grey: '#7e8595',
    gray: '#7e8595',
    'blue-grey': '#565d6b',
    'blue-gray': '#565d6b'
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
let storageEtag = null;
let storageLoadPromise = null;
let storageSavePromise = Promise.resolve();
let storageConflictAlertPromise = null;
const STORAGE_CONFLICT_ERROR_CODE = 'storage_conflict';
const STORAGE_CONFLICT_DEFAULT_MESSAGE = 'Your data changed in another browser tab or session. Reload and apply your change again.';

function enqueueStorageWrite(task) {
    storageSavePromise = storageSavePromise.then(task, task);
    return storageSavePromise;
}

function parseStorageEtag(response) {
    const etag = response?.headers?.get('ETag');
    return etag ? String(etag).trim() : '';
}

function buildStorageConflictError(message, conflictPayload) {
    const error = new Error(message || STORAGE_CONFLICT_DEFAULT_MESSAGE);
    error.name = 'StorageConflictError';
    error.code = STORAGE_CONFLICT_ERROR_CODE;
    error.isStorageConflict = true;
    if (conflictPayload && typeof conflictPayload === 'object') {
        error.storage = conflictPayload.storage;
    }
    return error;
}

function isStorageConflictError(error) {
    if (!error || typeof error !== 'object') return false;
    return error.isStorageConflict === true || error.code === STORAGE_CONFLICT_ERROR_CODE;
}

async function parseJsonSafely(response) {
    try {
        return await response.json();
    } catch (_error) {
        return null;
    }
}

async function showStorageConflictAlert(message) {
    const detail = String(message || '').trim() || STORAGE_CONFLICT_DEFAULT_MESSAGE;
    if (storageConflictAlertPromise) {
        await storageConflictAlertPromise;
        return;
    }
    storageConflictAlertPromise = (async () => {
        try {
            if (typeof showAlert === 'function') {
                await showAlert(detail, { title: 'Save Conflict' });
            }
        } catch (_error) {
            // Ignore UI errors while notifying conflict.
        } finally {
            storageConflictAlertPromise = null;
        }
    })();
    await storageConflictAlertPromise;
}

function applyConflictStorageSnapshot(conflictPayload) {
    const storage = conflictPayload && typeof conflictPayload.storage === 'object' ? conflictPayload.storage : null;
    storageCache = storage ? mergeStorage(storage) : null;
}

async function putStoragePayload(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (storageEtag) {
        headers['If-Match'] = storageEtag;
    }
    const response = await fetch(STORAGE_API_URL, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
    });
    if (response.status === 409) {
        const conflictPayload = await parseJsonSafely(response);
        const nextEtag = parseStorageEtag(response);
        storageEtag = nextEtag || null;
        applyConflictStorageSnapshot(conflictPayload);
        const message = String(conflictPayload?.error || '').trim() || STORAGE_CONFLICT_DEFAULT_MESSAGE;
        await showStorageConflictAlert(message);
        throw buildStorageConflictError(message, conflictPayload);
    }
    if (!response.ok) {
        throw new Error(`Storage write failed: ${response.status}`);
    }
    const nextEtag = parseStorageEtag(response);
    if (nextEtag) {
        storageEtag = nextEtag;
    }
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
                const etag = parseStorageEtag(response);
                storageEtag = etag || null;
                return mergeStorage(payload);
            })
            .catch((error) => {
                console.error('Failed to load storage:', error);
                storageEtag = null;
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
        await putStoragePayload(payload);
        storageCache = payload;
        return payload;
    });
}

async function patchStorage(patch) {
    return enqueueStorageWrite(async () => {
        const storage = await loadStorage();
        const payload = mergeStorage({ ...storage, ...(patch || {}) });
        await putStoragePayload(payload);
        storageCache = payload;
        return payload;
    });
}

// Data Management Functions
async function loadData() {
    const storage = await loadStorage();
    const devices = Array.isArray(storage.devices) ? storage.devices : [];
    const testCases = Array.isArray(storage.testCases) ? storage.testCases : [];
    const testCaseRuns = Array.isArray(storage.testCaseRuns) ? storage.testCaseRuns : [];
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
        testCases: testCases,
        testCaseRuns: testCaseRuns,
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
    return await saveStorage(payload);
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
    const batteryDefaults = (DEFAULT_BATTERY_TYPES || [])
        .map(item => (typeof item === 'string' ? item : item && item.name))
        .filter(Boolean);
    return {
        brands: [...(DEFAULT_BRANDS || [])],
        types: (DEFAULT_TYPES || []).map(mapType),
        connectivity: (DEFAULT_CONNECTIVITY || []).map(mapConnectivity),
        batteryTypes: batteryDefaults,
        testCaseCategories: [...(DEFAULT_TEST_CASE_CATEGORIES || [])],
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
        testCaseCategories: settings.testCaseCategories || defaults.testCaseCategories,
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
        testCaseCategories: ensureFriendlyList(settings.testCaseCategories),
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
    // Destructive confirmations get the danger treatment without touching every caller
    const isDestructive = /\b(delete|remove|discard|reset)\b/i.test(confirmText || '');
    confirmBtn.classList.toggle('btn-danger', isDestructive);
    confirmBtn.classList.toggle('btn-primary', !isDestructive);
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
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect></svg>';
    }
    if (cleanHref.endsWith('test-cases.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"></path><path d="M5 12h14"></path><path d="M5 17h14"></path><path d="M3 7h.01"></path><path d="M3 12h.01"></path><path d="M3 17h.01"></path></svg>';
    }
    if (cleanHref.endsWith('settings.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
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

function ensureAppFooter() {
    const container = document.querySelector(".container");
    if (!container) return null;

    let footer = container.querySelector("#app-global-footer");
    if (footer) return footer;

    footer = document.createElement("footer");
    footer.id = "app-global-footer";
    footer.className = "app-footer";
    footer.setAttribute("role", "contentinfo");

    const repoUrl = (typeof appRepoUrl === "string" && appRepoUrl)
        ? appRepoUrl
        : "https://github.com/smarthomecompared/smart-home-planner";
    const year = new Date().getFullYear();

    footer.innerHTML = `
        <div class="app-footer-inner">
            <div class="app-footer-main">
                <div class="app-footer-brand">
                    <img class="app-footer-logo" src="img/logo.png" alt="Smart Home Planner logo">
                    <div class="app-footer-brand-text">
                        <span class="app-footer-brand-name">Smart Home Planner</span>
                        <span class="app-footer-brand-tag">Plan, track &amp; document your smart home.</span>
                    </div>
                </div>

                <nav class="app-footer-col" aria-label="Project links">
                    <h3 class="app-footer-heading">Project</h3>
                    <a class="app-footer-link" href="${repoUrl}" target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/></svg>
                        <span>GitHub Repository</span>
                    </a>
                    <a class="app-footer-link" href="${repoUrl}/issues" target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v7h-2V7zm0 9h2v2h-2v-2z"/></svg>
                        <span>Report an issue</span>
                    </a>
                    <a class="app-footer-link" href="https://smarthomecompared.com/" target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.9 8zM12 4c.83 1.2 1.48 2.53 1.91 4h-3.82c.43-1.47 1.08-2.8 1.91-4zM4.26 14a7.96 7.96 0 0 1 0-4h3.38a16.6 16.6 0 0 0 0 4H4.26zm.84 2h2.95c.35 1.28.82 2.5 1.38 3.56A8.03 8.03 0 0 1 5.1 16zm2.95-8H5.1a8.03 8.03 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.05 8zM12 20c-.83-1.2-1.48-2.53-1.91-4h3.82A13.9 13.9 0 0 1 12 20zm2.34-6H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.23 5.56c.56-1.06 1.03-2.28 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.6 16.6 0 0 0 0-4h3.38a7.96 7.96 0 0 1 0 4h-3.38z"/></svg>
                        <span>Smart Home Compared</span>
                    </a>
                </nav>

                <div class="app-footer-col app-footer-support">
                    <h3 class="app-footer-heading">Enjoying the app?</h3>
                    <p class="app-footer-support-copy">It's free and open source. A coffee keeps development going.</p>
                    <a class="app-footer-kofi" href="https://ko-fi.com/C0C7E7OEA" target="_blank" rel="noopener noreferrer" aria-label="Support Smart Home Planner on Ko-fi">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h13a4 4 0 0 1 0 8h-1.09A6 6 0 0 1 11 17H9a6 6 0 0 1-6-6V4a1 1 0 0 1 1-1h1zm12 6a2 2 0 0 0 0-4h-1v4h1zM4 19h13a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2z"/></svg>
                        <span>Support on Ko-fi</span>
                    </a>
                </div>
            </div>

            <div class="app-footer-bottom">
                <p class="app-footer-copy">&copy; ${year} <strong>Smart Home Compared</strong> &middot; Built for the Home Assistant community</p>
                <ul class="app-footer-social" aria-label="Social media links">
                    <li>
                        <a href="https://x.com/shcompared" target="_blank" rel="noopener noreferrer" aria-label="Follow us on X">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        </a>
                    </li>
                    <li>
                        <a href="https://youtube.com/@SmartHomeCompared" target="_blank" rel="noopener noreferrer" aria-label="Follow us on YouTube">
                            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M31.7,9.6c0,0-0.3-2.2-1.3-3.2c-1.2-1.3-2.6-1.3-3.2-1.4C22.7,4.7,16,4.7,16,4.7h0c0,0-6.7,0-11.2,0.3 c-0.6,0.1-2,0.1-3.2,1.4c-1,1-1.3,3.2-1.3,3.2S0,12.2,0,14.8v2.4c0,2.6,0.3,5.2,0.3,5.2s0.3,2.2,1.3,3.2c1.2,1.3,2.8,1.2,3.5,1.4 C7.7,27.2,16,27.3,16,27.3s6.7,0,11.2-0.3c0.6-0.1,2-0.1,3.2-1.4c1-1,1.3-3.2,1.3-3.2s0.3-2.6,0.3-5.2v-2.4 C32,12.2,31.7,9.6,31.7,9.6z M12.7,20.2l0-9l8.6,4.5L12.7,20.2z"/></svg>
                        </a>
                    </li>
                    <li>
                        <a href="https://instagram.com/smarthomecompared" target="_blank" rel="noopener noreferrer" aria-label="Follow us on Instagram">
                            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16,3.7c4,0,4.479.015,6.061.087a6.426,6.426,0,0,1,4.51,1.639,6.426,6.426,0,0,1,1.639,4.51C28.282,11.521,28.3,12,28.3,16s-.015,4.479-.087,6.061a6.426,6.426,0,0,1-1.639,4.51,6.425,6.425,0,0,1-4.51,1.639c-1.582.072-2.056.087-6.061.087s-4.479-.015-6.061-.087a6.426,6.426,0,0,1-4.51-1.639,6.425,6.425,0,0,1-1.639-4.51C3.718,20.479,3.7,20.005,3.7,16s.015-4.479.087-6.061a6.426,6.426,0,0,1,1.639-4.51A6.426,6.426,0,0,1,9.939,3.79C11.521,3.718,12,3.7,16,3.7M16,1c-4.073,0-4.584.017-6.185.09a8.974,8.974,0,0,0-6.3,2.427,8.971,8.971,0,0,0-2.427,6.3C1.017,11.416,1,11.927,1,16s.017,4.584.09,6.185a8.974,8.974,0,0,0,2.427,6.3,8.971,8.971,0,0,0,6.3,2.427c1.6.073,2.112.09,6.185.09s4.584-.017,6.185-.09a8.974,8.974,0,0,0,6.3-2.427,8.971,8.971,0,0,0,2.427-6.3c.073-1.6.09-2.112.09-6.185s-.017-4.584-.09-6.185a8.974,8.974,0,0,0-2.427-6.3,8.971,8.971,0,0,0-6.3-2.427C20.584,1.017,20.073,1,16,1Z"/><path d="M16,8.3A7.7,7.7,0,1,0,23.7,16,7.7,7.7,0,0,0,16,8.3ZM16,21a5,5,0,1,1,5-5A5,5,0,0,1,16,21Z"/><circle cx="24.007" cy="7.993" r="1.8"/></svg>
                        </a>
                    </li>
                    <li>
                        <a href="https://www.reddit.com/user/smarthomecompared" target="_blank" rel="noopener noreferrer" aria-label="Follow us on Reddit">
                            <svg viewBox="0 0 90 90" aria-hidden="true"><path d="M89.998 45.604c-.201-5.442-4.77-9.691-10.229-9.506-2.419.084-4.719 1.075-6.466 2.737-7.693-5.24-16.729-8.113-26.017-8.314L51.67 9.442l14.461 3.041c.402 3.712 3.728 6.4 7.44 5.996 3.712-.402 6.4-3.728 5.996-7.44-.404-3.712-3.728-6.4-7.44-5.996-2.134.218-4.048 1.461-5.105 3.309L50.461 5.043c-1.125-.252-2.251.453-2.503 1.596 0 0 0 .017 0 .033L42.97 30.119c-9.406.152-18.559 3.041-26.352 8.314-3.964-3.728-10.212-3.544-13.94.437-3.728 3.964-3.544 10.212.437 13.94.773.722 1.662 1.344 2.653 1.781-.068.991-.068 1.982 0 2.973 0 15.133 17.636 27.444 39.386 27.444 21.75 0 39.386-12.295 39.386-27.444.068-.991.068-1.982 0-2.973 3.392-1.697 5.526-5.191 5.458-8.987zM22.429 52.373c0-3.728 3.041-6.769 6.769-6.769s6.769 3.041 6.769 6.769c0 3.728-3.041 6.769-6.769 6.769-3.745-.034-6.769-3.04-6.769-6.769zm39.252 18.845v-.269c-4.804 3.611-10.682 5.458-16.696 5.207-6.014.252-11.891-1.596-16.696-5.207-.638-.773-.521-1.931.252-2.569.671-.554 1.629-.554 2.318 0 4.065 2.973 9.02 4.485 14.058 4.249 5.039.269 10.011-1.176 14.125-4.114.739-.722 1.948-.706 2.671.033.723.739.706 1.948-.032 2.67zm-.924-11.589c-.117 0-.218 0-.336 0l.051-.252c-3.728 0-6.769-3.041-6.769-6.769 0-3.728 3.041-6.769 6.769-6.769 3.728 0 6.769 3.041 6.769 6.769.15 3.729-2.755 6.869-6.484 7.021z"/></svg>
                        </a>
                    </li>
                    <li>
                        <a href="https://stacker.news/shcompared" target="_blank" rel="noopener noreferrer" aria-label="Follow us on Stacker News">
                            <svg viewBox="0 0 200 307" aria-hidden="true"><path d="M56 0L107.606 131H90.2129H89L1.52588e-05 131L177 307L106.979 165H121H160H200L56 0Z"/></svg>
                        </a>
                    </li>
                </ul>
            </div>
        </div>
    `;

    container.appendChild(footer);
    return footer;
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
    bindTooltipAlignment(el);
}

let globalSearchIndex = null;
let globalSearchReady = false;
let globalSearchLoading = null;

function ensureGlobalSearchMarkup() {
    const header = document.querySelector('header');
    if (!header) return null;
    let container = header.querySelector('.global-search');
    if (container) return container;

    container = document.createElement('div');
    container.className = 'global-search';
    container.setAttribute('role', 'search');
    container.innerHTML = `
        <button type="button" class="global-search-trigger" aria-label="Search devices and tests" title="Search devices and tests">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7"></circle>
                <path d="M20 20l-3.5-3.5"></path>
            </svg>
        </button>
    `;
    header.appendChild(container);
    return container;
}

function ensureGlobalSearchOverlay() {
    let overlay = document.getElementById('global-search-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'global-search-overlay';
    overlay.id = 'global-search-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="global-search-panel" role="dialog" aria-modal="true" aria-label="Global search">
            <div class="global-search-panel-header">
                <div>
                    <div class="global-search-panel-title">Search</div>
                    <div class="global-search-panel-subtitle">Type to search across devices and test cases.</div>
                </div>
                <button type="button" class="global-search-close" id="global-search-overlay-close" aria-label="Close search">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8"></path>
                    </svg>
                </button>
            </div>
            <div class="global-search-overlay-input">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"></circle>
                    <path d="M20 20l-3.5-3.5"></path>
                </svg>
                <input type="search" id="global-search-overlay-input" placeholder="Search by name, notes, labels, models, test steps, and more" autocomplete="off" spellcheck="false">
                <button type="button" class="global-search-clear" id="global-search-overlay-clear" aria-label="Clear search" hidden>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8"></path>
                    </svg>
                </button>
            </div>
            <div class="global-search-results-panel" id="global-search-overlay-results" role="listbox"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function collectSearchTokens(value, output, depth = 0) {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
        const token = String(value).trim();
        if (token) output.push(token);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(item => collectSearchTokens(item, output, depth + 1));
        return;
    }
    if (typeof value === 'object') {
        Object.values(value).forEach(item => collectSearchTokens(item, output, depth + 1));
    }
}

function buildDeviceSearchIndex(devices, areas, floors, labels, networks) {
    const labelMap = new Map((labels || []).map(label => [
        String(label.id || label.label_id || '').trim(),
        String(label.name || '').trim()
    ]));
    const areaMap = new Map((areas || []).map(area => [String(area.id || '').trim(), area]));
    const floorMap = new Map((floors || []).map(floor => [String(floor.id || '').trim(), floor]));
    const networkMap = new Map((networks || []).map(network => [String(network.id || '').trim(), network]));

    return (devices || []).map(device => {
        const tokens = [];
        collectSearchTokens(device, tokens);

        const deviceLabels = Array.isArray(device?.labels) ? device.labels : [];
        deviceLabels.forEach(labelId => {
            const normalized = String(labelId || '').trim();
            if (!normalized) return;
            tokens.push(normalized);
            const labelName = labelMap.get(normalized);
            if (labelName) tokens.push(labelName);
        });

        const areaId = String(device?.area || '').trim();
        const controlledAreaId = String(device?.controlledArea || '').trim();
        const area = areaId ? areaMap.get(areaId) : null;
        const controlledArea = controlledAreaId ? areaMap.get(controlledAreaId) : null;
        if (area?.name) tokens.push(area.name);
        if (controlledArea?.name) tokens.push(controlledArea.name);

        const areaFloor = area?.floor ? floorMap.get(String(area.floor)) : null;
        if (areaFloor?.name) tokens.push(areaFloor.name);

        const network = device?.networkId ? networkMap.get(String(device.networkId)) : null;
        if (network?.name) tokens.push(network.name);

        const uniqueTokens = Array.from(new Set(tokens.map(token => token.trim()).filter(Boolean)));
        const searchText = uniqueTokens.join(' ').toLowerCase();
        const name = String(device?.name || device?.model || 'Unnamed Device').trim();
        const nameLower = name.toLowerCase();
        const brand = String(device?.brand || '').trim();
        const type = String(device?.type || '').trim();
        const status = String(device?.status || '').trim();
        const metaParts = [brand, type, area?.name, controlledArea?.name, status].filter(Boolean);
        const meta = metaParts.join(' • ');
        const metaLower = meta.toLowerCase();

        const id = String(device?.id || '').trim();
        return {
            kind: 'device',
            searchText,
            name,
            nameLower,
            meta,
            metaLower,
            href: id ? `device-edit.html?id=${encodeURIComponent(id)}` : 'devices.html'
        };
    });
}

function buildTestCaseSearchIndex(testCases, testCaseRuns) {
    const latestRunByTest = new Map();
    (testCaseRuns || []).forEach((run) => {
        if (!run || typeof run !== 'object') return;
        const testCaseId = String(run.testCaseId || '').trim();
        if (!testCaseId) return;
        const executedAt = new Date(run.executedAt || '');
        if (Number.isNaN(executedAt.getTime())) return;
        const previous = latestRunByTest.get(testCaseId);
        if (!previous || executedAt.getTime() > previous.executedAt.getTime()) {
            latestRunByTest.set(testCaseId, {
                status: String(run.status || '').trim().toLowerCase(),
                executedAt
            });
        }
    });

    return (testCases || []).map((testCase) => {
        const id = String(testCase?.id || '').trim();
        const name = String(testCase?.name || '').trim() || 'Unnamed test case';
        const category = String(testCase?.category || '').trim();
        const description = String(testCase?.description || '').trim();
        const steps = String(testCase?.steps || '').trim();
        const expectedResult = String(testCase?.expectedResult || '').trim();
        const frequencyDaysRaw = Number(testCase?.frequencyDays);
        const frequencyDays = Number.isFinite(frequencyDaysRaw) && frequencyDaysRaw > 0
            ? Math.round(frequencyDaysRaw)
            : 30;
        const enabled = testCase?.enabled !== false;

        const latestRun = id ? latestRunByTest.get(id) : null;
        const latestRunLabel = latestRun
            ? `${latestRun.status || 'pass'} ${latestRun.executedAt.toLocaleDateString()}`
            : 'no runs';
        const statusLabel = enabled ? 'enabled' : 'disabled';
        const frequencyLabel = `every ${frequencyDays} day${frequencyDays === 1 ? '' : 's'}`;

        const tokens = [
            name,
            category,
            description,
            steps,
            expectedResult,
            statusLabel,
            frequencyLabel,
            latestRunLabel
        ];
        const searchText = tokens
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');

        const metaParts = [category, statusLabel, frequencyLabel, latestRun ? `last run: ${latestRun.status}` : 'not run yet']
            .filter(Boolean);
        const meta = metaParts.join(' • ');

        return {
            kind: 'test',
            searchText,
            name,
            nameLower: name.toLowerCase(),
            meta,
            metaLower: meta.toLowerCase(),
            href: id ? `test-case-add.html?id=${encodeURIComponent(id)}` : 'test-cases.html'
        };
    });
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatches(text, terms) {
    if (!text || !terms.length) return escapeHtml(text || '');
    const safe = escapeHtml(text);
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
    return safe.replace(pattern, '<mark>$1</mark>');
}

async function loadGlobalSearchIndex() {
    if (globalSearchReady && globalSearchIndex) return globalSearchIndex;
    if (globalSearchLoading) return globalSearchLoading;
    globalSearchLoading = (async () => {
        const data = await loadData();
        const deviceEntries = buildDeviceSearchIndex(
            data.devices || [],
            data.areas || [],
            data.floors || [],
            data.labels || [],
            data.networks || []
        );
        const testEntries = buildTestCaseSearchIndex(
            data.testCases || [],
            data.testCaseRuns || []
        );
        globalSearchIndex = [...deviceEntries, ...testEntries];
        globalSearchReady = true;
        return globalSearchIndex;
    })();
    return globalSearchLoading;
}

function renderGlobalSearchResults(results, query, resultsEl, terms) {
    if (!resultsEl) return;
    if (!results.length) {
        resultsEl.innerHTML = `<div class="global-search-empty">No results found for "${escapeHtml(query)}".</div>`;
        return;
    }
    resultsEl.innerHTML = results.map(result => {
        const title = highlightMatches(result.name || 'Unnamed Device', terms);
        const meta = result.meta ? `<div class="global-search-meta">${highlightMatches(result.meta, terms)}</div>` : '';
        const typeBadge = result.kind
            ? `<div class="global-search-kind">${escapeHtml(result.kind === 'test' ? 'Test Case' : 'Device')}</div>`
            : '';
        const href = result.href || '#';
        return `
            <a class="global-search-item" href="${href}" role="option">
                <div class="global-search-title-row">
                    <div class="global-search-title">${title}</div>
                    ${typeBadge}
                </div>
                ${meta}
            </a>
        `;
    }).join('');
}

function hideGlobalSearchResults(resultsEl) {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
}

function initGlobalSearch() {
    const container = ensureGlobalSearchMarkup();
    if (!container) return;
    const overlay = ensureGlobalSearchOverlay();
    const trigger = container.querySelector('.global-search-trigger');
    if (!overlay || !trigger) return;
    const overlayInput = overlay.querySelector('#global-search-overlay-input');
    const overlayResults = overlay.querySelector('#global-search-overlay-results');
    const overlayClear = overlay.querySelector('#global-search-overlay-clear');
    const overlayClose = overlay.querySelector('#global-search-overlay-close');
    if (!overlayInput || !overlayResults || !overlayClear || !overlayClose) return;

    let debounceId = null;
    let isOpen = false;

    const updateClearButton = () => {
        overlayClear.hidden = !overlayInput.value.trim();
    };

    const openOverlay = () => {
        if (isOpen) return;
        isOpen = true;
        overlay.hidden = false;
        overlay.classList.add('is-open');
        updateClearButton();
        setTimeout(() => overlayInput.focus(), 0);
    };

    const closeOverlay = () => {
        if (!isOpen) return;
        isOpen = false;
        overlay.classList.remove('is-open');
        overlay.hidden = true;
        hideGlobalSearchResults(overlayResults);
    };

    const runSearch = async () => {
        const query = overlayInput.value.trim();
        updateClearButton();
        if (!query) {
            hideGlobalSearchResults(overlayResults);
            return;
        }
        overlayResults.innerHTML = '<div class="global-search-empty">Searching...</div>';
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const index = await loadGlobalSearchIndex();
        const matches = index
            .map(item => {
                const matchAll = terms.every(term => item.searchText.includes(term));
                if (!matchAll) return null;
                let score = 0;
                terms.forEach(term => {
                    if (item.nameLower.includes(term)) {
                        score += 3;
                    } else if (item.metaLower.includes(term)) {
                        score += 2;
                    } else if (item.searchText.includes(term)) {
                        score += 1;
                    }
                });
                return { ...item, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .slice(0, 8);
        renderGlobalSearchResults(matches, query, overlayResults, terms);
    };

    trigger.addEventListener('click', openOverlay);

    overlayInput.addEventListener('input', () => {
        if (debounceId) {
            clearTimeout(debounceId);
        }
        debounceId = setTimeout(runSearch, 120);
    });

    overlayInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeOverlay();
            return;
        }
        if (event.key === 'Enter') {
            const firstResult = overlayResults.querySelector('.global-search-item');
            if (firstResult) {
                event.preventDefault();
                firstResult.click();
            }
        }
    });

    overlayClear.addEventListener('click', () => {
        overlayInput.value = '';
        updateClearButton();
        hideGlobalSearchResults(overlayResults);
        overlayInput.focus();
    });

    overlayClose.addEventListener('click', closeOverlay);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeOverlay();
        }
    });
}

let tooltipMeasureElement = null;

function getTooltipMeasureElement() {
    if (tooltipMeasureElement) return tooltipMeasureElement;
    const element = document.createElement('div');
    element.className = 'tooltip-measure';
    document.body.appendChild(element);
    tooltipMeasureElement = element;
    return element;
}

function measureTooltipWidth(text) {
    const element = getTooltipMeasureElement();
    if (!element) return 0;
    element.textContent = text;
    return element.getBoundingClientRect().width;
}

function updateTooltipAlignment(el) {
    if (!el || !el.dataset) return;
    const label = String(el.dataset.tooltip || '').trim();
    if (!label) return;
    const width = measureTooltipWidth(label);
    if (!width) return;
    const rect = el.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left)) return;
    const center = rect.left + rect.width / 2;
    const leftEdge = center - width / 2;
    const rightEdge = center + width / 2;
    const padding = 12;
    let align = 'center';
    if (leftEdge < padding && rightEdge > window.innerWidth - padding) {
        align = 'center';
    } else if (leftEdge < padding) {
        align = 'left';
    } else if (rightEdge > window.innerWidth - padding) {
        align = 'right';
    }
    el.dataset.tooltipAlign = align;
}

function bindTooltipAlignment(el) {
    if (!el || el.dataset.tooltipAlignBound === 'true') return;
    const handler = () => updateTooltipAlignment(el);
    el.addEventListener('mouseenter', handler);
    el.addEventListener('focus', handler);
    el.addEventListener('touchstart', handler, { passive: true });
    el.dataset.tooltipAlignBound = 'true';
}

function initIconTooltips() {
    document.querySelectorAll('.btn-icon').forEach(applyIconTooltip);
    document.querySelectorAll('[data-tooltip]').forEach(bindTooltipAlignment);
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.classList.contains('btn-icon')) {
                    applyIconTooltip(node);
                }
                if (node.matches && node.matches('[data-tooltip]')) {
                    bindTooltipAlignment(node);
                }
                node.querySelectorAll?.('[data-tooltip]').forEach(bindTooltipAlignment);
                node.querySelectorAll?.('.btn-icon').forEach(applyIconTooltip);
            });
        });
    });
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', () => {
        document.querySelectorAll('.btn-icon[data-tooltip]').forEach(updateTooltipAlignment);
    });
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

async function loadMapImagePositions() {
    const storage = await loadStorage();
    return storage.mapImagePositions || {};
}

async function saveMapImagePositions(positions) {
    await patchStorage({ mapImagePositions: positions || {} });
}

async function clearMapImagePositions() {
    await patchStorage({ mapImagePositions: null });
}

window.addEventListener('unhandledrejection', (event) => {
    if (!isStorageConflictError(event.reason)) {
        return;
    }
    event.preventDefault();
});

document.addEventListener('DOMContentLoaded', async () => {
    ensureAppFooter();
    await initDebugSettingsNav();
    initPrimaryNavIcons();
    initMobileNav();
    initIconTooltips();
    initGlobalSearch();
});
window.loadMapPositions = loadMapPositions;
window.saveMapPositions = saveMapPositions;
window.clearMapPositions = clearMapPositions;
window.loadMapImagePositions = loadMapImagePositions;
window.saveMapImagePositions = saveMapImagePositions;
window.clearMapImagePositions = clearMapImagePositions;
window.getUiPreference = getUiPreference;
window.setUiPreference = setUiPreference;
window.isStorageConflictError = isStorageConflictError;
window.APP_BASE_PATH = APP_BASE_PATH;
window.buildAppUrl = buildAppUrl;
window.isIngressRuntime = isIngressRuntime;
window.isLocalAddonRuntime = isLocalAddonRuntime;
window.getRuntimeInfo = getRuntimeInfo;
window.loadHaConfig = loadHaConfig;
window.loadHaBackupsStatus = loadHaBackupsStatus;
window.showToast = showToast;
