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

// Palette used to auto-assign a distinct color to each network/VLAN on the map.
// Values are picked to stay legible over the dark diagram canvas.
const NETWORK_COLOR_PALETTE = [
    '#006fff', // blue
    '#38cc65', // green
    '#f5a524', // amber
    '#a855f7', // purple
    '#00c2d1', // teal
    '#ec4899', // pink
    '#f97316', // orange
    '#f0383b', // red
    '#22d3ee', // cyan
    '#84cc16'  // lime
];

function buildNetwork(name, overrides = {}) {
    return {
        id: `network-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name,
        vlanId: null,
        color: '',
        subnet: '',
        ssid: '',
        gatewayDeviceId: '',
        isolated: false,
        noInternet: false,
        notes: '',
        createdAt: new Date().toISOString(),
        ...overrides
    };
}

function normalizeVlanId(value) {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4094) return null;
    return parsed;
}

function normalizeNetworkColor(value) {
    const raw = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : '';
}

// Backfill the extended network shape (VLAN id, color, subnet, flags, ...) on
// records that predate those fields, keeping legacy id/name/createdAt intact.
function normalizeNetwork(network) {
    if (!network || typeof network !== 'object') return null;
    return {
        id: String(network.id || '').trim() || `network-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: String(network.name || '').trim(),
        vlanId: normalizeVlanId(network.vlanId),
        color: normalizeNetworkColor(network.color),
        subnet: String(network.subnet || '').trim(),
        ssid: String(network.ssid || '').trim(),
        gatewayDeviceId: String(network.gatewayDeviceId || '').trim(),
        isolated: Boolean(network.isolated),
        noInternet: Boolean(network.noInternet),
        notes: String(network.notes || '').trim(),
        createdAt: network.createdAt || new Date().toISOString()
    };
}

// Resolve the effective color for every network: an explicit color wins,
// otherwise a stable palette color is assigned by catalog position so the same
// VLAN always renders in the same hue across pages.
function buildNetworkColorMap(networks) {
    const map = new Map();
    (Array.isArray(networks) ? networks : []).forEach((network, index) => {
        const id = String(network?.id || '').trim();
        if (!id) return;
        const explicit = normalizeNetworkColor(network.color);
        map.set(id, explicit || NETWORK_COLOR_PALETTE[index % NETWORK_COLOR_PALETTE.length]);
    });
    return map;
}

function getNetworkColor(networks, networkId) {
    const id = String(networkId || '').trim();
    if (!id) return '';
    return buildNetworkColorMap(networks).get(id) || '';
}

function getNetworkVlanLabel(network) {
    const vlanId = normalizeVlanId(network?.vlanId);
    return vlanId !== null ? `VLAN ${vlanId}` : '';
}

// `wireless: true` marks over-the-air last miles, drawn dashed on the diagram
// like the other wireless links.
const ISP_TECHNOLOGY_OPTIONS = [
    { value: 'fiber', label: 'Fiber' },
    { value: 'cable', label: 'Cable' },
    { value: 'dsl', label: 'DSL' },
    { value: '4g-5g', label: 'Cellular (4G/5G)', wireless: true },
    { value: 'satellite', label: 'Satellite', wireless: true },
    { value: 'fixed-wireless', label: 'Fixed Wireless', wireless: true },
    { value: 'other', label: 'Other' }
];

function getIspTechnologyOption(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ISP_TECHNOLOGY_OPTIONS.find(item => item.value === normalized) || null;
}

function getIspTechnologyLabel(value) {
    const option = getIspTechnologyOption(value);
    return option ? option.label : '';
}

function isWirelessIspTechnology(value) {
    const option = getIspTechnologyOption(value);
    return !!(option && option.wireless);
}

function buildIsp(name, overrides = {}) {
    return {
        id: `isp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name,
        technology: '',
        downloadSpeed: null,
        uploadSpeed: null,
        gatewayDeviceId: '',
        role: 'primary',
        notes: '',
        createdAt: new Date().toISOString(),
        ...overrides
    };
}

// Only these device types can terminate an ISP line, so only they can be picked
// as a gateway — a motion sensor never carries WAN. Canonical list shared by the
// diagram auto-detection, the Settings gateway picker and the device form.
const ISP_GATEWAY_ELIGIBLE_TYPES = new Set(['routers', 'modems', 'modems-ont', 'gateways']);

function isIspGatewayEligibleDevice(device) {
    if (!device || typeof device !== 'object') return false;
    const type = typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(device.type)
        : String(device.type || '').trim().toLowerCase();
    return ISP_GATEWAY_ELIGIBLE_TYPES.has(type);
}

function normalizeIspRefId(value) {
    return String(value == null ? '' : value).trim();
}

// The ISP↔gateway link lives only on the ISP (isp.gatewayDeviceId). These
// helpers let either end edit it while keeping both sides consistent, the same
// way wired/wireless links stay mirrored.

// ISPs whose gateway is this device (a device may feed several ISPs, e.g. a
// dual-WAN router with a primary and a backup line).
function getIspsForGatewayDevice(isps, deviceId) {
    const target = normalizeIspRefId(deviceId);
    if (!target || !Array.isArray(isps)) return [];
    return isps.filter(isp => isp && normalizeIspRefId(isp.gatewayDeviceId) === target);
}

// Returns a new isps array where `deviceId` is the gateway of exactly the ISPs
// in `selectedIspIds`: each selected ISP points here, and any ISP that pointed
// here but is no longer selected falls back to auto-detect (empty gateway).
// Assigning an ISP already owned by another device moves it here.
function setDeviceAsIspGateway(isps, deviceId, selectedIspIds) {
    const target = normalizeIspRefId(deviceId);
    if (!target || !Array.isArray(isps)) return Array.isArray(isps) ? isps : [];
    const selected = new Set((Array.isArray(selectedIspIds) ? selectedIspIds : []).map(normalizeIspRefId).filter(Boolean));
    return isps.map((isp) => {
        if (!isp) return isp;
        const ispId = normalizeIspRefId(isp.id);
        const shouldOwn = selected.has(ispId);
        const ownsNow = normalizeIspRefId(isp.gatewayDeviceId) === target;
        if (shouldOwn && !ownsNow) return { ...isp, gatewayDeviceId: target };
        if (!shouldOwn && ownsNow) return { ...isp, gatewayDeviceId: '' };
        return isp;
    });
}

// Deleting a device drops it as any ISP's gateway (those fall back to
// auto-detect), so no ISP is left pointing at a device that no longer exists.
function clearDeviceFromIspGateways(isps, deviceId) {
    return setDeviceAsIspGateway(isps, deviceId, []);
}

// Delete-confirmation wording that also accounts for ISP gateways, so a router
// that feeds an ISP but has no device links still warns the provider is affected.
function buildDeviceDeleteMessage(deviceRefCount, ispGatewayCount) {
    const parts = [];
    if (deviceRefCount > 0) {
        parts.push(`${deviceRefCount} other device${deviceRefCount === 1 ? '' : 's'} will be unassigned`);
    }
    if (ispGatewayCount > 0) {
        parts.push(`${ispGatewayCount} internet provider${ispGatewayCount === 1 ? '' : 's'} will lose ${ispGatewayCount === 1 ? 'its' : 'their'} gateway`);
    }
    if (!parts.length) {
        return 'Are you sure you want to delete this device?';
    }
    return `Are you sure you want to delete this device? ${parts.join(' and ')}.`;
}

function buildDefaultStorage() {
    return {
        devices: [],
        testCases: [],
        testCaseRuns: [],
        networks: [],
        isps: [],
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
        isps: Array.isArray(source.isps) ? source.isps : base.isps,
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

// Port Helper Functions
function generatePortId() {
    return `port-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPortKindFromType(portType) {
    const kind = String(portType || '').split('-')[0];
    const knownKinds = ['ethernet', 'sfp', 'sfpplus', 'hdmi', 'usb', 'power'];
    return knownKinds.includes(kind) ? kind : 'ethernet';
}

function getPortDirectionFromType(portType) {
    // Network links (Ethernet/SFP/SFP+) are always bidirectional
    const kind = getPortKindFromType(portType);
    if (kind === 'ethernet' || kind === 'sfp' || kind === 'sfpplus') return 'io';
    const direction = String(portType || '').split('-')[1];
    if (direction === 'output') return 'output';
    if (direction === 'io') return 'io';
    return 'input';
}

function getOppositePortDirection(direction) {
    if (direction === 'io') return 'io';
    return direction === 'output' ? 'input' : 'output';
}

function getPortNameGroup(portType) {
    const kind = getPortKindFromType(portType);
    if (kind === 'power') {
        return `power-${getPortDirectionFromType(portType) === 'output' ? 'output' : 'input'}`;
    }
    return kind;
}

function defaultPortName(portType, index) {
    const kind = getPortKindFromType(portType);
    if (kind === 'usb') return `USB ${index}`;
    if (kind === 'sfp') return `SFP ${index}`;
    if (kind === 'sfpplus') return `SFP+ ${index}`;
    if (kind === 'hdmi') return `HDMI ${index}`;
    if (kind === 'power') {
        return getPortDirectionFromType(portType) === 'output' ? `Power Out ${index}` : `Power In ${index}`;
    }
    return `Ethernet ${index}`;
}

// Display label for a port, derived from its position among the device's
// ports of the same kind/direction group (e.g. "Ethernet 2", "Power Out 1")
function getPortDisplayLabel(device, port) {
    const ports = (device && Array.isArray(device.ports)) ? device.ports : [];
    const group = getPortNameGroup(port && port.type);
    let index = 0;
    for (const p of ports) {
        if (!p || typeof p !== 'object') continue;
        if (getPortNameGroup(p.type) !== group) continue;
        index++;
        if (p === port || (port && port.id && String(p.id || '') === String(port.id))) {
            return defaultPortName(port.type, index);
        }
    }
    return defaultPortName(port && port.type, index + 1);
}

// Migrate legacy ports: ensure stable ids and pair up mirrored
// connections that predate port identities (connectedToPort).
function migrateDevicePorts(deviceList) {
    let didUpdate = false;
    const list = Array.isArray(deviceList) ? deviceList : [];

    // 1) Ensure every port has a stable id (labels are derived from position,
    //    so a previously stored name is dropped). Also normalize legacy network
    //    ports (Ethernet/SFP/SFP+) to the bidirectional "-io" direction, since
    //    Direction is no longer a user choice for network links.
    list.forEach(device => {
        if (!device || !Array.isArray(device.ports)) return;
        device.ports.forEach(port => {
            if (!port || typeof port !== 'object') return;
            if (!port.id) {
                port.id = generatePortId();
                didUpdate = true;
            }
            if (port.name !== undefined) {
                delete port.name;
                didUpdate = true;
            }
            const kind = getPortKindFromType(port.type);
            if ((kind === 'ethernet' || kind === 'sfp' || kind === 'sfpplus') &&
                !String(port.type || '').endsWith('-io')) {
                port.type = `${kind}-io`;
                didUpdate = true;
            }
        });
    });

    // 2) Pair up mirrored legacy connections one-to-one
    list.forEach(device => {
        const deviceId = String(device && device.id || '').trim();
        if (!deviceId || !Array.isArray(device.ports)) return;
        device.ports.forEach(port => {
            if (!port || typeof port !== 'object') return;
            const targetId = String(port.connectedTo || '').trim();
            if (!targetId || port.connectedToPort) return;
            const target = list.find(d => d && String(d.id || '').trim() === targetId);
            if (!target || !Array.isArray(target.ports)) return;
            const kind = getPortKindFromType(port.type);
            const wantedDirection = getOppositePortDirection(getPortDirectionFromType(port.type));
            const mirror = target.ports.find(p =>
                p && typeof p === 'object' &&
                String(p.connectedTo || '').trim() === deviceId &&
                !p.connectedToPort &&
                getPortKindFromType(p.type) === kind &&
                getPortDirectionFromType(p.type) === wantedDirection
            );
            if (mirror) {
                port.connectedToPort = mirror.id;
                mirror.connectedToPort = port.id;
                didUpdate = true;
            }
        });
    });

    return didUpdate;
}

// Data Management Functions
async function loadData() {
    const storage = await loadStorage();
    const devices = Array.isArray(storage.devices) ? storage.devices : [];
    const testCases = Array.isArray(storage.testCases) ? storage.testCases : [];
    const testCaseRuns = Array.isArray(storage.testCaseRuns) ? storage.testCaseRuns : [];
    let networks = Array.isArray(storage.networks) ? storage.networks : [];
    let isps = Array.isArray(storage.isps) ? storage.isps : [];
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

    // Backfill the extended network fields on legacy records (missing `color`
    // is a reliable marker) and persist the migration once.
    const hasLegacyNetworks = networks.some(net => net && typeof net === 'object' && net.color === undefined);
    networks = networks.map(normalizeNetwork).filter(Boolean);
    if (hasLegacyNetworks) {
        didUpdate = true;
    }

    if (!Array.isArray(isps) || isps.length === 0) {
        isps = [buildIsp('Internet')];
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

    if (migrateDevicePorts(devices)) {
        didUpdate = true;
    }

    if (didUpdate) {
        await patchStorage({
            devices,
            networks,
            isps
        });
    }

    return {
        devices: devices,
        testCases: testCases,
        testCaseRuns: testCaseRuns,
        areas: areas,
        floors: floors,
        networks: networks,
        isps: isps,
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
//
// Option lists are the union of two sources:
//   • defaults — they live in the code and are never editable. Renaming one used
//     to silently break features, because their normalized slugs are hardcoded
//     all over: icon files (`img/devices/routers.svg`), the ISP gateway hints,
//     the Wi-Fi/Zigbee/Z-Wave map layers, the Amazon ASIN lookup for batteries.
//     Keeping them in the code also means a new default ships to everyone,
//     instead of being frozen out by whatever list the user happened to save.
//   • customs — the user's own values, freely renamed and deleted.
// A default the user does not care about can be hidden, which drops it from the
// pickers without touching its slug.
const OPTION_GROUP_KEYS = ['brands', 'types', 'connectivity', 'batteryTypes', 'testCaseCategories'];
// Connectivity values are protocols with dedicated logic behind them, so a
// custom one would be an inert label. Existing customs stay deletable.
const FIXED_OPTION_GROUP_KEYS = new Set(['connectivity']);

function isFixedOptionGroup(key) {
    return FIXED_OPTION_GROUP_KEYS.has(key);
}

function getDefaultOptionValues() {
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
        testCaseCategories: [...(DEFAULT_TEST_CASE_CATEGORIES || [])]
    };
}

function getDefaultOptionValuesByKey(key) {
    const defaults = getDefaultOptionValues();
    return Array.isArray(defaults[key]) ? defaults[key] : [];
}

function isDefaultOptionValue(key, value) {
    const normalized = normalizeOptionValue(value);
    if (!normalized) return false;
    return getDefaultOptionValuesByKey(key).some(item => normalizeOptionValue(item) === normalized);
}

function sortOptionLabels(values) {
    return [...(values || [])].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
}

function normalizeOptionSlugList(values) {
    const seen = new Set();
    (values || []).forEach((value) => {
        const normalized = normalizeOptionValue(value);
        if (normalized) seen.add(normalized);
    });
    return [...seen];
}

// Drops blanks, duplicates (by slug) and anything that collides with a default.
function normalizeCustomOptionValues(key, values) {
    const result = [];
    const seen = new Set();
    (values || []).forEach((value) => {
        const label = String(value || '').trim();
        const normalized = normalizeOptionValue(label);
        if (!normalized || seen.has(normalized)) return;
        if (isDefaultOptionValue(key, label)) return;
        seen.add(normalized);
        result.push(label);
    });
    return result;
}

function buildOptionGroupMap(factory) {
    const result = {};
    OPTION_GROUP_KEYS.forEach((key) => {
        result[key] = factory(key);
    });
    return result;
}

function getCustomOptionValues(settings, key) {
    const source = settings?.customOptions?.[key];
    return normalizeCustomOptionValues(key, Array.isArray(source) ? source : []);
}

function getHiddenDefaultSlugs(settings, key) {
    const source = settings?.hiddenDefaults?.[key];
    return normalizeOptionSlugList(Array.isArray(source) ? source : []);
}

function isHiddenDefaultOption(settings, key, value) {
    const normalized = normalizeOptionValue(value);
    if (!normalized) return false;
    return getHiddenDefaultSlugs(settings, key).includes(normalized);
}

// What every picker and filter sees: visible defaults plus customs.
function getEffectiveOptionValues(settings, key) {
    const hidden = new Set(getHiddenDefaultSlugs(settings, key));
    const visibleDefaults = getDefaultOptionValuesByKey(key)
        .filter(value => !hidden.has(normalizeOptionValue(value)));
    return sortOptionLabels([...visibleDefaults, ...getCustomOptionValues(settings, key)]);
}

function normalizeHaAreaSyncTarget(value) {
    return value === 'installed' ? 'installed' : 'controlled';
}

// Pre-1.8.0 storage kept one flat list per group, mixing defaults and customs.
// Extracting the customs is exact — whatever is not a default is a custom.
//
// Missing defaults are deliberately NOT turned into hidden ones, even though a
// user may well have deleted them: an absent default is equally consistent with
// "deleted on purpose" and "added by a release after this list was frozen", and
// the two cannot be told apart. The errors are not symmetric — hiding something
// the user never deleted loses an option silently, while showing something they
// did delete is visible noise they can re-hide in one click — so the tie breaks
// toward showing. Hidden state starts empty and is exact from here on.
function migrateLegacyOptionLists(settings) {
    const legacyKeys = OPTION_GROUP_KEYS.filter(key => Array.isArray(settings?.[key]));
    if (!legacyKeys.length) return { settings, migrated: false };

    const customOptions = { ...(settings.customOptions || {}) };

    legacyKeys.forEach((key) => {
        if (Array.isArray(customOptions[key])) return;
        const legacyList = ensureFriendlyList(settings[key], key === 'connectivity' ? formatConnectivity : formatDeviceType);
        customOptions[key] = legacyList.filter(value => !isDefaultOptionValue(key, value));
    });

    const next = { ...settings, customOptions };
    OPTION_GROUP_KEYS.forEach((key) => { delete next[key]; });
    return { settings: next, migrated: true };
}

function normalizeSettings(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const normalized = {
        ...source,
        customOptions: buildOptionGroupMap(key => normalizeCustomOptionValues(key, source.customOptions?.[key])),
        hiddenDefaults: buildOptionGroupMap(key => normalizeOptionSlugList(source.hiddenDefaults?.[key])),
        haAreaSyncTarget: normalizeHaAreaSyncTarget(source.haAreaSyncTarget)
    };
    // Effective lists are derived, never stored — see stripDerivedOptionLists.
    OPTION_GROUP_KEYS.forEach((key) => {
        normalized[key] = getEffectiveOptionValues(normalized, key);
    });
    return normalized;
}

// loadSettings hands back the effective lists so every caller keeps reading
// `settings.types` as before; only `customOptions`/`hiddenDefaults` are stored.
function stripDerivedOptionLists(settings) {
    const stored = { ...(settings && typeof settings === 'object' ? settings : {}) };
    OPTION_GROUP_KEYS.forEach((key) => { delete stored[key]; });
    return stored;
}

async function loadSettings() {
    const storage = await loadStorage();
    const stored = storage.settings && typeof storage.settings === 'object' ? storage.settings : null;
    const { settings: unmigrated, migrated } = migrateLegacyOptionLists(stored || {});
    const settings = normalizeSettings(unmigrated);
    if (!stored || migrated) {
        await saveStorage({ ...storage, settings: stripDerivedOptionLists(settings) });
    }
    return settings;
}

async function saveSettings(settings) {
    const storage = await loadStorage();
    await saveStorage({
        ...storage,
        settings: stripDerivedOptionLists(normalizeSettings(settings))
    });
}

// Adds a user value to a group and returns the reloaded settings. Used by the
// quick-add modals on the device form.
async function addCustomOptionValue(key, value) {
    const settings = await loadSettings();
    const label = String(value || '').trim();
    if (!label || !OPTION_GROUP_KEYS.includes(key)) return settings;

    const normalized = normalizeOptionValue(label);
    // Re-adding a hidden default brings it back instead of creating a twin.
    if (isDefaultOptionValue(key, label)) {
        const hidden = getHiddenDefaultSlugs(settings, key).filter(slug => slug !== normalized);
        return await persistSettingsPatch(settings, { hiddenDefaults: { ...settings.hiddenDefaults, [key]: hidden } });
    }
    if (getCustomOptionValues(settings, key).some(item => normalizeOptionValue(item) === normalized)) {
        return settings;
    }
    const customs = [...getCustomOptionValues(settings, key), label];
    return await persistSettingsPatch(settings, { customOptions: { ...settings.customOptions, [key]: customs } });
}

async function persistSettingsPatch(settings, patch) {
    const next = { ...settings, ...patch };
    await saveSettings(next);
    return normalizeSettings(next);
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

function getDeviceStorages(device) {
    if (!device) return [];
    const normalized = [];
    (Array.isArray(device.storages) ? device.storages : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const size = Number(item.size);
        if (!Number.isFinite(size) || size <= 0) return;
        normalized.push({
            size,
            unit: String(item.unit || '').trim(),
            type: String(item.type || '').trim()
        });
    });
    if (normalized.length) return normalized;
    // Legacy single-storage fields (storageSize/storageUnit)
    const legacySize = Number(device.storageSize);
    if (Number.isFinite(legacySize) && legacySize > 0) {
        return [{
            size: legacySize,
            unit: String(device.storageUnit || '').trim(),
            type: ''
        }];
    }
    return [];
}

function formatDeviceStorageSummary(device, separator = ' + ') {
    return getDeviceStorages(device)
        .map((storage) => [storage.size, storage.unit, storage.type].filter(Boolean).join(' '))
        .join(separator);
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

function getAreaById(areas, id) {
    return areas.find(area => String(area.id) === String(id));
}

function getAreaName(areas, id) {
    const area = getAreaById(areas, id);
    return area ? area.name : 'Unknown';
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
    if (cleanHref.endsWith('map.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.4"></circle><circle cx="5" cy="18" r="2.4"></circle><circle cx="19" cy="18" r="2.4"></circle><path d="M12 7.4v4.1"></path><path d="M11 13l-4.4 3.1"></path><path d="M13 13l4.4 3.1"></path></svg>';
    }
    if (cleanHref.endsWith('index.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-7 9 7"></path><path d="M6 9.5v10.5h12v-10.5"></path><path d="M10 20v-5h4v5"></path></svg>';
    }
    if (cleanHref.endsWith('devices.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect></svg>';
    }
    if (cleanHref.endsWith('test-cases.html')) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v3H9z"></path><path d="M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2"></path><path d="M9 13.5l2 2 4-4.5"></path></svg>';
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

const DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"], input[type="month"]';

function syncDateInputs(root = document) {
    root.querySelectorAll(DATE_INPUT_SELECTOR).forEach((input) => {
        input.classList.toggle('has-value', Boolean(input.value));
    });
}

function initDateInputs() {
    syncDateInputs();
    // Cheap full re-sync on any interaction so programmatic resets stay in sync too
    document.addEventListener('input', () => syncDateInputs());
    document.addEventListener('change', () => syncDateInputs());
    document.addEventListener('click', () => syncDateInputs());
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

// ── Custom select dropdown (UniFi OS style) ─────────────────────────
// Progressive enhancement: every single-value <select> stays in the DOM
// as the source of truth (value, validation, change events), but the
// native browser popup is replaced with a UniFi-styled floating menu.
// Opt out per element with data-native-select="true".

const UI_SELECT_MENU_ID = 'ui-select-menu';
let uiSelectActive = null;
let uiSelectHighlight = -1;
let uiSelectTypeahead = '';
let uiSelectTypeaheadTimer = null;
// Option indexes hidden by the search filter of the currently open menu
const uiSelectFilterHidden = new Set();

// Opt in per element with data-searchable="true" to show a search box
// inside the menu that filters options as you type.
function isUiSelectSearchable(select) {
    return select instanceof HTMLSelectElement && select.dataset.searchable === 'true';
}

function isUiSelectCandidate(select) {
    if (!(select instanceof HTMLSelectElement)) return false;
    if (select.multiple || select.size > 1) return false;
    if (select.dataset.nativeSelect === 'true') return false;
    if (select.classList.contains('visually-hidden')) return false;
    return true;
}

function getUiSelectMenu() {
    return document.getElementById(UI_SELECT_MENU_ID);
}

function ensureUiSelectMenu() {
    let menu = getUiSelectMenu();
    if (menu) return menu;
    if (!document.body) return null;

    menu = document.createElement('div');
    menu.id = UI_SELECT_MENU_ID;
    menu.className = 'ui-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.tabIndex = -1;
    document.body.appendChild(menu);

    // Keep focus on the select and stop outside-click handlers (filters
    // drawer, dialogs, popovers) from reacting to clicks inside the menu.
    // The search input is the exception: it must be able to take focus.
    menu.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        const inSearch = event.target instanceof HTMLElement && event.target.closest('.ui-select-search');
        if (event.target !== menu && !inSearch) {
            event.preventDefault();
        }
    });
    menu.addEventListener('click', (event) => {
        event.stopPropagation();
        const item = event.target.closest('.ui-select-option');
        if (!item || item.classList.contains('is-disabled')) return;
        commitUiSelectOption(Number(item.dataset.index));
    });
    menu.addEventListener('mousemove', (event) => {
        const item = event.target.closest('.ui-select-option');
        if (!item || item.classList.contains('is-disabled')) return;
        const index = Number(item.dataset.index);
        if (index !== uiSelectHighlight) {
            setUiSelectHighlight(index, { scroll: false });
        }
    });
    // Mirror keyboard handling in case the menu itself gains focus
    // (e.g. after a scrollbar interaction).
    menu.addEventListener('keydown', handleUiSelectOpenKeydown);
    return menu;
}

function getUiSelectNavigableIndexes(select) {
    return Array.from(select.options)
        .filter(option => !option.disabled && !option.hidden && !uiSelectFilterHidden.has(option.index))
        .map(option => option.index);
}

function renderUiSelectMenu(select) {
    const menu = ensureUiSelectMenu();
    if (!menu) return null;

    const parts = [];
    const renderOption = (option) => {
        if (option.hidden) return;
        const isSelected = option.index === select.selectedIndex;
        const classes = ['ui-select-option'];
        if (option.disabled) classes.push('is-disabled');
        if (isSelected) classes.push('is-selected');
        const label = escapeHtml(String(option.textContent || '').trim());
        // Pinned options (e.g. "+ Add new …") stay visible while searching
        const pinned = option.dataset.uiSelectPinned === 'true' ? ' data-pinned="true"' : '';
        parts.push(`
            <div class="${classes.join(' ')}" role="option" data-index="${option.index}"${pinned} aria-selected="${isSelected ? 'true' : 'false'}"${option.disabled ? ' aria-disabled="true"' : ''}>
                <span class="ui-select-option-label">${label || '&nbsp;'}</span>
                <svg class="ui-select-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"></path></svg>
            </div>
        `);
    };
    Array.from(select.children).forEach((child) => {
        if (child.tagName === 'OPTGROUP') {
            parts.push(`<div class="ui-select-group-label">${escapeHtml(String(child.label || '').trim())}</div>`);
            Array.from(child.children).forEach((option) => {
                if (option.tagName === 'OPTION') renderOption(option);
            });
        } else if (child.tagName === 'OPTION') {
            renderOption(child);
        }
    });
    uiSelectFilterHidden.clear();
    const searchable = isUiSelectSearchable(select);
    const optionsHtml = parts.join('') || '<div class="ui-select-empty">No options available</div>';
    menu.innerHTML =
        (searchable
            ? `<div class="ui-select-search">
                <input type="text" class="ui-select-search-input" placeholder="Search…" autocomplete="off" spellcheck="false" aria-label="Filter options">
                <button type="button" class="ui-select-search-clear" aria-label="Clear search" hidden>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>
                </button>
            </div>`
            : '') +
        `<div class="ui-select-options">${optionsHtml}<div class="ui-select-empty ui-select-no-matches" hidden>No matches</div></div>`;
    if (searchable) {
        const searchInput = menu.querySelector('.ui-select-search-input');
        searchInput.addEventListener('input', applyUiSelectSearchFilter);
        menu.querySelector('.ui-select-search-clear').addEventListener('click', () => {
            searchInput.value = '';
            applyUiSelectSearchFilter();
            searchInput.focus();
        });
    }
    return menu;
}

function applyUiSelectSearchFilter() {
    const select = uiSelectActive;
    const menu = getUiSelectMenu();
    if (!select || !menu) return;
    const input = menu.querySelector('.ui-select-search-input');
    const query = String(input?.value || '').trim().toLowerCase();
    const clearButton = menu.querySelector('.ui-select-search-clear');
    if (clearButton) clearButton.hidden = !(input && input.value.length);
    uiSelectFilterHidden.clear();
    let visibleCount = 0;
    menu.querySelectorAll('.ui-select-option').forEach((item) => {
        const label = String(item.textContent || '').trim().toLowerCase();
        const pinned = item.dataset.pinned === 'true';
        const matches = !query || pinned || label.includes(query);
        item.classList.toggle('is-hidden', !matches);
        if (matches) {
            visibleCount++;
        } else {
            uiSelectFilterHidden.add(Number(item.dataset.index));
        }
    });
    menu.querySelectorAll('.ui-select-group-label').forEach((label) => {
        label.classList.toggle('is-hidden', Boolean(query));
    });
    const noMatches = menu.querySelector('.ui-select-no-matches');
    if (noMatches) noMatches.hidden = visibleCount > 0;
    const nav = getUiSelectNavigableIndexes(select);
    if (!nav.includes(uiSelectHighlight)) {
        setUiSelectHighlight(nav.length ? nav[0] : -1);
    }
}

function positionUiSelectMenu(menu, select) {
    const rect = select.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 6;
    const margin = 8;

    const triggerWidth = Math.round(Math.min(rect.width, viewportWidth - margin * 2));
    menu.style.minWidth = `${triggerWidth}px`;
    menu.style.maxWidth = `${Math.round(Math.min(Math.max(rect.width, 320), viewportWidth - margin * 2))}px`;

    const spaceBelow = viewportHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(300, Math.max(openUp ? spaceAbove : spaceBelow, 120));
    menu.style.maxHeight = `${Math.round(maxHeight)}px`;

    const menuRect = menu.getBoundingClientRect();
    let left = Math.min(rect.left, viewportWidth - menuRect.width - margin);
    left = Math.max(margin, left);
    let top = openUp ? rect.top - gap - menuRect.height : rect.bottom + gap;
    top = Math.max(margin, Math.min(top, viewportHeight - menuRect.height - margin));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

function setUiSelectHighlight(index, options = {}) {
    const menu = getUiSelectMenu();
    if (!menu || !uiSelectActive) return;
    uiSelectHighlight = index;
    let activeItem = null;
    menu.querySelectorAll('.ui-select-option').forEach((item) => {
        const isActive = Number(item.dataset.index) === index;
        item.classList.toggle('is-active', isActive);
        if (isActive) activeItem = item;
    });
    if (!activeItem || options.scroll === false) return;
    const scroller = menu.querySelector('.ui-select-options') || menu;
    const itemTop = activeItem.offsetTop;
    const itemBottom = itemTop + activeItem.offsetHeight;
    if (options.block === 'center') {
        scroller.scrollTop = itemTop - (scroller.clientHeight - activeItem.offsetHeight) / 2;
    } else if (itemTop < scroller.scrollTop) {
        scroller.scrollTop = itemTop;
    } else if (itemBottom > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = itemBottom - scroller.clientHeight;
    }
}

function moveUiSelectHighlight(delta) {
    const select = uiSelectActive;
    if (!select) return;
    const nav = getUiSelectNavigableIndexes(select);
    if (!nav.length) return;
    const pos = nav.indexOf(uiSelectHighlight);
    let nextPos = pos === -1 ? (delta > 0 ? 0 : nav.length - 1) : pos + delta;
    nextPos = Math.max(0, Math.min(nav.length - 1, nextPos));
    setUiSelectHighlight(nav[nextPos]);
}

function applyUiSelectTypeahead(char) {
    const select = uiSelectActive;
    if (!select) return;
    const nav = getUiSelectNavigableIndexes(select);
    if (!nav.length) return;

    if (uiSelectTypeaheadTimer) clearTimeout(uiSelectTypeaheadTimer);
    uiSelectTypeaheadTimer = setTimeout(() => {
        uiSelectTypeahead = '';
    }, 700);

    const lower = char.toLowerCase();
    const isRepeatCycle = uiSelectTypeahead.length > 0 &&
        uiSelectTypeahead.split('').every(value => value === lower);
    uiSelectTypeahead += lower;

    const labelAt = (index) => String(select.options[index].textContent || '').trim().toLowerCase();
    let match = -1;
    if (isRepeatCycle) {
        // Repeating the same letter cycles through options starting with it
        const start = nav.indexOf(uiSelectHighlight);
        for (let step = 1; step <= nav.length; step++) {
            const index = nav[(start + step) % nav.length];
            if (labelAt(index).startsWith(lower)) {
                match = index;
                break;
            }
        }
    } else {
        match = nav.find(index => labelAt(index).startsWith(uiSelectTypeahead)) ?? -1;
    }
    if (match >= 0) {
        setUiSelectHighlight(match);
    }
}

function openUiSelectMenu(select) {
    if (uiSelectActive === select) return;
    closeUiSelectMenu();
    const menu = renderUiSelectMenu(select);
    if (!menu) return;

    uiSelectActive = select;
    menu.classList.add('is-open');
    select.classList.add('is-open');
    select.setAttribute('aria-expanded', 'true');
    select.setAttribute('aria-controls', UI_SELECT_MENU_ID);
    positionUiSelectMenu(menu, select);

    const nav = getUiSelectNavigableIndexes(select);
    const initial = nav.includes(select.selectedIndex) ? select.selectedIndex : (nav[0] ?? -1);
    if (initial >= 0) {
        setUiSelectHighlight(initial, { block: 'center' });
    }

    if (isUiSelectSearchable(select)) {
        const searchInput = menu.querySelector('.ui-select-search-input');
        if (searchInput) searchInput.focus({ preventScroll: true });
    }
}

function closeUiSelectMenu() {
    if (!uiSelectActive) return;
    const menu = getUiSelectMenu();
    if (menu) {
        menu.classList.remove('is-open');
        menu.innerHTML = '';
    }
    uiSelectActive.classList.remove('is-open');
    uiSelectActive.setAttribute('aria-expanded', 'false');
    uiSelectActive.removeAttribute('aria-controls');
    uiSelectActive = null;
    uiSelectHighlight = -1;
    uiSelectTypeahead = '';
    uiSelectFilterHidden.clear();
}

function commitUiSelectOption(index) {
    const select = uiSelectActive;
    if (!select) return;
    closeUiSelectMenu();
    select.focus();
    if (!Number.isInteger(index) || index < 0 || index >= select.options.length) return;
    const option = select.options[index];
    if (!option || option.disabled) return;
    if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

function handleUiSelectOpenKeydown(event) {
    const select = uiSelectActive;
    if (!select) return;
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            moveUiSelectHighlight(1);
            return;
        case 'ArrowUp':
            event.preventDefault();
            moveUiSelectHighlight(-1);
            return;
        case 'PageDown':
            event.preventDefault();
            moveUiSelectHighlight(8);
            return;
        case 'PageUp':
            event.preventDefault();
            moveUiSelectHighlight(-8);
            return;
        case 'Home':
            event.preventDefault();
            moveUiSelectHighlight(-Infinity);
            return;
        case 'End':
            event.preventDefault();
            moveUiSelectHighlight(Infinity);
            return;
        case 'Enter':
            event.preventDefault();
            commitUiSelectOption(uiSelectHighlight);
            return;
        case ' ':
            // With a search box open, space types into the query instead
            if (isUiSelectSearchable(select)) return;
            event.preventDefault();
            commitUiSelectOption(uiSelectHighlight);
            return;
        case 'Escape':
            // Only close the menu; keep drawers/dialogs behind it open
            event.preventDefault();
            event.stopPropagation();
            closeUiSelectMenu();
            select.focus();
            return;
        case 'Tab':
            closeUiSelectMenu();
            // The focused search input is destroyed on close, so restore
            // focus to the select to keep the tab order predictable.
            if (isUiSelectSearchable(select)) {
                event.preventDefault();
                select.focus();
            }
            return;
        default:
            // Searchable menus filter via the search input, not typeahead
            if (isUiSelectSearchable(select)) return;
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                applyUiSelectTypeahead(event.key);
            }
    }
}

function toggleUiSelectMenu(select) {
    if (uiSelectActive === select) {
        closeUiSelectMenu();
    } else {
        openUiSelectMenu(select);
    }
}

function enhanceUiSelect(select) {
    if (!isUiSelectCandidate(select) || select.dataset.uiSelect === 'true') return;
    select.dataset.uiSelect = 'true';
    select.setAttribute('aria-haspopup', 'listbox');
    select.setAttribute('aria-expanded', 'false');

    select.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        select.focus();
        toggleUiSelectMenu(select);
    });

    let touchStartY = null;
    select.addEventListener('touchstart', (event) => {
        touchStartY = event.touches[0] ? event.touches[0].clientY : null;
    }, { passive: true });
    select.addEventListener('touchend', (event) => {
        const touch = event.changedTouches[0];
        if (touchStartY !== null && touch && Math.abs(touch.clientY - touchStartY) > 10) return;
        if (!event.cancelable) return;
        event.preventDefault();
        select.focus();
        toggleUiSelectMenu(select);
    });

    select.addEventListener('keydown', (event) => {
        if (uiSelectActive === select) {
            handleUiSelectOpenKeydown(event);
            return;
        }
        if (event.ctrlKey || event.metaKey) return;
        const opensMenu = event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
            event.key === 'Enter' || event.key === ' ' ||
            (event.key.length === 1 && !event.altKey);
        if (!opensMenu) return;
        event.preventDefault();
        openUiSelectMenu(select);
        if (event.key.length === 1 && event.key !== ' ') {
            if (isUiSelectSearchable(select)) {
                const searchInput = getUiSelectMenu()?.querySelector('.ui-select-search-input');
                if (searchInput) {
                    searchInput.value = event.key;
                    applyUiSelectSearchFilter();
                }
            } else {
                applyUiSelectTypeahead(event.key);
            }
        }
    });
}

function initUiSelects() {
    if (!document.body) return;
    ensureUiSelectMenu();
    document.querySelectorAll('select').forEach(enhanceUiSelect);

    // Close on any interaction outside the menu (capture phase so other
    // handlers cannot swallow the event first).
    document.addEventListener('mousedown', (event) => {
        if (!uiSelectActive) return;
        if (event.target === uiSelectActive) return;
        const menu = getUiSelectMenu();
        if (menu && event.target instanceof Node && menu.contains(event.target)) return;
        closeUiSelectMenu();
    }, true);

    window.addEventListener('resize', () => {
        const menu = getUiSelectMenu();
        if (uiSelectActive && menu) positionUiSelectMenu(menu, uiSelectActive);
    });

    // Follow the trigger when the page or a drawer/modal body scrolls
    window.addEventListener('scroll', (event) => {
        if (!uiSelectActive) return;
        const menu = getUiSelectMenu();
        if (!menu) return;
        if (event.target instanceof Node && menu.contains(event.target)) return;
        positionUiSelectMenu(menu, uiSelectActive);
    }, true);

    window.addEventListener('blur', () => closeUiSelectMenu());

    // Enhance selects rendered after load (port rows, rebuilt filters, …)
    const observer = new MutationObserver((mutations) => {
        let hasNewSelect = false;
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) return;
                if (node.tagName === 'SELECT' || (node.querySelector && node.querySelector('select'))) {
                    hasNewSelect = true;
                }
            });
        });
        if (hasNewSelect) {
            document.querySelectorAll('select').forEach(enhanceUiSelect);
        }
        if (uiSelectActive && !document.contains(uiSelectActive)) {
            closeUiSelectMenu();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
    initDateInputs();
    initIconTooltips();
    initGlobalSearch();
    initUiSelects();
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
window.syncDateInputs = syncDateInputs;
window.APP_BASE_PATH = APP_BASE_PATH;
window.buildAppUrl = buildAppUrl;
window.isIngressRuntime = isIngressRuntime;
window.isLocalAddonRuntime = isLocalAddonRuntime;
window.getRuntimeInfo = getRuntimeInfo;
window.loadHaConfig = loadHaConfig;
window.loadHaBackupsStatus = loadHaBackupsStatus;
window.showToast = showToast;
