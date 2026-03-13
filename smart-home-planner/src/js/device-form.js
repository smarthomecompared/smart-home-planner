// Device Form JavaScript (shared for add and edit)

let allDevices = [];
let devices = [];
let allAreas = [];
let areas = [];
let allLabels = [];
let labels = [];
let editingDeviceId = null;
let settings = {};
let networks = [];
let lastBrandValue = '';
let lastTypeValue = '';
let lastBatteryTypeValue = '';
let lastConnectivityValue = '';
let autoSyncAreasEnabled = false;
let activeDeviceId = '';
let deviceFiles = [];
let currentDeviceImage = null;
let pendingDeviceImageFile = null;
let deviceFilePreviewModal = null;
let deviceFileRenameModal = null;
let haDefaultCurrency = '';
let haCountryCode = '';
let selectedWifiClientIds = new Set();
let selectedZigbeeChildIds = new Set();
let selectedZwaveChildIds = new Set();
const amazonBatteryMetaMap = buildAmazonBatteryMetaMap();

const AMAZON_STORE_DOMAINS = {
    amazon_us: 'amazon.com',
    amazon_ca: 'amazon.ca',
    amazon_de: 'amazon.de',
    amazon_uk: 'amazon.co.uk'
};
const HA_DEVICE_NAME_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-name') : '/api/ha/device-name';
const HA_DEVICE_AREA_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-area') : '/api/ha/device-area';
const HA_DEVICE_LABELS_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-labels') : '/api/ha/device-labels';
const DEVICE_FILES_UPLOAD_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files/upload') : '/api/device-files/upload';
const DEVICE_FILES_CONTENT_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files/content') : '/api/device-files/content';
const DEVICE_FILES_DELETE_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files') : '/api/device-files';
const DEVICE_FILES_RENAME_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files/rename') : '/api/device-files/rename';
const MAX_DEVICE_FILE_BYTES = 20 * 1024 * 1024;

function isHomeAssistantLinked(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function showFormMessage(message, type = 'success') {
    if (typeof showToast === 'function') {
        showToast(message, type === 'error' ? 'error' : 'success');
    }
}

function generateDeviceId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWifiBand(value) {
    const normalized = normalizeOptionValue(value);
    if (normalized === '2.4-ghz' || normalized === '5-ghz' || normalized === '6-ghz') {
        return normalized;
    }
    return '';
}

function parseOptionalNonNegativeNumber(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
}

function parseOptionalNonNegativeNumberWithError(value, fieldLabel) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return { value: null, error: '' };
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
        return { value: null, error: `${fieldLabel} must be a valid number.` };
    }
    if (parsed < 0) {
        return { value: null, error: `${fieldLabel} cannot be negative.` };
    }
    return { value: parsed, error: '' };
}

function normalizeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const candidates = raw.includes('://') ? [raw] : [`https://${raw}`, raw];
    for (const candidate of candidates) {
        try {
            const url = new URL(candidate);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                return url.toString();
            }
        } catch (_error) {
            // Ignore invalid candidates.
        }
    }

    return '';
}

function deriveLinkNameFromUrl(value) {
    const normalizedUrl = normalizeExternalUrl(value);
    if (!normalizedUrl) return '';
    try {
        const url = new URL(normalizedUrl);
        return url.hostname.replace(/^www\./i, '');
    } catch (_error) {
        return '';
    }
}

function normalizeDeviceLinks(links) {
    const normalized = [];
    (Array.isArray(links) ? links : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const url = normalizeExternalUrl(item.url || item.href || '');
        if (!url) return;
        const name = String(item.name || '').trim() || deriveLinkNameFromUrl(url);
        normalized.push({
            name,
            url
        });
    });
    return normalized;
}

function getLegacyWebsiteLink(device) {
    const url = normalizeExternalUrl(device && device.website);
    if (!url) return [];
    return [{
        name: deriveLinkNameFromUrl(url),
        url
    }];
}

function isRouterOrAccessPointType(value) {
    const normalized = normalizeOptionValue(value);
    if (!normalized) return false;
    if (normalized === 'router' || normalized === 'routers') return true;
    if (normalized === 'access-point' || normalized === 'access-points') return true;
    return normalized.includes('router') || normalized.includes('access-point');
}

function isStrictWifiConnectivity(value) {
    return normalizeOptionValue(value) === 'wifi';
}

function isZigbeeConnectivity(value) {
    return normalizeOptionValue(value) === 'zigbee';
}

function isZwaveConnectivity(value) {
    const normalized = normalizeOptionValue(value);
    return normalized === 'z-wave' || normalized === 'zwave';
}

function isZigbeeParentDevice(device) {
    return Boolean(device && isZigbeeConnectivity(device.connectivity) && (device.zigbeeController || device.zigbeeRepeater));
}

function isZwaveParentDevice(device) {
    return Boolean(device && isZwaveConnectivity(device.connectivity) && device.zwaveController);
}

function escapeFileParam(value) {
    return encodeURIComponent(String(value || ''));
}

function getDeviceFileContentUrl(path, download = false) {
    const safePath = String(path || '').trim();
    if (!safePath) return '#';
    const downloadSuffix = download ? '&download=1' : '';
    return `${DEVICE_FILES_CONTENT_API_URL}?path=${escapeFileParam(safePath)}${downloadSuffix}`;
}

function formatFileSize(size) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function isImageMimeType(value) {
    return String(value || '').trim().toLowerCase().startsWith('image/');
}

function normalizeDeviceFiles(files) {
    const result = [];
    const seenPaths = new Set();
    (Array.isArray(files) ? files : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const path = String(item.path || '').trim();
        if (!path || seenPaths.has(path)) return;
        seenPaths.add(path);
        const name = String(item.name || path.split('/').pop() || 'file').trim() || 'file';
        const mimeType = String(item.mimeType || '').trim();
        const sizeRaw = Number(item.size);
        result.push({
            id: String(item.id || `file-${Math.random().toString(36).slice(2, 10)}`).trim(),
            name: name,
            path: path,
            mimeType: mimeType,
            size: Number.isFinite(sizeRaw) ? sizeRaw : 0,
            uploadedAt: String(item.uploadedAt || '').trim(),
            isImage: item.isImage === true || isImageMimeType(mimeType)
        });
    });
    return result;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadData();
    allDevices = data.devices;
    allAreas = data.areas;
    allLabels = data.labels || [];
    settings = await loadSettings();
    const haConfig = typeof loadHaConfig === 'function' ? await loadHaConfig() : {};
    haDefaultCurrency = String(haConfig?.currency || '').trim().toUpperCase();
    haCountryCode = String(haConfig?.country || '').trim().toUpperCase();
    networks = data.networks || [];
    devices = allDevices;
    
    // Check if we're editing (device-edit.html)
    const urlParams = new URLSearchParams(window.location.search);
    editingDeviceId = urlParams.get('id');
    activeDeviceId = editingDeviceId || generateDeviceId();
    
    initializeEventListeners();
    initializeDeviceFilesSupport();
    populateBrands();
    populateTypes();
    populateConnectivity();
    populateNetworks();
    populateBatteryTypes();
    populatePurchaseCurrencies();
    populateLabels();
    setAreas();
    handleBrandChange();
    handleConnectivityChange();
    handleStatusChange();
    setupWifiAccessPointSearch();
    setupWifiClientsManager();
    setupZigbeeParentSearch();
    setupZigbeeClientsManager();
    setupZwaveCoordinatorSearch();
    setupZwaveClientsManager();
    updateWifiClientsManagerVisibility();
    updateZigbeeClientsManagerVisibility();
    updateZwaveClientsManagerVisibility();
    initializeDeviceLinksSupport();
    
    if (editingDeviceId) {
        loadDeviceForEdit(editingDeviceId);
    } else {
        await loadDuplicateDeviceFromStorage();
    }

    handlePowerTypeChange();
});

// Event Listeners
function initializeEventListeners() {
    document.getElementById('device-form').addEventListener('submit', handleDeviceSubmit);
    initDevicePhotoUpload();
    document.getElementById('device-power').addEventListener('change', handlePowerTypeChange);
    document.getElementById('device-connectivity').addEventListener('change', handleConnectivitySelectChange);
    document.getElementById('device-battery-type').addEventListener('change', handleBatteryTypeChange);
    document.getElementById('device-brand').addEventListener('change', handleBrandChange);
    document.getElementById('device-type').addEventListener('change', handleTypeChange);
    document.getElementById('device-status').addEventListener('change', handleStatusChange);
    const zigbeeControllerCheckbox = document.getElementById('device-zigbee-controller');
    if (zigbeeControllerCheckbox) {
        zigbeeControllerCheckbox.addEventListener('change', handleConnectivityChange);
        zigbeeControllerCheckbox.addEventListener('change', updateZigbeeClientsManagerVisibility);
    }
    const zigbeeRepeaterCheckbox = document.getElementById('device-zigbee-repeater');
    if (zigbeeRepeaterCheckbox) {
        zigbeeRepeaterCheckbox.addEventListener('change', updateZigbeeClientsManagerVisibility);
    }
    const zwaveControllerCheckbox = document.getElementById('device-zwave-controller');
    if (zwaveControllerCheckbox) {
        zwaveControllerCheckbox.addEventListener('change', updateZwaveClientsManagerVisibility);
    }
    const areaSelect = document.getElementById('device-area');
    const controlledAreaSelect = document.getElementById('device-controlled-area');
    if (areaSelect) {
        areaSelect.addEventListener('change', () => handleAreaAutoSync(areaSelect, controlledAreaSelect));
    }
    if (controlledAreaSelect) {
        controlledAreaSelect.addEventListener('change', () => handleAreaAutoSync(controlledAreaSelect, areaSelect));
    }
    const deleteButton = document.getElementById('delete-device-btn');
    if (deleteButton) {
        deleteButton.addEventListener('click', handleDeleteDevice);
    }
    const applyButton = document.getElementById('apply-device-btn');
    if (applyButton) {
        applyButton.addEventListener('click', handleApplyDevice);
    }
    
    // Port buttons
    const addPortBtn = document.getElementById('add-port-btn');
    if (addPortBtn) {
        addPortBtn.addEventListener('click', () => addPort('ethernet-input', '', 'ports-container'));
    }
    
    // Power port button
    const addPowerPortBtn = document.getElementById('add-power-port-btn');
    if (addPowerPortBtn) {
        addPowerPortBtn.addEventListener('click', () => addPort('power-input', '', 'power-ports-container'));
    }

    document.getElementById('brand-modal-close').addEventListener('click', closeBrandModal);
    document.getElementById('brand-modal-cancel').addEventListener('click', closeBrandModal);
    document.getElementById('brand-modal-save').addEventListener('click', saveBrandModal);
    document.getElementById('brand-modal-overlay').addEventListener('click', closeBrandModal);
    document.getElementById('type-modal-close').addEventListener('click', closeTypeModal);
    document.getElementById('type-modal-cancel').addEventListener('click', closeTypeModal);
    document.getElementById('type-modal-save').addEventListener('click', saveTypeModal);
    document.getElementById('type-modal-overlay').addEventListener('click', closeTypeModal);
    document.getElementById('battery-type-modal-close').addEventListener('click', closeBatteryTypeModal);
    document.getElementById('battery-type-modal-cancel').addEventListener('click', closeBatteryTypeModal);
    document.getElementById('battery-type-modal-save').addEventListener('click', saveBatteryTypeModal);
    document.getElementById('battery-type-modal-overlay').addEventListener('click', closeBatteryTypeModal);
    document.getElementById('connectivity-modal-close').addEventListener('click', closeConnectivityModal);
    document.getElementById('connectivity-modal-cancel').addEventListener('click', closeConnectivityModal);
    document.getElementById('connectivity-modal-save').addEventListener('click', saveConnectivityModal);
    document.getElementById('connectivity-modal-overlay').addEventListener('click', closeConnectivityModal);
    const connectivityHelpBtn = document.getElementById('connectivity-help-btn');
    if (connectivityHelpBtn) {
        connectivityHelpBtn.addEventListener('click', openConnectivityHelpModal);
    }
    const connectivityHelpCloseBtn = document.getElementById('connectivity-help-close');
    if (connectivityHelpCloseBtn) {
        connectivityHelpCloseBtn.addEventListener('click', closeConnectivityHelpModal);
    }
    const connectivityHelpOverlay = document.getElementById('connectivity-help-overlay');
    if (connectivityHelpOverlay) {
        connectivityHelpOverlay.addEventListener('click', closeConnectivityHelpModal);
    }
    const localOnlyHelpBtn = document.getElementById('local-only-help-btn');
    if (localOnlyHelpBtn) {
        localOnlyHelpBtn.addEventListener('click', openLocalOnlyHelpModal);
    }
    const localOnlyHelpClose = document.getElementById('local-only-help-close');
    if (localOnlyHelpClose) {
        localOnlyHelpClose.addEventListener('click', closeLocalOnlyHelpModal);
    }
    const localOnlyHelpOverlay = document.getElementById('local-only-help-overlay');
    if (localOnlyHelpOverlay) {
        localOnlyHelpOverlay.addEventListener('click', closeLocalOnlyHelpModal);
    }
    const networkHelpBtn = document.getElementById('network-help-btn');
    if (networkHelpBtn) {
        networkHelpBtn.addEventListener('click', openNetworkHelpModal);
    }
    const networkHelpClose = document.getElementById('network-help-close');
    if (networkHelpClose) {
        networkHelpClose.addEventListener('click', closeNetworkHelpModal);
    }
    const networkHelpOverlay = document.getElementById('network-help-overlay');
    if (networkHelpOverlay) {
        networkHelpOverlay.addEventListener('click', closeNetworkHelpModal);
    }
    const statusHelpBtn = document.getElementById('status-help-btn');
    if (statusHelpBtn) {
        statusHelpBtn.addEventListener('click', openStatusHelpModal);
    }
    const statusHelpClose = document.getElementById('status-help-close');
    if (statusHelpClose) {
        statusHelpClose.addEventListener('click', closeStatusHelpModal);
    }
    const statusHelpOverlay = document.getElementById('status-help-overlay');
    if (statusHelpOverlay) {
        statusHelpOverlay.addEventListener('click', closeStatusHelpModal);
    }
    const installedAreaHelpBtn = document.getElementById('installed-area-help-btn');
    if (installedAreaHelpBtn) {
        installedAreaHelpBtn.addEventListener('click', openInstalledAreaHelpModal);
    }
    const installedAreaHelpClose = document.getElementById('installed-area-help-close');
    if (installedAreaHelpClose) {
        installedAreaHelpClose.addEventListener('click', closeInstalledAreaHelpModal);
    }
    const installedAreaHelpOverlay = document.getElementById('installed-area-help-overlay');
    if (installedAreaHelpOverlay) {
        installedAreaHelpOverlay.addEventListener('click', closeInstalledAreaHelpModal);
    }
    const controlledAreaHelpBtn = document.getElementById('controlled-area-help-btn');
    if (controlledAreaHelpBtn) {
        controlledAreaHelpBtn.addEventListener('click', openControlledAreaHelpModal);
    }
    const controlledAreaHelpClose = document.getElementById('controlled-area-help-close');
    if (controlledAreaHelpClose) {
        controlledAreaHelpClose.addEventListener('click', closeControlledAreaHelpModal);
    }
    const controlledAreaHelpOverlay = document.getElementById('controlled-area-help-overlay');
    if (controlledAreaHelpOverlay) {
        controlledAreaHelpOverlay.addEventListener('click', closeControlledAreaHelpModal);
    }
    const ipHelpBtn = document.getElementById('ip-help-btn');
    if (ipHelpBtn) {
        ipHelpBtn.addEventListener('click', openIpHelpModal);
    }
    const ipHelpClose = document.getElementById('ip-help-close');
    if (ipHelpClose) {
        ipHelpClose.addEventListener('click', closeIpHelpModal);
    }
    const ipHelpOverlay = document.getElementById('ip-help-overlay');
    if (ipHelpOverlay) {
        ipHelpOverlay.addEventListener('click', closeIpHelpModal);
    }
    const nameHelpBtn = document.getElementById('name-help-btn');
    if (nameHelpBtn) {
        nameHelpBtn.addEventListener('click', openNameHelpModal);
    }
    const nameHelpClose = document.getElementById('name-help-close');
    if (nameHelpClose) {
        nameHelpClose.addEventListener('click', closeNameHelpModal);
    }
    const nameHelpOverlay = document.getElementById('name-help-overlay');
    if (nameHelpOverlay) {
        nameHelpOverlay.addEventListener('click', closeNameHelpModal);
    }
    const upsHelpBtn = document.getElementById('ups-help-btn');
    if (upsHelpBtn) {
        upsHelpBtn.addEventListener('click', openUpsHelpModal);
    }
    const upsHelpClose = document.getElementById('ups-help-close');
    if (upsHelpClose) {
        upsHelpClose.addEventListener('click', closeUpsHelpModal);
    }
    const upsHelpOverlay = document.getElementById('ups-help-overlay');
    if (upsHelpOverlay) {
        upsHelpOverlay.addEventListener('click', closeUpsHelpModal);
    }
    const powerHelpBtn = document.getElementById('power-help-btn');
    if (powerHelpBtn) {
        powerHelpBtn.addEventListener('click', openPowerHelpModal);
    }
    const powerHelpClose = document.getElementById('power-help-close');
    if (powerHelpClose) {
        powerHelpClose.addEventListener('click', closePowerHelpModal);
    }
    const powerHelpOverlay = document.getElementById('power-help-overlay');
    if (powerHelpOverlay) {
        powerHelpOverlay.addEventListener('click', closePowerHelpModal);
    }
    const zigbeeRouterHelpBtn = document.getElementById('zigbee-router-help-btn');
    if (zigbeeRouterHelpBtn) {
        zigbeeRouterHelpBtn.addEventListener('click', openZigbeeRouterHelpModal);
    }
    const zigbeeRouterHelpClose = document.getElementById('zigbee-router-help-close');
    if (zigbeeRouterHelpClose) {
        zigbeeRouterHelpClose.addEventListener('click', closeZigbeeRouterHelpModal);
    }
    const zigbeeRouterHelpOverlay = document.getElementById('zigbee-router-help-overlay');
    if (zigbeeRouterHelpOverlay) {
        zigbeeRouterHelpOverlay.addEventListener('click', closeZigbeeRouterHelpModal);
    }
    const zigbeeCoordinatorHelpBtn = document.getElementById('zigbee-coordinator-help-btn');
    if (zigbeeCoordinatorHelpBtn) {
        zigbeeCoordinatorHelpBtn.addEventListener('click', openZigbeeCoordinatorHelpModal);
    }
    const zigbeeCoordinatorHelpClose = document.getElementById('zigbee-coordinator-help-close');
    if (zigbeeCoordinatorHelpClose) {
        zigbeeCoordinatorHelpClose.addEventListener('click', closeZigbeeCoordinatorHelpModal);
    }
    const zigbeeCoordinatorHelpOverlay = document.getElementById('zigbee-coordinator-help-overlay');
    if (zigbeeCoordinatorHelpOverlay) {
        zigbeeCoordinatorHelpOverlay.addEventListener('click', closeZigbeeCoordinatorHelpModal);
    }
    const threadBorderRouterHelpBtn = document.getElementById('thread-border-router-help-btn');
    if (threadBorderRouterHelpBtn) {
        threadBorderRouterHelpBtn.addEventListener('click', openThreadBorderRouterHelpModal);
    }
    const threadBorderRouterHelpClose = document.getElementById('thread-border-router-help-close');
    if (threadBorderRouterHelpClose) {
        threadBorderRouterHelpClose.addEventListener('click', closeThreadBorderRouterHelpModal);
    }
    const threadBorderRouterHelpOverlay = document.getElementById('thread-border-router-help-overlay');
    if (threadBorderRouterHelpOverlay) {
        threadBorderRouterHelpOverlay.addEventListener('click', closeThreadBorderRouterHelpModal);
    }
    const zwaveControllerHelpBtn = document.getElementById('zwave-controller-help-btn');
    if (zwaveControllerHelpBtn) {
        zwaveControllerHelpBtn.addEventListener('click', openZwaveControllerHelpModal);
    }
    const zwaveControllerHelpClose = document.getElementById('zwave-controller-help-close');
    if (zwaveControllerHelpClose) {
        zwaveControllerHelpClose.addEventListener('click', closeZwaveControllerHelpModal);
    }
    const zwaveControllerHelpOverlay = document.getElementById('zwave-controller-help-overlay');
    if (zwaveControllerHelpOverlay) {
        zwaveControllerHelpOverlay.addEventListener('click', closeZwaveControllerHelpModal);
    }
    const matterBridgeHelpBtn = document.getElementById('matter-bridge-help-btn');
    if (matterBridgeHelpBtn) {
        matterBridgeHelpBtn.addEventListener('click', openMatterBridgeHelpModal);
    }
    const matterBridgeHelpClose = document.getElementById('matter-bridge-help-close');
    if (matterBridgeHelpClose) {
        matterBridgeHelpClose.addEventListener('click', closeMatterBridgeHelpModal);
    }
    const matterBridgeHelpOverlay = document.getElementById('matter-bridge-help-overlay');
    if (matterBridgeHelpOverlay) {
        matterBridgeHelpOverlay.addEventListener('click', closeMatterBridgeHelpModal);
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeDeviceFilePreviewModal();
            closeDeviceFileRenameModal();
            closeBrandModal();
            closeTypeModal();
            closeBatteryTypeModal();
            closeConnectivityModal();
            closeConnectivityHelpModal();
            closeLocalOnlyHelpModal();
            closeNetworkHelpModal();
            closeStatusHelpModal();
            closeInstalledAreaHelpModal();
            closeControlledAreaHelpModal();
            closeIpHelpModal();
            closeNameHelpModal();
            closeUpsHelpModal();
            closePowerHelpModal();
            closeZigbeeRouterHelpModal();
            closeZigbeeCoordinatorHelpModal();
            closeThreadBorderRouterHelpModal();
            closeZwaveControllerHelpModal();
            closeMatterBridgeHelpModal();
        }
    });
}

function initializeDeviceFilesSupport() {
    const input = document.getElementById('device-files-input');
    const uploadButton = document.getElementById('device-files-upload-btn');
    const dropzone = document.getElementById('device-files-dropzone');

    if (!input || !uploadButton || !dropzone) return;

    uploadButton.addEventListener('click', (event) => {
        event.preventDefault();
        input.click();
    });

    input.addEventListener('change', async () => {
        const selectedFiles = Array.from(input.files || []);
        input.value = '';
        if (!selectedFiles.length) return;
        await uploadFilesForDevice(selectedFiles);
    });

    dropzone.addEventListener('click', (event) => {
        if (event.target && event.target.closest('#device-files-upload-btn')) return;
        input.click();
    });

    dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.click();
        }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.add('is-dragover');
        });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            if (eventName === 'dragleave' && event.target !== dropzone) return;
            dropzone.classList.remove('is-dragover');
        });
    });
    dropzone.addEventListener('drop', async (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
        const droppedFiles = Array.from(event.dataTransfer?.files || []);
        if (!droppedFiles.length) return;
        await uploadFilesForDevice(droppedFiles);
    });

    renderDeviceFiles();
}

function ensureDeviceFilePreviewModal() {
    if (deviceFilePreviewModal && document.body.contains(deviceFilePreviewModal.root)) {
        return deviceFilePreviewModal;
    }

    const root = document.createElement('div');
    root.className = 'modal is-hidden device-file-preview-modal';
    root.id = 'device-file-preview-modal';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="modal-overlay" data-device-file-preview-close></div>
        <div class="modal-content device-file-preview-modal-content" role="dialog" aria-modal="true" aria-labelledby="device-file-preview-title">
            <div class="device-file-preview-header">
                <div class="device-file-preview-title" id="device-file-preview-title">Image Preview</div>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-device-file-preview-close aria-label="Close preview">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6l12 12"></path>
                        <path d="M18 6L6 18"></path>
                    </svg>
                </button>
            </div>
            <div class="device-file-preview-body">
                <img class="device-file-preview-image" id="device-file-preview-image" alt="Image preview">
            </div>
        </div>
    `;
    document.body.appendChild(root);

    root.querySelectorAll('[data-device-file-preview-close]').forEach((element) => {
        element.addEventListener('click', closeDeviceFilePreviewModal);
    });

    deviceFilePreviewModal = {
        root: root,
        image: root.querySelector('#device-file-preview-image'),
        title: root.querySelector('#device-file-preview-title')
    };
    return deviceFilePreviewModal;
}

function openDeviceFilePreviewModal(filePath, fileName = '') {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    const modal = ensureDeviceFilePreviewModal();
    if (!modal || !modal.root || !modal.image || !modal.title) return;

    modal.title.textContent = String(fileName || 'Image Preview').trim() || 'Image Preview';
    modal.image.src = getDeviceFileContentUrl(normalizedPath);
    modal.image.alt = modal.title.textContent;
    modal.root.classList.remove('is-hidden');
    modal.root.setAttribute('aria-hidden', 'false');
}

function closeDeviceFilePreviewModal() {
    const modal = deviceFilePreviewModal;
    if (!modal || !modal.root || modal.root.classList.contains('is-hidden')) return;
    modal.root.classList.add('is-hidden');
    modal.root.setAttribute('aria-hidden', 'true');
    if (modal.image) {
        modal.image.src = '';
    }
}

function ensureDeviceFileRenameModal() {
    if (deviceFileRenameModal && document.body.contains(deviceFileRenameModal.root)) {
        return deviceFileRenameModal;
    }

    const root = document.createElement('div');
    root.className = 'modal is-hidden device-file-rename-modal';
    root.id = 'device-file-rename-modal';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="modal-overlay" data-device-file-rename-close></div>
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="device-file-rename-title">
            <div class="modal-header">
                <div class="modal-title" id="device-file-rename-title">Rename File</div>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-device-file-rename-close aria-label="Close rename file dialog" title="Close">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6l12 12"></path>
                        <path d="M18 6L6 18"></path>
                    </svg>
                </button>
            </div>
            <div class="form-group">
                <label for="device-file-rename-input">File Name</label>
                <input type="text" id="device-file-rename-input" placeholder="Enter a new file name">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" type="button" data-device-file-rename-close>Cancel</button>
                <button class="btn btn-primary" type="button" id="device-file-rename-save-btn">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(root);

    root.querySelectorAll('[data-device-file-rename-close]').forEach((element) => {
        element.addEventListener('click', closeDeviceFileRenameModal);
    });

    const saveButton = root.querySelector('#device-file-rename-save-btn');
    const input = root.querySelector('#device-file-rename-input');
    if (saveButton) {
        saveButton.addEventListener('click', submitDeviceFileRename);
    }
    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitDeviceFileRename();
            }
        });
    }

    deviceFileRenameModal = {
        root: root,
        input: input,
        saveButton: saveButton
    };
    return deviceFileRenameModal;
}

function openDeviceFileRenameModal(filePath, currentName = '') {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    const modal = ensureDeviceFileRenameModal();
    if (!modal || !modal.root || !modal.input) return;
    modal.root.dataset.filePath = normalizedPath;
    modal.input.value = String(currentName || '').trim();
    modal.root.classList.remove('is-hidden');
    modal.root.setAttribute('aria-hidden', 'false');
    modal.input.focus();
    modal.input.select();
}

function closeDeviceFileRenameModal() {
    const modal = deviceFileRenameModal;
    if (!modal || !modal.root || modal.root.classList.contains('is-hidden')) return;
    modal.root.classList.add('is-hidden');
    modal.root.setAttribute('aria-hidden', 'true');
    modal.root.dataset.filePath = '';
    if (modal.input) {
        modal.input.value = '';
    }
    if (modal.saveButton) {
        modal.saveButton.disabled = false;
    }
}

async function submitDeviceFileRename() {
    const modal = ensureDeviceFileRenameModal();
    if (!modal || !modal.root || !modal.input) return;
    const filePath = String(modal.root.dataset.filePath || '').trim();
    const nextName = String(modal.input.value || '').trim();
    if (!filePath || !nextName) {
        showAlert('Please enter a valid file name.');
        return;
    }

    if (modal.saveButton) {
        modal.saveButton.disabled = true;
    }
    try {
        await renameDeviceFile(filePath, nextName);
        closeDeviceFileRenameModal();
    } finally {
        if (modal.saveButton) {
            modal.saveButton.disabled = false;
        }
    }
}

function renderDeviceFiles() {
    const list = document.getElementById('device-files-list');
    const empty = document.getElementById('device-files-empty');
    const count = document.getElementById('device-files-count');
    if (!list || !empty || !count) return;

    const normalizedFiles = normalizeDeviceFiles(deviceFiles);
    deviceFiles = normalizedFiles;

    count.textContent = `${normalizedFiles.length} file${normalizedFiles.length === 1 ? '' : 's'}`;
    if (!normalizedFiles.length) {
        list.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }

    empty.classList.add('is-hidden');
    list.innerHTML = normalizedFiles.map((file) => {
        const displayName = escapeHtml(file.name || 'file');
        const fileMeta = [formatFileSize(file.size), file.mimeType || 'Unknown type'].join(' • ');
        const preview = file.isImage
            ? `<button type="button" class="device-file-preview" data-device-file-view="${escapeHtml(file.path)}" data-device-file-name="${displayName}" title="View image">
                    <img src="${escapeHtml(getDeviceFileContentUrl(file.path))}" alt="${displayName}" loading="lazy">
               </button>`
            : `<div class="device-file-preview-static">
                    <span class="device-file-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>
                            <path d="M14 2v6h6"></path>
                            <path d="M9 15h6"></path>
                            <path d="M9 19h6"></path>
                            <path d="M9 11h3"></path>
                        </svg>
                    </span>
               </div>`;
        return `
            <article class="device-file-card">
                ${preview}
                <div class="device-file-content">
                    <div class="device-file-name">${displayName}</div>
                    <div class="device-file-meta">${escapeHtml(fileMeta)}</div>
                    <div class="device-file-actions">
                        <a class="device-file-action" href="${escapeHtml(getDeviceFileContentUrl(file.path, true))}" target="_blank" rel="noopener noreferrer">Download</a>
                        <button type="button" class="device-file-action" data-device-file-rename="${escapeHtml(file.path)}" data-device-file-current-name="${displayName}">Rename</button>
                        <button type="button" class="device-file-action device-file-action-danger" data-device-file-delete="${escapeHtml(file.path)}">Remove</button>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    list.querySelectorAll('[data-device-file-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
            const targetPath = button.getAttribute('data-device-file-delete') || '';
            if (!targetPath) return;
            button.disabled = true;
            try {
                await removeDeviceFile(targetPath);
            } finally {
                button.disabled = false;
            }
        });
    });

    list.querySelectorAll('[data-device-file-view]').forEach((button) => {
        button.addEventListener('click', () => {
            const targetPath = button.getAttribute('data-device-file-view') || '';
            const targetName = button.getAttribute('data-device-file-name') || 'Image Preview';
            if (!targetPath) return;
            openDeviceFilePreviewModal(targetPath, targetName);
        });
    });

    list.querySelectorAll('[data-device-file-rename]').forEach((button) => {
        button.addEventListener('click', () => {
            const targetPath = button.getAttribute('data-device-file-rename') || '';
            const currentName = button.getAttribute('data-device-file-current-name') || '';
            if (!targetPath) return;
            openDeviceFileRenameModal(targetPath, currentName);
        });
    });
}

async function uploadFilesForDevice(files) {
    const validFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!validFiles.length) return;

    const oversizedFiles = validFiles.filter((file) => Number(file.size) > MAX_DEVICE_FILE_BYTES);
    if (oversizedFiles.length) {
        showAlert(`Some files are too large. Maximum per file is ${formatFileSize(MAX_DEVICE_FILE_BYTES)}.`);
        return;
    }

    let successCount = 0;
    for (const file of validFiles) {
        try {
            const uploaded = await uploadDeviceFile(file);
            if (uploaded) {
                deviceFiles.push(uploaded);
                successCount += 1;
            }
        } catch (error) {
            console.error('Failed to upload device file:', error);
            showAlert(`Could not upload "${file.name}": ${error?.message || error}`);
        }
    }

    if (!successCount) {
        renderDeviceFiles();
        return;
    }

    renderDeviceFiles();
    await persistDeviceFilesForEditing();
    showFormMessage(`${successCount} file${successCount === 1 ? '' : 's'} uploaded successfully.`, 'success');
}

async function uploadDeviceFile(file) {
    const uploadUrl = `${DEVICE_FILES_UPLOAD_API_URL}?deviceId=${escapeFileParam(activeDeviceId)}`;
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name || 'file')
        },
        body: file
    });

    if (!response.ok) {
        let message = `Upload failed (${response.status})`;
        try {
            const payload = await response.json();
            if (payload?.error) {
                message = payload.error;
            }
        } catch (error) {
            // Keep fallback message.
        }
        throw new Error(message);
    }

    const payload = await response.json();
    return normalizeDeviceFiles([payload])[0] || null;
}

// --- Device Photo Upload ---

function initDevicePhotoUpload() {
    const selectBtn = document.getElementById('device-photo-select-btn');
    const removeBtn = document.getElementById('device-photo-remove-btn');
    const preview = document.getElementById('device-photo-preview');
    const input = document.getElementById('device-photo-input');
    if (!selectBtn || !input) return;

    const trigger = () => input.click();
    selectBtn.addEventListener('click', trigger);
    if (preview) {
        preview.addEventListener('click', trigger);
        preview.setAttribute('role', 'button');
        preview.setAttribute('tabindex', '0');
        preview.setAttribute('aria-label', 'Upload device photo');
        preview.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                trigger();
            }
        });
    }

    input.addEventListener('change', () => {
        if (input.files.length) {
            handleDevicePhotoSelected(input.files[0]);
            input.value = '';
        }
    });
    if (removeBtn) {
        removeBtn.addEventListener('click', removeDevicePhoto);
    }

    syncDevicePhotoTypeFallback();
}

function handleDevicePhotoSelected(file) {
    if (!file.type.startsWith('image/')) {
        showFormMessage('Please select an image file.', 'error');
        return;
    }
    if (file.size > MAX_DEVICE_FILE_BYTES) {
        showFormMessage('Image is too large (max 20 MB).', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setDevicePhotoPreview(e.target.result, false);
    reader.readAsDataURL(file);

    if (editingDeviceId) {
        uploadDeviceImageFile(file);
    } else {
        pendingDeviceImageFile = file;
    }
}

async function uploadDeviceImageFile(file) {
    const deviceId = String(activeDeviceId || '').trim();
    if (!deviceId) return null;
    try {
        const uploadUrl = `${DEVICE_FILES_UPLOAD_API_URL}?deviceId=${escapeFileParam(deviceId)}`;
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name || 'photo'),
            },
            body: file,
        });
        if (!response.ok) {
            throw new Error(`Upload failed (${response.status})`);
        }
        const fileRef = await response.json();
        currentDeviceImage = fileRef;
        return fileRef;
    } catch (error) {
        showFormMessage(error.message || 'Failed to upload photo.', 'error');
        return null;
    }
}

function resolveDeviceTypeIconPath(typeValue) {
    const normalized = normalizeOptionValue(typeValue);
    if (!normalized) return '';
    return `img/devices/${encodeURIComponent(normalized)}.svg`;
}

function getSelectedDeviceTypeLabel() {
    const typeSelect = document.getElementById('device-type');
    if (!typeSelect) return '';
    const selectedOption = typeSelect.options[typeSelect.selectedIndex];
    if (!selectedOption) return '';
    const label = String(selectedOption.textContent || '').trim();
    if (!label || label.startsWith('Select') || label.startsWith('+')) {
        return '';
    }
    return label;
}

function syncDevicePhotoTypeFallback(force = false) {
    const typeSelect = document.getElementById('device-type');
    const img = document.getElementById('device-photo-img');
    if (!typeSelect || !img) return;

    const hasCustomPhoto = Boolean(
        (currentDeviceImage && currentDeviceImage.path) ||
        pendingDeviceImageFile ||
        (!img.hidden && img.dataset.photoSource === 'custom')
    );
    if (hasCustomPhoto && !force) return;

    const typeIconSrc = resolveDeviceTypeIconPath(typeSelect.value);
    if (typeIconSrc) {
        setDevicePhotoPreview(typeIconSrc, false, {
            sourceKind: 'type',
            typeLabel: getSelectedDeviceTypeLabel()
        });
        return;
    }

    setDevicePhotoPreview(null, false);
}

function setDevicePhotoPreview(src, isApiPath, options = {}) {
    const img = document.getElementById('device-photo-img');
    const placeholder = document.getElementById('device-photo-placeholder');
    const removeBtn = document.getElementById('device-photo-remove-btn');
    const preview = document.getElementById('device-photo-preview');
    if (!img) return;

    const sourceKind = options.sourceKind === 'type' ? 'type' : 'custom';
    if (src) {
        img.src = isApiPath
            ? `${DEVICE_FILES_CONTENT_API_URL}?path=${encodeURIComponent(src)}`
            : src;
        img.alt = sourceKind === 'type'
            ? `${options.typeLabel || 'Device type'} icon`
            : 'Device photo';
        img.hidden = false;
        img.dataset.photoSource = sourceKind;
        img.classList.toggle('device-photo-img--type', sourceKind === 'type');
        img.classList.toggle('device-photo-img--custom', sourceKind !== 'type');
        if (sourceKind === 'type') {
            img.dataset.typeFallbackApplied = '0';
            img.onerror = () => {
                if (img.dataset.typeFallbackApplied === '1') {
                    img.onerror = null;
                    return;
                }
                img.dataset.typeFallbackApplied = '1';
                img.src = 'img/devices/generic.svg';
            };
        } else {
            delete img.dataset.typeFallbackApplied;
            img.onerror = null;
        }
        if (placeholder) placeholder.hidden = true;
        if (removeBtn) removeBtn.hidden = sourceKind === 'type';
        if (preview) {
            preview.classList.add('device-photo-preview--has-image');
            preview.classList.toggle('device-photo-preview--type', sourceKind === 'type');
            preview.classList.toggle('device-photo-preview--custom', sourceKind !== 'type');
        }
    } else {
        img.hidden = true;
        img.src = '';
        img.alt = '';
        img.dataset.photoSource = '';
        delete img.dataset.typeFallbackApplied;
        img.classList.remove('device-photo-img--type', 'device-photo-img--custom');
        img.onerror = null;
        if (placeholder) placeholder.hidden = false;
        if (removeBtn) removeBtn.hidden = true;
        if (preview) {
            preview.classList.remove('device-photo-preview--has-image', 'device-photo-preview--type', 'device-photo-preview--custom');
        }
    }
}

function removeDevicePhoto() {
    setDevicePhotoPreview(null, false);
    currentDeviceImage = null;
    pendingDeviceImageFile = null;
    syncDevicePhotoTypeFallback(true);
}

// --- End Device Photo Upload ---

async function removeDeviceFile(filePath) {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    const deleteUrl = `${DEVICE_FILES_DELETE_API_URL}?path=${escapeFileParam(normalizedPath)}`;

    try {
        const response = await fetch(deleteUrl, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
            let message = `Delete failed (${response.status})`;
            try {
                const payload = await response.json();
                if (payload?.error) {
                    message = payload.error;
                }
            } catch (error) {
                // Keep fallback message.
            }
            throw new Error(message);
        }
    } catch (error) {
        console.error('Failed to remove file from server:', error);
        showAlert(`Could not remove file: ${error?.message || error}`);
        return;
    }

    deviceFiles = deviceFiles.filter((file) => String(file.path || '').trim() !== normalizedPath);
    renderDeviceFiles();
    await persistDeviceFilesForEditing();
    showFormMessage('File removed successfully.', 'success');
}

async function renameDeviceFile(filePath, newName) {
    const normalizedPath = String(filePath || '').trim();
    const normalizedName = String(newName || '').trim();
    if (!normalizedPath || !normalizedName) return;

    let renamedFile = null;
    try {
        const response = await fetch(DEVICE_FILES_RENAME_API_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: normalizedPath,
                name: normalizedName
            })
        });
        if (!response.ok) {
            let message = `Rename failed (${response.status})`;
            try {
                const payload = await response.json();
                if (payload?.error) {
                    message = payload.error;
                }
            } catch (error) {
                // Keep fallback message.
            }
            throw new Error(message);
        }
        const payload = await response.json();
        renamedFile = normalizeDeviceFiles([payload?.file])[0] || null;
    } catch (error) {
        console.error('Failed to rename file:', error);
        showAlert(`Could not rename file: ${error?.message || error}`);
        return;
    }

    if (!renamedFile) return;
    deviceFiles = normalizeDeviceFiles(deviceFiles.map((file) => {
        if (String(file.path || '').trim() !== normalizedPath) {
            return file;
        }
        return {
            ...file,
            ...renamedFile,
            id: file.id || renamedFile.id,
            uploadedAt: file.uploadedAt || renamedFile.uploadedAt
        };
    }));
    renderDeviceFiles();
    await persistDeviceFilesForEditing();
    showFormMessage('File renamed successfully.', 'success');
}

async function persistDeviceFilesForEditing() {
    if (!editingDeviceId) return;
    const targetDevice = allDevices.find((device) => device.id === editingDeviceId);
    if (!targetDevice) return;
    targetDevice.files = normalizeDeviceFiles(deviceFiles);
    await saveData({
        ...(await loadData()),
        devices: allDevices
    });
}

async function deleteAllDeviceFiles(files) {
    const normalized = normalizeDeviceFiles(files);
    for (const file of normalized) {
        const deleteUrl = `${DEVICE_FILES_DELETE_API_URL}?path=${escapeFileParam(file.path)}`;
        try {
            await fetch(deleteUrl, { method: 'DELETE' });
        } catch (error) {
            console.error(`Failed to delete file "${file.path}"`, error);
        }
    }
}

function buildFriendlyOptions(configuredValues, deviceValues, fallbackFormatter) {
    const options = new Map();
    (configuredValues || []).forEach(value => {
        const normalized = normalizeOptionValue(value);
        if (!normalized || options.has(normalized)) return;
        options.set(normalized, value);
    });
    (deviceValues || []).forEach(value => {
        const normalized = normalizeOptionValue(value);
        if (!normalized || options.has(normalized)) return;
        options.set(normalized, getFriendlyOption(configuredValues, value, fallbackFormatter));
    });
    return Array.from(options.entries())
        .map(([value, label]) => ({ value, label: label || value }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

function buildAmazonBatteryMetaMap() {
    const map = new Map();
    (DEFAULT_BATTERY_TYPES || []).forEach(item => {
        const name = typeof item === 'string' ? item : String(item?.name || '').trim();
        if (!name) return;
        const normalized = normalizeOptionValue(name);
        if (!normalized || map.has(normalized)) return;
        const asin = typeof item === 'object' ? item.amazonAsin ?? null : null;
        map.set(normalized, { name, amazonAsin: asin });
    });
    return map;
}

function getContinentCode(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code) return '';
    const europe = new Set([
        'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
        'GB', 'UK', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK',
        'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA'
    ]);
    const northAmerica = new Set(['US', 'CA', 'MX']);
    if (europe.has(code)) return 'EU';
    if (northAmerica.has(code)) return 'NA';
    return '';
}

function getLocation() {
    const countryCode = String(haCountryCode || '').trim().toUpperCase();
    if (!countryCode) return undefined;
    return {
        countryCode,
        continentCode: getContinentCode(countryCode)
    };
}

function getDefaultAmazonStore() {
    let store;
    if (supportedStores && supportedStores.length) {
        const locationJson = getLocation();
        if (locationJson) {
            for (const each of supportedStores) {
                if (each.countryCodes?.includes(locationJson.countryCode)) {
                    store = supportedStores.find(item => item.id === each.id);
                    if (store !== undefined) {
                        break;
                    }
                }

                if (store === undefined && each.continentCodes?.includes(locationJson.continentCode)) {
                    store = supportedStores.find(item => item.id === each.id);
                }
            }
        }

        if (store === undefined) {
            store = supportedStores[0];
        }
    }
    return store;
}

function resolveAmazonAsin(asinValue, storeId) {
    if (!asinValue) return '';
    if (typeof asinValue === 'string') return asinValue;
    if (typeof asinValue === 'object') {
        if (!storeId) return '';
        const resolved = asinValue[storeId];
        return resolved ? String(resolved) : '';
    }
    return '';
}

function buildAmazonUrl(asin, storeOverride) {
    if (!asin) return '';
    const store = storeOverride || getDefaultAmazonStore();
    const domain = store?.id ? AMAZON_STORE_DOMAINS[store.id] : '';
    const tag = store?.tag || '';
    const resolvedDomain = domain || AMAZON_STORE_DOMAINS.amazon_us;
    if (!resolvedDomain) return '';
    const base = `https://www.${resolvedDomain}/dp/${encodeURIComponent(asin)}`;
    if (!tag) return base;
    return `${base}?tag=${encodeURIComponent(tag)}`;
}

function updateBatteryBuyButton() {
    const button = document.getElementById('battery-buy-btn');
    if (!button) return;
    const powerType = document.getElementById('device-power')?.value || '';
    if (powerType !== 'battery') {
        button.hidden = true;
        button.setAttribute('href', '#');
        return;
    }
    const batteryType = normalizeOptionValue(document.getElementById('device-battery-type')?.value || '');
    if (!batteryType) {
        button.hidden = true;
        button.setAttribute('href', '#');
        return;
    }
    const meta = amazonBatteryMetaMap.get(batteryType);
    const store = getDefaultAmazonStore();
    const asin = resolveAmazonAsin(meta?.amazonAsin, store?.id);
    const amazonUrl = asin ? buildAmazonUrl(asin, store) : '';
    if (!amazonUrl) {
        button.hidden = true;
        button.setAttribute('href', '#');
        return;
    }
    button.hidden = false;
    button.setAttribute('href', amazonUrl);
}

const FALLBACK_CURRENCY_CODES = [
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'SGD', 'JPY', 'MXN', 'BRL',
    'ARS', 'CLP', 'COP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CNY', 'HKD',
    'TWD', 'INR', 'IDR', 'KRW', 'THB', 'VND', 'ZAR', 'AED', 'SAR', 'ILS',
    'TRY', 'RUB', 'UAH', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'ISK', 'MYR'
];

function getCurrencyCodes() {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
        try {
            const codes = Intl.supportedValuesOf('currency');
            if (Array.isArray(codes) && codes.length) {
                return codes;
            }
        } catch (error) {
            console.warn('Failed to load currency codes from Intl:', error);
        }
    }
    return FALLBACK_CURRENCY_CODES;
}

function resolveCurrencySymbol(code) {
    if (!code) return code;
    try {
        const formatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'symbol'
        });
        const parts = formatter.formatToParts(0);
        const symbolPart = parts.find(part => part.type === 'currency');
        return symbolPart && symbolPart.value ? symbolPart.value : code;
    } catch (error) {
        return code;
    }
}

function getDefaultCurrency() {
    return haDefaultCurrency || 'USD';
}

function populatePurchaseCurrencies() {
    const currencySelect = document.getElementById('device-purchase-currency');
    if (!currencySelect) return;
    const currentValue = currencySelect.value || getDefaultCurrency();
    const codes = getCurrencyCodes()
        .map(code => String(code || '').trim().toUpperCase())
        .filter(Boolean);
    const uniqueCodes = Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b));
    currencySelect.innerHTML = uniqueCodes
        .map(code => {
            const symbol = resolveCurrencySymbol(code);
            const label = `${code} (${symbol})`;
            return `<option value="${code}">${escapeHtml(label)}</option>`;
        })
        .join('');
    currencySelect.value = currentValue;
    if (!currencySelect.value) {
        currencySelect.value = getDefaultCurrency();
    }
}

// Populate dropdowns
function populateBrands() {
    const brandSelect = document.getElementById('device-brand');
    const currentValue = brandSelect.value;
    
    const brands = settings.brands || [];
    const deviceBrands = [...new Set(devices.map(d => d.brand).filter(Boolean))];
    const brandOptions = buildFriendlyOptions(brands, deviceBrands, formatDeviceType);
    brandSelect.innerHTML = '<option value="">Select a brand</option>' +
        brandOptions.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');

    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = '+ Add new brand';
    brandSelect.appendChild(newOption);
    
    if (currentValue) {
        const normalizedValue = currentValue === '__new__' ? currentValue : normalizeOptionValue(currentValue);
        brandSelect.value = normalizedValue;
    }

    lastBrandValue = brandSelect.value || '';
}

function populateTypes() {
    const typeSelect = document.getElementById('device-type');
    const currentValue = typeSelect.value;
    
    const types = settings.types || [];
    const deviceTypes = [...new Set(devices.map(d => d.type).filter(Boolean))];
    const typeOptions = buildFriendlyOptions(types, deviceTypes, formatDeviceType);
    typeSelect.innerHTML = '<option value="">Select a type</option>' +
        typeOptions.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = '+ Add new type';
    typeSelect.appendChild(newOption);
    
    if (currentValue) {
        const normalizedValue = currentValue === '__new__' ? currentValue : normalizeOptionValue(currentValue);
        typeSelect.value = normalizedValue;
    }

    lastTypeValue = typeSelect.value || '';
}

function populateConnectivity() {
    const connectivitySelect = document.getElementById('device-connectivity');
    const currentValue = connectivitySelect.value;
    
    const connectivity = settings.connectivity || [];
    const deviceConnectivity = [...new Set(devices.map(d => d.connectivity).filter(Boolean))];
    const connectivityOptions = buildFriendlyOptions(connectivity, deviceConnectivity, formatConnectivity);
    connectivitySelect.innerHTML = '<option value="">Select connectivity</option>' +
        connectivityOptions.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = '+ Add new connectivity';
    connectivitySelect.appendChild(newOption);
    
    if (currentValue) {
        const normalizedValue = currentValue === '__new__' ? currentValue : normalizeOptionValue(currentValue);
        connectivitySelect.value = normalizedValue;
    }

    lastConnectivityValue = connectivitySelect.value || '';
}

function populateNetworks() {
    const networkSelect = document.getElementById('device-network');
    if (!networkSelect) return;
    const currentValue = networkSelect.value;
    const sortedNetworks = [...(networks || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    networkSelect.innerHTML = '<option value="">Select network</option>' +
        sortedNetworks.map(network => `<option value="${network.id}">${escapeHtml(network.name)}</option>`).join('');
    if (currentValue) {
        networkSelect.value = currentValue;
    }
}

function populateBatteryTypes() {
    const batteryTypeSelect = document.getElementById('device-battery-type');
    const currentValue = batteryTypeSelect.value;
    
    const batteryTypes = settings.batteryTypes || [];
    const deviceBatteryTypes = [...new Set(devices.map(d => d.batteryType).filter(Boolean))];
    const batteryOptions = buildFriendlyOptions(batteryTypes, deviceBatteryTypes, formatDeviceType);
    batteryTypeSelect.innerHTML = '<option value="">Select battery type</option>' +
        batteryOptions.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = '+ Add new battery type';
    batteryTypeSelect.appendChild(newOption);
    
    if (currentValue) {
        const normalizedValue = currentValue === '__new__' ? currentValue : normalizeOptionValue(currentValue);
        batteryTypeSelect.value = normalizedValue;
    }

    lastBatteryTypeValue = batteryTypeSelect.value || '';
}

function normalizeLabelId(value) {
    return String(value || '').trim();
}

function normalizeLabelList(values) {
    const result = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
        const normalized = normalizeLabelId(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
}

function labelsEqual(source, target) {
    const normalizedSource = normalizeLabelList(source);
    const normalizedTarget = normalizeLabelList(target);
    if (normalizedSource.length !== normalizedTarget.length) return false;
    const targetSet = new Set(normalizedTarget);
    return normalizedSource.every((value) => targetSet.has(value));
}

function normalizeLabelColor(value) {
    if (typeof resolveLabelColor === 'function') {
        return resolveLabelColor(value);
    }
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw;
}

function formatLabelIconText(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const clean = raw.includes(':') ? raw.split(':').pop() : raw;
    const chunks = clean.split(/[-_]/).filter(Boolean);
    const initials = chunks.slice(0, 2).map((item) => item[0]).join('');
    return initials.toUpperCase();
}

function getLabelSelect() {
    return document.getElementById('device-labels');
}

function getLabelPicker() {
    return document.getElementById('device-labels-picker');
}

function getLabelCountEl() {
    return document.getElementById('device-labels-count');
}

function getLabelEmptyEl() {
    return document.getElementById('device-labels-empty');
}

function buildLabelOptions() {
    const options = new Map();
    (labels || []).forEach((label) => {
        if (!label || typeof label !== 'object') return;
        const id = normalizeLabelId(label.id || label.label_id);
        if (!id || options.has(id)) return;
        const name = String(label.name || '').trim() || id;
        const color = normalizeLabelColor(label.color);
        const icon = String(label.icon || '').trim();
        options.set(id, {
            id,
            name,
            color,
            icon
        });
    });
    (devices || []).forEach((device) => {
        normalizeLabelList(device && device.labels).forEach((labelId) => {
            if (!options.has(labelId)) {
                options.set(labelId, {
                    id: labelId,
                    name: labelId,
                    color: '',
                    icon: ''
                });
            }
        });
    });
    return Array.from(options.values())
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function getSelectedLabels() {
    const picker = getLabelPicker();
    if (picker) {
        return Array.from(picker.querySelectorAll('input[type="checkbox"]:checked'))
            .map((input) => normalizeLabelId(input.value))
            .filter(Boolean);
    }
    const labelSelect = getLabelSelect();
    if (!labelSelect) return [];
    return Array.from(labelSelect.selectedOptions || [])
        .map((option) => normalizeLabelId(option.value))
        .filter(Boolean);
}

function updateLabelSelectionCount(countOverride) {
    const countEl = getLabelCountEl();
    if (!countEl) return;
    const count = Number.isFinite(countOverride) ? countOverride : getSelectedLabels().length;
    countEl.textContent = `${count} selected`;
}

function setSelectedLabels(values) {
    const normalized = new Set(normalizeLabelList(values));
    const labelSelect = getLabelSelect();
    if (labelSelect) {
        Array.from(labelSelect.options || []).forEach((option) => {
            option.selected = normalized.has(option.value);
        });
    }
    const picker = getLabelPicker();
    if (picker) {
        Array.from(picker.querySelectorAll('.label-chip')).forEach((chip) => {
            const input = chip.querySelector('input[type="checkbox"]');
            if (!input) return;
            const isSelected = normalized.has(input.value);
            input.checked = isSelected;
            chip.classList.toggle('is-selected', isSelected);
        });
    }
    updateLabelSelectionCount(normalized.size);
}

function bindLabelPickerEvents() {
    const picker = getLabelPicker();
    if (!picker || picker.dataset.bound === 'true') return;
    picker.dataset.bound = 'true';
    picker.addEventListener('change', (event) => {
        const target = event.target;
        if (!target || target.type !== 'checkbox') return;
        setSelectedLabels(getSelectedLabels());
    });
}

function populateLabels() {
    labels = allLabels;
    const selected = getSelectedLabels();
    const options = buildLabelOptions();
    const labelSelect = getLabelSelect();
    const picker = getLabelPicker();
    const emptyEl = getLabelEmptyEl();

    if (labelSelect) {
        labelSelect.disabled = options.length === 0;
        if (options.length === 0) {
            labelSelect.innerHTML = '<option value="" disabled>No labels available</option>';
        } else {
            labelSelect.innerHTML = options
                .map(option => `<option value="${option.id}">${escapeHtml(option.name)}</option>`)
                .join('');
        }
    }

    if (picker) {
        if (options.length === 0) {
            picker.innerHTML = '';
        } else {
            picker.innerHTML = options
                .map((option) => {
                    const colorStyle = option.color ? ` style="--label-color: ${option.color};"` : '';
                    const colorClass = option.color ? ' has-color' : '';
                    return `
                        <label class="label-chip${colorClass}"${colorStyle}>
                            <input type="checkbox" value="${escapeHtml(option.id)}">
                            <span class="label-chip-body">
                                <span class="label-swatch"></span>
                                <span class="label-name">${escapeHtml(option.name)}</span>
                            </span>
                        </label>
                    `;
                })
                .join('');
            bindLabelPickerEvents();
        }
    }

    if (emptyEl) {
        emptyEl.hidden = options.length > 0;
    }
    setSelectedLabels(selected);
}

function populateAreas() {
    const areaSelect = document.getElementById('device-area');
    const controlledSelect = document.getElementById('device-controlled-area');
    const installedValue = areaSelect ? areaSelect.value : '';
    const controlledValue = controlledSelect ? controlledSelect.value : '';
    const sortedAreas = [...areas].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    );
    const optionsHtml = sortedAreas
        .map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`)
        .join('');

    if (areaSelect) {
        areaSelect.innerHTML = '<option value="">Select an area</option>' + optionsHtml;
        if (installedValue) {
            areaSelect.value = installedValue;
        }
    }

    if (controlledSelect) {
        controlledSelect.innerHTML = '<option value="">Select an area</option>' + optionsHtml;
        if (controlledValue) {
            controlledSelect.value = controlledValue;
        }
    }
}

function setAreas() {
    areas = allAreas;
    populateAreas();
    updateAreaAutoSyncState();
}

function buildHaDeviceDetailsUrl(deviceId) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) return '';
    return `${window.location.origin}/config/devices/device/${encodeURIComponent(normalizedId)}`;
}

function getHaAreaSyncTarget() {
    return settings?.haAreaSyncTarget === 'installed' ? 'installed' : 'controlled';
}

function updateHaAreaSyncNotes(isHaDevice) {
    const installedNote = document.getElementById('device-area-ha-note');
    const controlledNote = document.getElementById('device-controlled-area-ha-note');
    if (!installedNote && !controlledNote) return;

    const target = getHaAreaSyncTarget();
    if (installedNote) {
        installedNote.hidden = !isHaDevice || target !== 'installed';
    }
    if (controlledNote) {
        controlledNote.hidden = !isHaDevice || target !== 'controlled';
    }
}

function updateViewOnHaButton(device) {
    const viewOnHaButton = document.getElementById('view-on-ha-btn');
    const isHaDevice = isHomeAssistantLinked(device && device.homeAssistant);
    const nameHaNote = document.getElementById('device-name-ha-note');
    const labelsHaNote = document.getElementById('device-labels-ha-note');
    if (nameHaNote) {
        nameHaNote.hidden = !isHaDevice;
    }
    if (labelsHaNote) {
        labelsHaNote.hidden = !isHaDevice;
    }
    updateHaAreaSyncNotes(isHaDevice);
    if (!viewOnHaButton) return;

    const deviceId = device && device.id ? String(device.id).trim() : '';
    const haUrl = isHaDevice ? buildHaDeviceDetailsUrl(deviceId) : '';
    const showButton = Boolean(haUrl);

    viewOnHaButton.hidden = !showButton;
    if (showButton) {
        viewOnHaButton.href = haUrl;
    } else {
        viewOnHaButton.removeAttribute('href');
    }
}

function initializeDeviceLinksSupport() {
    const addLinkButton = document.getElementById('add-device-link-btn');
    const linksList = document.getElementById('device-links-list');
    if (addLinkButton) {
        addLinkButton.addEventListener('click', () => {
            appendDeviceLinkRow();
            updateDeviceLinksEmptyState();
        });
    }
    if (!linksList) return;

    linksList.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;
        const openButton = target.closest('[data-link-open]');
        if (openButton) {
            const row = openButton.closest('.device-link-item');
            openDeviceLinkRow(row);
            return;
        }
        const removeButton = target.closest('[data-link-remove]');
        if (removeButton) {
            const row = removeButton.closest('.device-link-item');
            if (row) {
                row.remove();
                updateDeviceLinksEmptyState();
            }
        }
    });

    linksList.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const row = target.closest('.device-link-item');
        if (!row) return;

        if (target.matches('[data-link-name]')) {
            const autoName = row.dataset.autoName || '';
            const value = target.value.trim();
            target.dataset.userModified = value && value !== autoName ? 'true' : 'false';
            return;
        }

        if (target.matches('[data-link-url]')) {
            updateDeviceLinkRowState(row);
        }
    });

    renderDeviceLinks([]);
}

function renderDeviceLinks(links) {
    const linksList = document.getElementById('device-links-list');
    if (!linksList) return;
    linksList.innerHTML = '';
    const normalizedLinks = normalizeDeviceLinks(links);
    normalizedLinks.forEach((link) => appendDeviceLinkRow(link));
    updateDeviceLinksEmptyState();
}

function appendDeviceLinkRow(link = {}) {
    const linksList = document.getElementById('device-links-list');
    if (!linksList) return null;

    const item = document.createElement('div');
    item.className = 'device-link-item';
    item.innerHTML = `
        <div class="form-group">
            <label>Label</label>
            <input type="text" data-link-name placeholder="e.g., manufacturer.com">
        </div>
        <div class="form-group">
            <label>URL</label>
            <input type="url" data-link-url placeholder="https://example.com">
        </div>
        <div class="device-link-actions">
            <button class="btn btn-secondary btn-sm btn-icon" type="button" data-link-open aria-label="Open link" data-tooltip="Open link" disabled>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 4h6v6"></path>
                    <path d="M10 14 20 4"></path>
                    <path d="M20 13v5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h5"></path>
                </svg>
            </button>
            <button class="btn btn-secondary btn-sm btn-icon device-link-remove" type="button" data-link-remove aria-label="Remove link" data-tooltip="Remove link">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18"></path>
                    <path d="M8 6V4h8v2"></path>
                    <path d="M6 6l1 14h10l1-14"></path>
                    <path d="M10 11v6"></path>
                    <path d="M14 11v6"></path>
                </svg>
            </button>
        </div>
    `;

    const nameInput = item.querySelector('[data-link-name]');
    const urlInput = item.querySelector('[data-link-url]');
    if (nameInput) {
        nameInput.value = String(link.name || '').trim();
        nameInput.dataset.userModified = nameInput.value ? 'true' : 'false';
    }
    if (urlInput) {
        urlInput.value = String(link.url || '').trim();
    }

    linksList.appendChild(item);
    updateDeviceLinkRowState(item, { preferAutofill: !String(link.name || '').trim() });
    return item;
}

function updateDeviceLinkRowState(row, options = {}) {
    if (!row) return;
    const nameInput = row.querySelector('[data-link-name]');
    const urlInput = row.querySelector('[data-link-url]');
    const openButton = row.querySelector('[data-link-open]');
    if (!nameInput || !urlInput || !openButton) return;

    const normalizedUrl = normalizeExternalUrl(urlInput.value);
    const autoName = deriveLinkNameFromUrl(urlInput.value);
    const previousAutoName = row.dataset.autoName || '';
    const currentName = nameInput.value.trim();
    const userModified = nameInput.dataset.userModified === 'true';
    const shouldAutofill = Boolean(
        autoName && (
            options.preferAutofill ||
            !currentName ||
            (!userModified && (!currentName || currentName === previousAutoName))
        )
    );

    row.dataset.autoName = autoName;
    if (shouldAutofill) {
        nameInput.value = autoName;
        nameInput.dataset.userModified = 'false';
    } else if (!autoName && !userModified && currentName === previousAutoName) {
        nameInput.value = '';
        nameInput.dataset.userModified = 'false';
    }

    openButton.disabled = !normalizedUrl;
    if (normalizedUrl) {
        openButton.dataset.url = normalizedUrl;
        openButton.title = normalizedUrl;
    } else {
        delete openButton.dataset.url;
        openButton.removeAttribute('title');
    }
}

function openDeviceLinkRow(row) {
    if (!row) return;
    const openButton = row.querySelector('[data-link-open]');
    const url = String(openButton?.dataset.url || '').trim();
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
}

function updateDeviceLinksEmptyState() {
    const linksList = document.getElementById('device-links-list');
    const emptyState = document.getElementById('device-links-empty');
    if (!linksList || !emptyState) return;
    emptyState.hidden = linksList.children.length > 0;
}

function getDeviceLinksForLoad(device) {
    const normalizedLinks = normalizeDeviceLinks(device && device.links);
    if (normalizedLinks.length) return normalizedLinks;
    return getLegacyWebsiteLink(device);
}

function collectDeviceLinks() {
    const linksList = document.getElementById('device-links-list');
    if (!linksList) {
        return { links: [], invalid: false };
    }

    const links = [];
    let invalid = false;
    linksList.querySelectorAll('.device-link-item').forEach((row) => {
        const nameInput = row.querySelector('[data-link-name]');
        const urlInput = row.querySelector('[data-link-url]');
        const rawName = String(nameInput?.value || '').trim();
        const rawUrl = String(urlInput?.value || '').trim();
        if (!rawName && !rawUrl) return;

        const url = normalizeExternalUrl(rawUrl);
        if (!url) {
            invalid = true;
            if (urlInput) {
                urlInput.focus();
                urlInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            return;
        }

        links.push({
            name: rawName || deriveLinkNameFromUrl(url),
            url
        });
    });

    return {
        links: normalizeDeviceLinks(links),
        invalid
    };
}

function updateAreaAutoSyncState() {
    const installed = document.getElementById('device-area')?.value || '';
    const controlled = document.getElementById('device-controlled-area')?.value || '';
    autoSyncAreasEnabled = !installed && !controlled;
}

function handleAreaAutoSync(sourceSelect, targetSelect) {
    if (!autoSyncAreasEnabled) return;
    if (!sourceSelect) return;
    const value = sourceSelect.value;
    if (!value) return;
    if (targetSelect && !targetSelect.value) {
        targetSelect.value = value;
        autoSyncAreasEnabled = false;
    }
}

// Load device for editing
async function loadDeviceForEdit(deviceId) {
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) {
        await showAlert('Device not found.', { title: 'Not found' });
        window.location.href = 'devices.html';
        return;
    }
    
    loadDeviceData(device);
}

async function syncDeviceNameToHa(deviceId, name) {
    const normalizedId = String(deviceId || '').trim();
    const normalizedName = String(name || '').trim();
    if (!normalizedId || !normalizedName) {
        return;
    }

    const response = await fetch(HA_DEVICE_NAME_SYNC_API_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: normalizedId,
            name: normalizedName
        })
    });

    if (!response.ok) {
        let errorMessage = `Failed to update Home Assistant device name (${response.status})`;
        try {
            const payload = await response.json();
            if (payload && payload.error) {
                errorMessage = payload.error;
            }
        } catch (error) {
            // Ignore JSON parsing errors and keep the default message.
        }
        throw new Error(errorMessage);
    }
}

async function syncDeviceAreaToHa(deviceId, areaId) {
    const normalizedId = String(deviceId || '').trim();
    const normalizedAreaId = String(areaId || '').trim();
    if (!normalizedId) {
        return;
    }

    const response = await fetch(HA_DEVICE_AREA_SYNC_API_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: normalizedId,
            areaId: normalizedAreaId
        })
    });

    if (!response.ok) {
        let errorMessage = `Failed to update Home Assistant device area (${response.status})`;
        try {
            const payload = await response.json();
            if (payload && payload.error) {
                errorMessage = payload.error;
            }
        } catch (error) {
            // Ignore JSON parsing errors and keep the default message.
        }
        throw new Error(errorMessage);
    }
}

async function syncDeviceLabelsToHa(deviceId, labels) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) {
        return;
    }
    const normalizedLabels = normalizeLabelList(labels);

    const response = await fetch(HA_DEVICE_LABELS_SYNC_API_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: normalizedId,
            labels: normalizedLabels
        })
    });

    if (!response.ok) {
        let errorMessage = `Failed to update Home Assistant device labels (${response.status})`;
        try {
            const payload = await response.json();
            if (payload && payload.error) {
                errorMessage = payload.error;
            }
        } catch (error) {
            // Ignore JSON parsing errors and keep the default message.
        }
        throw new Error(errorMessage);
    }
}

async function loadDuplicateDeviceFromStorage() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('duplicate') !== 'true') {
        return;
    }
    const stored = await getUiPreference('duplicateDevice');
    if (!stored) {
        return;
    }
    let duplicateData;
    try {
        duplicateData = typeof stored === 'string' ? JSON.parse(stored) : stored;
    } catch (error) {
        await setUiPreference('duplicateDevice', null);
        return;
    }
    duplicateData.installationDate = '';
    duplicateData.lastBatteryChange = '';
    duplicateData.files = [];
    loadDeviceData(duplicateData);
    await setUiPreference('duplicateDevice', null);
}

function loadDeviceData(device) {
    if (device && device.id) {
        activeDeviceId = String(device.id);
    }
    // Load device photo
    currentDeviceImage = device && device.deviceImage ? device.deviceImage : null;
    if (currentDeviceImage && currentDeviceImage.path) {
        setDevicePhotoPreview(currentDeviceImage.path, true);
    } else {
        setDevicePhotoPreview(null, false);
    }
    updateViewOnHaButton(device);
    setAreas();
    const deviceIdReadonly = document.getElementById('device-id-readonly');
    if (deviceIdReadonly) {
        deviceIdReadonly.textContent = device && device.id ? String(device.id) : '-';
    }
    const serialNumberInput = document.getElementById('device-serial-number');
    if (serialNumberInput) {
        serialNumberInput.value = device.serialNumber || '';
    }
    document.getElementById('device-name').value = device.name || '';
    document.getElementById('device-brand').value = device.brand ? normalizeOptionValue(device.brand) : '';
    document.getElementById('device-model').value = device.model || '';
    document.getElementById('device-type').value = device.type ? normalizeOptionValue(device.type) : '';
    syncDevicePhotoTypeFallback();
    renderDeviceLinks(getDeviceLinksForLoad(device));
    if (editingDeviceId) {
        setWifiClientsFromAccessPointDevice(device.id);
    } else {
        setSelectedWifiClientIds([]);
    }
    setSelectedLabels(device.labels);
    document.getElementById('device-ip').value = device.ip || '';
    document.getElementById('device-mac').value = device.mac || '';
    document.getElementById('device-status').value = device.status || 'working';
    document.getElementById('device-power').value = device.power || '';
    document.getElementById('device-battery-type').value = device.batteryType ? normalizeOptionValue(device.batteryType) : '';
    document.getElementById('device-battery-count').value = device.batteryCount || '';
    document.getElementById('device-last-battery-change').value = device.lastBatteryChange || '';
    document.getElementById('device-battery-duration').value = device.batteryDuration || '';
    document.getElementById('device-ups-protected').checked = device.upsProtected || false;
    document.getElementById('device-idle-consumption').value = device.idleConsumption || '';
    document.getElementById('device-mean-consumption').value = device.meanConsumption || '';
    document.getElementById('device-max-consumption').value = device.maxConsumption || '';
    document.getElementById('device-installation-date').value = device.installationDate || '';
    const purchaseDateInput = document.getElementById('device-purchase-date');
    if (purchaseDateInput) {
        purchaseDateInput.value = device.purchaseDate || '';
    }
    const purchaseStoreInput = document.getElementById('device-purchase-store');
    if (purchaseStoreInput) {
        purchaseStoreInput.value = device.purchaseStore || '';
    }
    const purchasePriceInput = document.getElementById('device-purchase-price');
    if (purchasePriceInput) {
        purchasePriceInput.value = Number.isFinite(device.purchasePrice) ? device.purchasePrice : '';
    }
    const purchaseCurrencySelect = document.getElementById('device-purchase-currency');
    if (purchaseCurrencySelect) {
        purchaseCurrencySelect.value = device.purchaseCurrency || getDefaultCurrency();
    }
    const warrantyExpirationInput = document.getElementById('device-warranty-expiration');
    if (warrantyExpirationInput) {
        warrantyExpirationInput.value = device.warrantyExpiration || '';
    }
    document.getElementById('device-storage-size').value = device.storageSize || '';
    document.getElementById('device-storage-unit').value = device.storageUnit || '';
    document.getElementById('device-notes').value = device.notes || '';
    document.getElementById('device-connectivity').value = device.connectivity ? normalizeOptionValue(device.connectivity) : '';
    const networkSelect = document.getElementById('device-network');
    if (networkSelect) {
        networkSelect.value = device.networkId || '';
    }
    const wifiDownloadSpeedInput = document.getElementById('device-wifi-download-speed');
    if (wifiDownloadSpeedInput) {
        wifiDownloadSpeedInput.value = Number.isFinite(device.wifiDownloadSpeed) ? device.wifiDownloadSpeed : '';
    }
    const wifiUploadSpeedInput = document.getElementById('device-wifi-upload-speed');
    if (wifiUploadSpeedInput) {
        wifiUploadSpeedInput.value = Number.isFinite(device.wifiUploadSpeed) ? device.wifiUploadSpeed : '';
    }
    const wifiBandSelect = document.getElementById('device-wifi-band');
    if (wifiBandSelect) {
        wifiBandSelect.value = normalizeWifiBand(device.wifiBand || '');
    }
    setWifiAccessPointSelection(device.wifiAccessPointId || '');
    setZigbeeParentSelection(device.zigbeeParentId || '');
    setZwaveCoordinatorSelection(device.zwaveControllerId || '');
    document.getElementById('device-area').value = device.area || '';
    const controlledAreaInput = document.getElementById('device-controlled-area');
    if (controlledAreaInput) {
        controlledAreaInput.value = device.controlledArea || '';
    }
    updateAreaAutoSyncState();
    
    // Load checkbox values
    document.getElementById('device-thread-border-router').checked = device.threadBorderRouter || false;
    document.getElementById('device-matter-hub').checked = device.matterHub || false;
    document.getElementById('device-zigbee-controller').checked = device.zigbeeController || false;
    document.getElementById('device-zigbee-repeater').checked = device.zigbeeRepeater || false;
    document.getElementById('device-zwave-controller').checked = device.zwaveController || false;
    document.getElementById('device-home-assistant').checked = isHomeAssistantLinked(device.homeAssistant);
    document.getElementById('device-google-home').checked = device.googleHome || false;
    document.getElementById('device-alexa').checked = device.alexa || false;
    document.getElementById('device-apple-home-kit').checked = device.appleHomeKit || false;
    document.getElementById('device-samsung-smartthings').checked = device.samsungSmartThings || false;
    document.getElementById('device-local-only').checked = device.localOnly || false;
    if (editingDeviceId) {
        setZigbeeChildrenFromParentDevice(device.id);
        setZwaveChildrenFromControllerDevice(device.id);
    } else {
        setSelectedZigbeeChildIds([]);
        setSelectedZwaveChildIds([]);
    }
    deviceFiles = normalizeDeviceFiles(device.files);
    renderDeviceFiles();
    
    handlePowerTypeChange();
    handleConnectivityChange();
    handleBatteryTypeChange();
    handleBrandChange();
    handleStatusChange();
    updateWifiClientsManagerVisibility();
    updateZigbeeClientsManagerVisibility();
    updateZwaveClientsManagerVisibility();
    lastTypeValue = document.getElementById('device-type').value;
    lastBatteryTypeValue = document.getElementById('device-battery-type').value;
    lastConnectivityValue = document.getElementById('device-connectivity').value;
    syncDevicePhotoTypeFallback();
    
    // Load ports
    if (device.ports) {
        loadPorts(device.ports);
    }
}

// Form Handlers
async function handleDeviceSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const shouldStayOnPage = form?.dataset?.submitMode === 'apply';
    if (form && form.dataset) {
        form.dataset.submitMode = 'save';
    }

    let connectivity = document.getElementById('device-connectivity').value;
    if (connectivity === '__new__') {
        showAlert('Please add a new connectivity option first.');
        return;
    }
    connectivity = normalizeOptionValue(connectivity);
    const isWifi = connectivity === 'wifi';
    const isZigbee = isZigbeeConnectivity(connectivity);
    const isZwave = isZwaveConnectivity(connectivity);
    const isEthernet = connectivity === 'ethernet';
    const showNetworkFields = isWifi || isEthernet;
    const showExtendedNetworkFields = isWifi;
    const ipValue = showNetworkFields ? document.getElementById('device-ip').value : '';
    const macValue = showNetworkFields ? document.getElementById('device-mac').value : '';
    const networkValue = showNetworkFields ? (document.getElementById('device-network')?.value || '') : '';
    const wifiDownloadSpeedValue = showExtendedNetworkFields
        ? parseOptionalNonNegativeNumber(document.getElementById('device-wifi-download-speed')?.value || '')
        : null;
    const wifiUploadSpeedValue = showExtendedNetworkFields
        ? parseOptionalNonNegativeNumber(document.getElementById('device-wifi-upload-speed')?.value || '')
        : null;
    const wifiBandValue = showExtendedNetworkFields
        ? normalizeWifiBand(document.getElementById('device-wifi-band')?.value || '')
        : '';
    const wifiAccessPointInput = document.getElementById('device-wifi-access-point');
    const wifiAccessPointValue = showExtendedNetworkFields
        ? String(wifiAccessPointInput?.dataset?.deviceId || '').trim()
        : '';
    if (showExtendedNetworkFields && wifiAccessPointInput) {
        const hasTypedValue = wifiAccessPointInput.value.trim() !== '';
        if (hasTypedValue && !wifiAccessPointValue) {
            wifiAccessPointInput.classList.add('port-search-invalid');
            showAlert('Please select a valid router or access point from the results list.');
            return;
        }
    }
    const zigbeeParentInput = document.getElementById('device-zigbee-parent');
    const zigbeeParentValue = isZigbee
        ? String(zigbeeParentInput?.dataset?.deviceId || '').trim()
        : '';
    if (isZigbee && zigbeeParentInput) {
        const hasTypedValue = zigbeeParentInput.value.trim() !== '';
        if (hasTypedValue && !zigbeeParentValue) {
            zigbeeParentInput.classList.add('port-search-invalid');
            showAlert('Please select a valid Zigbee router or coordinator from the results list.');
            return;
        }
    }
    const zwaveCoordinatorInput = document.getElementById('device-zwave-coordinator');
    const zwaveCoordinatorValue = isZwave
        ? String(zwaveCoordinatorInput?.dataset?.deviceId || '').trim()
        : '';
    if (isZwave && zwaveCoordinatorInput) {
        const hasTypedValue = zwaveCoordinatorInput.value.trim() !== '';
        if (hasTypedValue && !zwaveCoordinatorValue) {
            zwaveCoordinatorInput.classList.add('port-search-invalid');
            showAlert('Please select a valid Z-Wave coordinator from the results list.');
            return;
        }
    }
    const brandSelect = document.getElementById('device-brand');
    let brandValue = brandSelect.value;
    if (brandValue === '__new__') {
        showAlert('Please add a new brand first.');
        return;
    }
    brandValue = normalizeOptionValue(brandValue);
    let typeValue = document.getElementById('device-type').value;
    if (typeValue === '__new__') {
        showAlert('Please add a new type first.');
        return;
    }
    typeValue = normalizeOptionValue(typeValue);
    const wifiLinkedDeviceIds = isRouterOrAccessPointType(typeValue)
        ? getSelectedWifiClientIds()
        : [];
    const zigbeeControllerChecked = document.getElementById('device-zigbee-controller').checked;
    const zigbeeRepeaterChecked = document.getElementById('device-zigbee-repeater').checked;
    const zwaveControllerChecked = document.getElementById('device-zwave-controller').checked;
    const zigbeeLinkedDeviceIds = isZigbee && (zigbeeControllerChecked || zigbeeRepeaterChecked)
        ? getSelectedZigbeeChildIds()
        : [];
    const zwaveLinkedDeviceIds = isZwave && zwaveControllerChecked
        ? getSelectedZwaveChildIds()
        : [];
    let batteryTypeValue = document.getElementById('device-battery-type').value;
    if (batteryTypeValue === '__new__') {
        showAlert('Please add a new battery type first.');
        return;
    }
    batteryTypeValue = normalizeOptionValue(batteryTypeValue);
    
    // Validate ports from both containers
    const containers = ['ports-container', 'power-ports-container'];
    let hasInvalidPorts = false;
    
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const portSearchInputs = container.querySelectorAll('.port-device-search');
        portSearchInputs.forEach(input => {
            if (input.value.trim() && !input.dataset.deviceId) {
                hasInvalidPorts = true;
                input.classList.add('port-search-invalid');
            } else {
                input.classList.remove('port-search-invalid');
            }
        });
    });
    
    if (hasInvalidPorts) {
        showAlert('Please select valid devices from the search results for all ports, or clear the invalid entries.');
        return;
    }
    const linksResult = collectDeviceLinks();
    if (linksResult.invalid) {
        showAlert('Please enter a valid URL for each link, or remove the incomplete row.');
        return;
    }

    const statusValue = document.getElementById('device-status').value;
    const isPendingStatus = statusValue === 'pending';
    const idleConsumptionResult = parseOptionalNonNegativeNumberWithError(
        document.getElementById('device-idle-consumption').value,
        'Idle Consumption'
    );
    if (idleConsumptionResult.error) {
        showAlert(idleConsumptionResult.error);
        return;
    }
    const meanConsumptionResult = parseOptionalNonNegativeNumberWithError(
        document.getElementById('device-mean-consumption').value,
        'Mean Consumption'
    );
    if (meanConsumptionResult.error) {
        showAlert(meanConsumptionResult.error);
        return;
    }
    const maxConsumptionResult = parseOptionalNonNegativeNumberWithError(
        document.getElementById('device-max-consumption').value,
        'Max Consumption'
    );
    if (maxConsumptionResult.error) {
        showAlert(maxConsumptionResult.error);
        return;
    }
    const purchasePriceRaw = document.getElementById('device-purchase-price')?.value || '';
    const purchaseCurrencyValue = document.getElementById('device-purchase-currency')?.value || 'USD';
    const hasPurchasePrice = purchasePriceRaw.trim() !== '';
    const purchasePrice = hasPurchasePrice ? parseFloat(purchasePriceRaw) : null;
    const deviceData = {
        name: document.getElementById('device-name').value,
        brand: brandValue,
        model: document.getElementById('device-model').value,
        serialNumber: document.getElementById('device-serial-number')?.value || '',
        type: typeValue,
        labels: getSelectedLabels(),
        ip: ipValue,
        mac: macValue,
        status: statusValue,
        power: document.getElementById('device-power').value,
        batteryType: batteryTypeValue,
        batteryCount: document.getElementById('device-battery-count').value,
        lastBatteryChange: document.getElementById('device-last-battery-change').value,
        batteryDuration: document.getElementById('device-battery-duration').value,
        upsProtected: document.getElementById('device-ups-protected').checked,
        idleConsumption: idleConsumptionResult.value,
        meanConsumption: meanConsumptionResult.value,
        maxConsumption: maxConsumptionResult.value,
        installationDate: document.getElementById('device-installation-date').value,
        purchaseDate: document.getElementById('device-purchase-date')?.value || '',
        purchaseStore: document.getElementById('device-purchase-store')?.value || '',
        purchasePrice,
        purchaseCurrency: hasPurchasePrice ? purchaseCurrencyValue : '',
        warrantyExpiration: document.getElementById('device-warranty-expiration')?.value || '',
        storageSize: document.getElementById('device-storage-size').value,
        storageUnit: document.getElementById('device-storage-unit').value,
        notes: document.getElementById('device-notes').value,
        links: linksResult.links,
        connectivity: connectivity,
        networkId: networkValue,
        wifiDownloadSpeed: wifiDownloadSpeedValue,
        wifiUploadSpeed: wifiUploadSpeedValue,
        wifiBand: wifiBandValue,
        wifiAccessPointId: wifiAccessPointValue,
        wifiLinkedDeviceIds: wifiLinkedDeviceIds,
        zigbeeParentId: zigbeeParentValue,
        zigbeeLinkedDeviceIds: zigbeeLinkedDeviceIds,
        zwaveControllerId: zwaveCoordinatorValue,
        zwaveLinkedDeviceIds: zwaveLinkedDeviceIds,
        area: isPendingStatus ? '' : document.getElementById('device-area').value,
        controlledArea: isPendingStatus ? '' : (document.getElementById('device-controlled-area')?.value || ''),
        threadBorderRouter: document.getElementById('device-thread-border-router').checked,
        matterHub: document.getElementById('device-matter-hub').checked,
        zigbeeController: zigbeeControllerChecked,
        zigbeeRepeater: zigbeeRepeaterChecked,
        zwaveController: zwaveControllerChecked,
        googleHome: document.getElementById('device-google-home').checked,
        alexa: document.getElementById('device-alexa').checked,
        appleHomeKit: document.getElementById('device-apple-home-kit').checked,
        samsungSmartThings: document.getElementById('device-samsung-smartthings').checked,
        localOnly: document.getElementById('device-local-only').checked,
        ports: getPortsData(),
        files: normalizeDeviceFiles(deviceFiles)
    };
    
    if (editingDeviceId) {
        await updateDevice(editingDeviceId, deviceData, { stayOnPage: shouldStayOnPage });
    } else {
        await createDevice(deviceData);
    }
}

function handleApplyDevice() {
    const form = document.getElementById('device-form');
    if (!form || !editingDeviceId) return;
    form.dataset.submitMode = 'apply';
    if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function handlePowerTypeChange() {
    const status = document.getElementById('device-status').value;
    const isWishlist = status === 'wishlist';
    const powerType = document.getElementById('device-power').value;
    const powerHelpBtn = document.getElementById('power-help-btn');
    const batteryTypeGroup = document.getElementById('battery-type-group');
    const batteryCountGroup = document.getElementById('battery-count-group');
    const batteryChangeGroup = document.getElementById('battery-change-group');
    const batteryDurationGroup = document.getElementById('battery-duration-group');
    const upsProtectedGroup = document.getElementById('ups-protected-group');
    const idleConsumptionGroup = document.getElementById('idle-consumption-group');
    const meanConsumptionGroup = document.getElementById('mean-consumption-group');
    const maxConsumptionGroup = document.getElementById('max-consumption-group');
    const powerPortsSection = document.getElementById('power-ports-section');

    const showGroup = (group) => {
        if (!group) return;
        group.classList.remove('is-hidden', 'is-collapsed');
    };

    const hideGroup = (group) => {
        if (!group) return;
        group.classList.add('is-collapsed');
        group.classList.remove('is-hidden');
    };

    if (powerHelpBtn) {
        powerHelpBtn.style.display = powerType === 'battery' ? '' : 'none';
        if (powerType !== 'battery') {
            closePowerHelpModal();
        }
    }
    
    if (!powerType) {
        hideGroup(batteryTypeGroup);
        hideGroup(batteryCountGroup);
        hideGroup(batteryChangeGroup);
        hideGroup(batteryDurationGroup);
        hideGroup(upsProtectedGroup);
        hideGroup(idleConsumptionGroup);
        hideGroup(meanConsumptionGroup);
        hideGroup(maxConsumptionGroup);
        hideGroup(powerPortsSection);
        document.getElementById('device-battery-type').value = '';
        document.getElementById('device-battery-count').value = '';
        document.getElementById('device-last-battery-change').value = '';
        document.getElementById('device-battery-duration').value = '';
        document.getElementById('device-idle-consumption').value = '';
        document.getElementById('device-mean-consumption').value = '';
        document.getElementById('device-max-consumption').value = '';
        document.getElementById('device-ups-protected').checked = false;
        updateBatteryBuyButton();
    } else if (powerType === 'battery') {
        showGroup(batteryTypeGroup);
        showGroup(batteryCountGroup);
        if (isWishlist) {
            hideGroup(batteryChangeGroup);
        } else {
            showGroup(batteryChangeGroup);
        }
        showGroup(batteryDurationGroup);
        hideGroup(upsProtectedGroup);
        hideGroup(idleConsumptionGroup);
        hideGroup(meanConsumptionGroup);
        hideGroup(maxConsumptionGroup);
        hideGroup(powerPortsSection);
        document.getElementById('device-idle-consumption').value = '';
        document.getElementById('device-mean-consumption').value = '';
        document.getElementById('device-max-consumption').value = '';
        document.getElementById('device-ups-protected').checked = false;
        handleBatteryTypeChange();
    } else {
        hideGroup(batteryTypeGroup);
        hideGroup(batteryCountGroup);
        hideGroup(batteryChangeGroup);
        hideGroup(batteryDurationGroup);
        showGroup(upsProtectedGroup);
        showGroup(idleConsumptionGroup);
        showGroup(meanConsumptionGroup);
        showGroup(maxConsumptionGroup);
        showGroup(powerPortsSection);
        document.getElementById('device-battery-type').value = '';
        document.getElementById('device-battery-count').value = '';
        document.getElementById('device-last-battery-change').value = '';
        document.getElementById('device-battery-duration').value = '';
        updateBatteryBuyButton();
    }
}

function handleStatusChange() {
    const status = document.getElementById('device-status').value;
    const isWishlist = status === 'wishlist';
    const isPending = status === 'pending';
    const areaGroup = document.getElementById('device-area-group');
    const controlledAreaGroup = document.getElementById('device-controlled-area-group');
    const areaSelect = document.getElementById('device-area');
    const controlledAreaSelect = document.getElementById('device-controlled-area');
    const installationGroup = document.getElementById('device-installation-group');
    const installationInput = document.getElementById('device-installation-date');
    const batteryChangeGroup = document.getElementById('battery-change-group');
    const batteryChangeInput = document.getElementById('device-last-battery-change');
    const hideInstallationDate = isWishlist || isPending;

    if (areaGroup) {
        areaGroup.classList.remove('is-collapsed');
        areaGroup.classList.toggle('is-hidden', isWishlist || isPending);
    }
    if (controlledAreaGroup) {
        controlledAreaGroup.classList.remove('is-collapsed');
        controlledAreaGroup.classList.toggle('is-hidden', isWishlist || isPending);
    }
    if (areaSelect) {
        areaSelect.required = false;
    }
    if (isPending) {
        if (areaSelect) {
            areaSelect.value = '';
        }
        if (controlledAreaSelect) {
            controlledAreaSelect.value = '';
        }
        updateAreaAutoSyncState();
    }
    if (installationGroup) {
        installationGroup.classList.remove('is-collapsed');
        installationGroup.classList.toggle('is-hidden', hideInstallationDate);
        if (hideInstallationDate && installationInput) {
            installationInput.value = '';
        }
    }
    if (batteryChangeGroup) {
        const shouldHideBatteryChange = isWishlist || document.getElementById('device-power').value !== 'battery';
        batteryChangeGroup.classList.toggle('is-collapsed', shouldHideBatteryChange);
        if (!shouldHideBatteryChange) {
            batteryChangeGroup.classList.remove('is-hidden');
        }
    }
}

function handleBatteryTypeChange() {
    const batteryTypeSelect = document.getElementById('device-battery-type');
    if (batteryTypeSelect.value === '__new__') {
        updateBatteryBuyButton();
        openBatteryTypeModal();
        return;
    }
    const powerType = document.getElementById('device-power').value;
    const batteryType = normalizeOptionValue(document.getElementById('device-battery-type').value || '');
    const batteryCountGroup = document.getElementById('battery-count-group');
    const batteryCountInput = document.getElementById('device-battery-count');
    const hideCount = powerType !== 'battery' || batteryType === 'internal' || batteryType === 'usb';
    batteryCountGroup.classList.toggle('is-hidden', hideCount);
    if (hideCount) {
        batteryCountInput.value = '';
    } else {
        const currentValue = batteryCountInput.value;
        const numericValue = Number(currentValue);
        if (!currentValue || !Number.isFinite(numericValue) || numericValue <= 0) {
            batteryCountInput.value = '1';
        }
    }
    updateBatteryBuyButton();
}

function handleBrandChange() {
    const brandSelect = document.getElementById('device-brand');
    const showNewBrand = brandSelect.value === '__new__';
    if (showNewBrand) {
        openBrandModal();
    } else {
        lastBrandValue = brandSelect.value;
    }
}

function handleTypeChange() {
    const typeSelect = document.getElementById('device-type');
    if (typeSelect.value === '__new__') {
        openTypeModal();
    } else {
        lastTypeValue = typeSelect.value;
        updateWifiClientsManagerVisibility();
        syncDevicePhotoTypeFallback();
    }
}

function handleConnectivitySelectChange() {
    const connectivitySelect = document.getElementById('device-connectivity');
    if (connectivitySelect.value === '__new__') {
        openConnectivityModal();
    } else {
        lastConnectivityValue = connectivitySelect.value;
        handleConnectivityChange();
    }
}

function openBrandModal() {
    const modal = document.getElementById('brand-modal');
    const input = document.getElementById('brand-modal-input');
    if (!modal || !input) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.value = '';
    input.focus();
}

function closeBrandModal() {
    const modal = document.getElementById('brand-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('device-brand').value = lastBrandValue;
}

async function saveBrandModal() {
    const input = document.getElementById('brand-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a brand name.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.brands || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.brands = [...updatedSettings.brands, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
        settings = updatedSettings;
    }

    populateBrands();
    document.getElementById('device-brand').value = normalized;
    lastBrandValue = normalized;
    closeBrandModal();
}

function openTypeModal() {
    const modal = document.getElementById('type-modal');
    const input = document.getElementById('type-modal-input');
    if (!modal || !input) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.value = '';
    input.focus();
}

function closeTypeModal() {
    const modal = document.getElementById('type-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('device-type').value = lastTypeValue;
    updateWifiClientsManagerVisibility();
    syncDevicePhotoTypeFallback();
}

async function saveTypeModal() {
    const input = document.getElementById('type-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a type name.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.types || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.types = [...updatedSettings.types, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
        settings = updatedSettings;
    }

    populateTypes();
    document.getElementById('device-type').value = normalized;
    lastTypeValue = normalized;
    updateWifiClientsManagerVisibility();
    syncDevicePhotoTypeFallback();
    closeTypeModal();
}

function openBatteryTypeModal() {
    const modal = document.getElementById('battery-type-modal');
    const input = document.getElementById('battery-type-modal-input');
    if (!modal || !input) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.value = '';
    input.focus();
}

function closeBatteryTypeModal() {
    const modal = document.getElementById('battery-type-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('device-battery-type').value = lastBatteryTypeValue;
    handleBatteryTypeChange();
}

async function saveBatteryTypeModal() {
    const input = document.getElementById('battery-type-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a battery type.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.batteryTypes || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.batteryTypes = [...updatedSettings.batteryTypes, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
        settings = updatedSettings;
    }

    populateBatteryTypes();
    document.getElementById('device-battery-type').value = normalized;
    lastBatteryTypeValue = normalized;
    handleBatteryTypeChange();
    closeBatteryTypeModal();
}

function openConnectivityModal() {
    const modal = document.getElementById('connectivity-modal');
    const input = document.getElementById('connectivity-modal-input');
    if (!modal || !input) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.value = '';
    input.focus();
}

function closeConnectivityModal() {
    const modal = document.getElementById('connectivity-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('device-connectivity').value = lastConnectivityValue;
    handleConnectivityChange();
}

function openConnectivityHelpModal() {
    const modal = document.getElementById('connectivity-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('connectivity-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeConnectivityHelpModal() {
    const modal = document.getElementById('connectivity-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openLocalOnlyHelpModal() {
    const modal = document.getElementById('local-only-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('local-only-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeLocalOnlyHelpModal() {
    const modal = document.getElementById('local-only-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openNetworkHelpModal() {
    const modal = document.getElementById('network-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('network-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeNetworkHelpModal() {
    const modal = document.getElementById('network-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openStatusHelpModal() {
    const modal = document.getElementById('status-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('status-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeStatusHelpModal() {
    const modal = document.getElementById('status-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openInstalledAreaHelpModal() {
    const modal = document.getElementById('installed-area-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('installed-area-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeInstalledAreaHelpModal() {
    const modal = document.getElementById('installed-area-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openControlledAreaHelpModal() {
    const modal = document.getElementById('controlled-area-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('controlled-area-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeControlledAreaHelpModal() {
    const modal = document.getElementById('controlled-area-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openIpHelpModal() {
    const modal = document.getElementById('ip-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('ip-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeIpHelpModal() {
    const modal = document.getElementById('ip-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openNameHelpModal() {
    const modal = document.getElementById('name-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('name-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeNameHelpModal() {
    const modal = document.getElementById('name-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openUpsHelpModal() {
    const modal = document.getElementById('ups-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('ups-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeUpsHelpModal() {
    const modal = document.getElementById('ups-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openPowerHelpModal() {
    const modal = document.getElementById('power-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('power-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closePowerHelpModal() {
    const modal = document.getElementById('power-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openZigbeeRouterHelpModal() {
    const modal = document.getElementById('zigbee-router-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('zigbee-router-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeZigbeeRouterHelpModal() {
    const modal = document.getElementById('zigbee-router-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openZigbeeCoordinatorHelpModal() {
    const modal = document.getElementById('zigbee-coordinator-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('zigbee-coordinator-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeZigbeeCoordinatorHelpModal() {
    const modal = document.getElementById('zigbee-coordinator-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openThreadBorderRouterHelpModal() {
    const modal = document.getElementById('thread-border-router-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('thread-border-router-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeThreadBorderRouterHelpModal() {
    const modal = document.getElementById('thread-border-router-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openZwaveControllerHelpModal() {
    const modal = document.getElementById('zwave-controller-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('zwave-controller-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeZwaveControllerHelpModal() {
    const modal = document.getElementById('zwave-controller-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function openMatterBridgeHelpModal() {
    const modal = document.getElementById('matter-bridge-help-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    const closeBtn = document.getElementById('matter-bridge-help-close');
    if (closeBtn) {
        closeBtn.focus();
    }
}

function closeMatterBridgeHelpModal() {
    const modal = document.getElementById('matter-bridge-help-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

async function saveConnectivityModal() {
    const input = document.getElementById('connectivity-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a connectivity option.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.connectivity || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.connectivity = [...updatedSettings.connectivity, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
        settings = updatedSettings;
    }

    populateConnectivity();
    document.getElementById('device-connectivity').value = normalized;
    lastConnectivityValue = normalized;
    handleConnectivityChange();
    closeConnectivityModal();
}

function handleConnectivityChange() {
    const connectivity = document.getElementById('device-connectivity').value;
    const normalizedConnectivity = normalizeOptionValue(connectivity);
    const ipGroup = document.getElementById('ip-address-group');
    const macGroup = document.getElementById('mac-address-group');
    const networkGroup = document.getElementById('network-group');
    const wifiDetailsRow = document.getElementById('wifi-details-row');
    const wifiAccessPointGroup = document.getElementById('wifi-access-point-group');
    const zigbeeParentGroup = document.getElementById('zigbee-parent-group');
    const zwaveCoordinatorGroup = document.getElementById('zwave-coordinator-group');
    const isWifi = normalizedConnectivity === 'wifi';
    const isZigbee = isZigbeeConnectivity(normalizedConnectivity);
    const isZwave = isZwaveConnectivity(normalizedConnectivity);
    const isZigbeeCoordinator = isZigbee && Boolean(document.getElementById('device-zigbee-controller')?.checked);
    const isEthernet = normalizedConnectivity === 'ethernet';
    const showNetworkFields = isWifi || isEthernet;
    const showWifiSpecificFields = isWifi;
    const showZigbeeParentField = isZigbee && !isZigbeeCoordinator;

    ipGroup.classList.toggle('is-hidden', !showNetworkFields);
    macGroup.classList.toggle('is-hidden', !showNetworkFields);
    if (networkGroup) {
        networkGroup.classList.toggle('is-hidden', !showNetworkFields);
    }
    if (wifiDetailsRow) {
        wifiDetailsRow.classList.toggle('is-hidden', !showWifiSpecificFields);
    }
    if (wifiAccessPointGroup) {
        wifiAccessPointGroup.classList.toggle('is-hidden', !showWifiSpecificFields);
    }
    if (zigbeeParentGroup) {
        zigbeeParentGroup.classList.toggle('is-hidden', !showZigbeeParentField);
    }
    if (zwaveCoordinatorGroup) {
        zwaveCoordinatorGroup.classList.toggle('is-hidden', !isZwave);
    }

    if (!showNetworkFields) {
        document.getElementById('device-ip').value = '';
        document.getElementById('device-mac').value = '';
        const networkSelect = document.getElementById('device-network');
        if (networkSelect) {
            networkSelect.value = '';
        }
    }

    if (!showWifiSpecificFields) {
        const wifiDownloadSpeedInput = document.getElementById('device-wifi-download-speed');
        if (wifiDownloadSpeedInput) {
            wifiDownloadSpeedInput.value = '';
        }
        const wifiUploadSpeedInput = document.getElementById('device-wifi-upload-speed');
        if (wifiUploadSpeedInput) {
            wifiUploadSpeedInput.value = '';
        }
        const wifiBandSelect = document.getElementById('device-wifi-band');
        if (wifiBandSelect) {
            wifiBandSelect.value = '';
        }
        clearWifiAccessPointSelection();
    }

    if (!showZigbeeParentField) {
        clearZigbeeParentSelection();
    }

    if (!isZwave) {
        clearZwaveCoordinatorSelection();
    }

    updateZigbeeClientsManagerVisibility();
    updateZwaveClientsManagerVisibility();
}

function clearWifiAccessPointSelection() {
    const wifiAccessPointInput = document.getElementById('device-wifi-access-point');
    const wifiAccessPointResults = document.getElementById('device-wifi-access-point-results');
    if (!wifiAccessPointInput) return;
    wifiAccessPointInput.value = '';
    wifiAccessPointInput.dataset.deviceId = '';
    wifiAccessPointInput.classList.remove('port-search-valid', 'port-search-invalid');
    if (wifiAccessPointResults) {
        wifiAccessPointResults.classList.add('is-hidden');
        wifiAccessPointResults.innerHTML = '';
    }
}

function setWifiAccessPointSelection(deviceId) {
    const wifiAccessPointInput = document.getElementById('device-wifi-access-point');
    if (!wifiAccessPointInput) return;
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) {
        clearWifiAccessPointSelection();
        return;
    }
    const target = devices.find(device => String(device.id || '') === normalizedId);
    if (!target) {
        clearWifiAccessPointSelection();
        return;
    }
    wifiAccessPointInput.value = target.name || target.model || 'Unnamed Device';
    wifiAccessPointInput.dataset.deviceId = normalizedId;
    wifiAccessPointInput.classList.add('port-search-valid');
    wifiAccessPointInput.classList.remove('port-search-invalid');
}

function setupWifiAccessPointSearch() {
    const searchInput = document.getElementById('device-wifi-access-point');
    const resultsDiv = document.getElementById('device-wifi-access-point-results');

    if (!searchInput || !resultsDiv) return;

    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();

        if (this.dataset.deviceId) {
            const currentDeviceId = this.dataset.deviceId;
            const currentDevice = devices.find(device => device.id === currentDeviceId);
            const currentDeviceName = currentDevice ? (currentDevice.name || currentDevice.model || 'Unnamed Device') : '';
            if (this.value !== currentDeviceName) {
                this.dataset.deviceId = '';
                this.classList.remove('port-search-valid');
            }
        }

        if (!query) {
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
            this.dataset.deviceId = '';
            this.classList.remove('port-search-valid', 'port-search-invalid');
            return;
        }

        const currentDeviceId = editingDeviceId;
        const filteredDevices = devices
            .filter(device => device.id !== currentDeviceId)
            .filter(device => isRouterOrAccessPointType(device.type))
            .filter(device => {
                const name = (device.name || device.model || '').toLowerCase();
                const brand = (device.brand || '').toLowerCase();
                const type = (device.type || '').toLowerCase();
                return name.includes(query) || brand.includes(query) || type.includes(query);
            })
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .slice(0, 10);

        if (filteredDevices.length === 0) {
            resultsDiv.innerHTML = '<div class="port-search-result-item no-results">No routers or access points found</div>';
            resultsDiv.classList.remove('is-hidden');
            return;
        }

        resultsDiv.innerHTML = filteredDevices
            .map(device => {
                const rawName = device.name || device.model || 'Unnamed Device';
                const displayName = escapeHtml(rawName);
                const brand = device.brand ? escapeHtml(getFriendlyOption(settings.brands, device.brand)) : '';
                const type = device.type ? escapeHtml(getFriendlyOption(settings.types, device.type, formatDeviceType)) : '';
                const meta = [brand, type].filter(Boolean).join(' • ');

                return `
                    <div class="port-search-result-item" data-device-id="${device.id}" data-device-name="${escapeHtml(rawName)}">
                        <div class="port-search-result-name">${displayName}</div>
                        ${meta ? `<div class="port-search-result-meta">${meta}</div>` : ''}
                    </div>
                `;
            })
            .join('');

        resultsDiv.classList.remove('is-hidden');

        resultsDiv.querySelectorAll('.port-search-result-item[data-device-id]').forEach(item => {
            item.addEventListener('click', function() {
                const deviceId = this.dataset.deviceId;
                const deviceName = this.dataset.deviceName;

                searchInput.value = deviceName;
                searchInput.dataset.deviceId = deviceId;
                searchInput.classList.add('port-search-valid');
                searchInput.classList.remove('port-search-invalid');
                resultsDiv.classList.add('is-hidden');
                resultsDiv.innerHTML = '';
            });
        });
    });

    searchInput.addEventListener('blur', function() {
        setTimeout(() => {
            if (this.value.trim() && !this.dataset.deviceId) {
                this.classList.add('port-search-invalid');
                return;
            }
            this.classList.remove('port-search-invalid');
        }, 200);
    });

    document.addEventListener('click', function(event) {
        if (!searchInput.contains(event.target) && !resultsDiv.contains(event.target)) {
            resultsDiv.classList.add('is-hidden');
        }
    });
}

function getCurrentFormDeviceId() {
    return String(editingDeviceId || activeDeviceId || '').trim();
}

function getSelectedWifiClientIds() {
    const currentDeviceId = getCurrentFormDeviceId();
    const result = [];
    selectedWifiClientIds.forEach((rawId) => {
        const clientId = String(rawId || '').trim();
        if (!clientId || clientId === currentDeviceId) return;
        const targetDevice = devices.find((device) => String(device.id || '') === clientId);
        if (!targetDevice || !isStrictWifiConnectivity(targetDevice.connectivity)) return;
        result.push(clientId);
    });
    return result;
}

function setSelectedWifiClientIds(ids) {
    const normalized = new Set();
    (Array.isArray(ids) ? ids : []).forEach((rawId) => {
        const clientId = String(rawId || '').trim();
        if (clientId) {
            normalized.add(clientId);
        }
    });
    selectedWifiClientIds = normalized;
    renderSelectedWifiClients();
}

function setWifiClientsFromAccessPointDevice(accessPointId) {
    const normalizedAccessPointId = String(accessPointId || '').trim();
    if (!normalizedAccessPointId) {
        setSelectedWifiClientIds([]);
        return;
    }
    const linkedClients = devices
        .filter((device) => String(device.id || '') !== normalizedAccessPointId)
        .filter((device) => isStrictWifiConnectivity(device.connectivity))
        .filter((device) => String(device.wifiAccessPointId || '').trim() === normalizedAccessPointId)
        .map((device) => String(device.id || '').trim())
        .filter(Boolean);
    setSelectedWifiClientIds(linkedClients);
}

function updateWifiClientsManagerVisibility() {
    const group = document.getElementById('wifi-linked-devices-group');
    if (!group) return;
    const typeValue = document.getElementById('device-type')?.value || '';
    const shouldShow = isRouterOrAccessPointType(typeValue);
    group.classList.toggle('is-hidden', !shouldShow);
    renderSelectedWifiClients();
}

function renderSelectedWifiClients() {
    const list = document.getElementById('wifi-linked-devices-list');
    const empty = document.getElementById('wifi-linked-devices-empty');
    if (!list || !empty) return;

    const selectedIds = getSelectedWifiClientIds();
    selectedWifiClientIds = new Set(selectedIds);

    if (!selectedIds.length) {
        list.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }

    empty.classList.add('is-hidden');
    list.innerHTML = selectedIds.map((clientId) => {
        const device = devices.find((item) => String(item.id || '') === clientId);
        if (!device) return '';
        const name = escapeHtml(device.name || device.model || 'Unnamed Device');
        const brand = device.brand ? escapeHtml(getFriendlyOption(settings.brands, device.brand)) : '';
        const type = device.type ? escapeHtml(getFriendlyOption(settings.types, device.type, formatDeviceType)) : '';
        const meta = [brand, type].filter(Boolean).join(' • ');
        return `
            <div class="wifi-linked-device-item" data-device-id="${clientId}">
                <div class="wifi-linked-device-meta">
                    <div class="wifi-linked-device-name">${name}</div>
                    ${meta ? `<div class="wifi-linked-device-details">${meta}</div>` : ''}
                </div>
                <button type="button" class="btn btn-danger btn-sm" data-wifi-client-remove="${clientId}">Unlink</button>
            </div>
        `;
    }).join('');

    list.querySelectorAll('[data-wifi-client-remove]').forEach((button) => {
        button.addEventListener('click', () => {
            const targetId = String(button.getAttribute('data-wifi-client-remove') || '').trim();
            if (!targetId) return;
            selectedWifiClientIds.delete(targetId);
            renderSelectedWifiClients();
        });
    });
}

function setupWifiClientsManager() {
    const searchInput = document.getElementById('device-wifi-client-search');
    const resultsDiv = document.getElementById('device-wifi-client-results');
    if (!searchInput || !resultsDiv) return;

    renderSelectedWifiClients();

    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        if (!query) {
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
            return;
        }

        const currentDeviceId = getCurrentFormDeviceId();
        const filteredDevices = devices
            .filter((device) => String(device.id || '') !== currentDeviceId)
            .filter((device) => !selectedWifiClientIds.has(String(device.id || '')))
            .filter((device) => isStrictWifiConnectivity(device.connectivity))
            .filter((device) => {
                const name = (device.name || device.model || '').toLowerCase();
                const brand = (device.brand || '').toLowerCase();
                const type = (device.type || '').toLowerCase();
                return name.includes(query) || brand.includes(query) || type.includes(query);
            })
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .slice(0, 10);

        if (!filteredDevices.length) {
            resultsDiv.innerHTML = '<div class="port-search-result-item no-results">No Wi-Fi devices found</div>';
            resultsDiv.classList.remove('is-hidden');
            return;
        }

        resultsDiv.innerHTML = filteredDevices.map((device) => {
            const rawName = device.name || device.model || 'Unnamed Device';
            const displayName = escapeHtml(rawName);
            const brand = device.brand ? escapeHtml(getFriendlyOption(settings.brands, device.brand)) : '';
            const type = device.type ? escapeHtml(getFriendlyOption(settings.types, device.type, formatDeviceType)) : '';
            const meta = [brand, type].filter(Boolean).join(' • ');
            return `
                <div class="port-search-result-item" data-wifi-client-id="${device.id}">
                    <div class="port-search-result-name">${displayName}</div>
                    ${meta ? `<div class="port-search-result-meta">${meta}</div>` : ''}
                </div>
            `;
        }).join('');

        resultsDiv.classList.remove('is-hidden');
        resultsDiv.querySelectorAll('[data-wifi-client-id]').forEach((item) => {
            item.addEventListener('click', () => {
                const clientId = String(item.getAttribute('data-wifi-client-id') || '').trim();
                if (!clientId) return;
                selectedWifiClientIds.add(clientId);
                searchInput.value = '';
                resultsDiv.innerHTML = '';
                resultsDiv.classList.add('is-hidden');
                renderSelectedWifiClients();
            });
        });
    });

    searchInput.addEventListener('blur', function() {
        setTimeout(() => {
            this.value = '';
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
        }, 200);
    });

    document.addEventListener('click', (event) => {
        if (!searchInput.contains(event.target) && !resultsDiv.contains(event.target)) {
            resultsDiv.classList.add('is-hidden');
        }
    });
}

function getProtocolChildState(protocol) {
    if (protocol === 'zigbee') return selectedZigbeeChildIds;
    if (protocol === 'zwave') return selectedZwaveChildIds;
    return selectedWifiClientIds;
}

function setProtocolChildState(protocol, nextState) {
    if (protocol === 'zigbee') {
        selectedZigbeeChildIds = nextState;
        return;
    }
    if (protocol === 'zwave') {
        selectedZwaveChildIds = nextState;
        return;
    }
    selectedWifiClientIds = nextState;
}

function buildLinkedDeviceMarkup(deviceId, removeAttrName) {
    const device = devices.find((item) => String(item.id || '') === deviceId);
    if (!device) return '';
    const name = escapeHtml(device.name || device.model || 'Unnamed Device');
    const brand = device.brand ? escapeHtml(getFriendlyOption(settings.brands, device.brand)) : '';
    const type = device.type ? escapeHtml(getFriendlyOption(settings.types, device.type, formatDeviceType)) : '';
    const meta = [brand, type].filter(Boolean).join(' • ');
    return `
        <div class="protocol-linked-device-item" data-device-id="${deviceId}">
            <div class="protocol-linked-device-meta">
                <div class="protocol-linked-device-name">${name}</div>
                ${meta ? `<div class="protocol-linked-device-details">${meta}</div>` : ''}
            </div>
            <button type="button" class="btn btn-danger btn-sm" ${removeAttrName}="${deviceId}">Unlink</button>
        </div>
    `;
}

function renderProtocolLinkedDevices(options) {
    const { protocol, listId, emptyId, getIds, removeAttrName } = options;
    const list = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    if (!list || !empty) return;

    const selectedIds = getIds();
    setProtocolChildState(protocol, new Set(selectedIds));

    if (!selectedIds.length) {
        list.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }

    empty.classList.add('is-hidden');
    list.innerHTML = selectedIds.map((deviceId) => buildLinkedDeviceMarkup(deviceId, removeAttrName)).join('');
    list.querySelectorAll(`[${removeAttrName}]`).forEach((button) => {
        button.addEventListener('click', () => {
            const targetId = String(button.getAttribute(removeAttrName) || '').trim();
            if (!targetId) return;
            const next = getProtocolChildState(protocol);
            next.delete(targetId);
            renderProtocolLinkedDevices(options);
        });
    });
}

function setupProtocolClientsManager(options) {
    const { protocol, searchInputId, resultsId, noResultsText, isChildDevice, renderSelected } = options;
    const searchInput = document.getElementById(searchInputId);
    const resultsDiv = document.getElementById(resultsId);
    if (!searchInput || !resultsDiv) return;

    renderSelected();

    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        if (!query) {
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
            return;
        }

        const selectedIds = getProtocolChildState(protocol);
        const currentDeviceId = getCurrentFormDeviceId();
        const filteredDevices = devices
            .filter((device) => String(device.id || '') !== currentDeviceId)
            .filter((device) => !selectedIds.has(String(device.id || '')))
            .filter((device) => isChildDevice(device))
            .filter((device) => {
                const name = (device.name || device.model || '').toLowerCase();
                const brand = (device.brand || '').toLowerCase();
                const type = (device.type || '').toLowerCase();
                return name.includes(query) || brand.includes(query) || type.includes(query);
            })
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .slice(0, 10);

        if (!filteredDevices.length) {
            resultsDiv.innerHTML = `<div class="port-search-result-item no-results">${noResultsText}</div>`;
            resultsDiv.classList.remove('is-hidden');
            return;
        }

        resultsDiv.innerHTML = filteredDevices.map((device) => {
            const rawName = device.name || device.model || 'Unnamed Device';
            const displayName = escapeHtml(rawName);
            const brand = device.brand ? escapeHtml(getFriendlyOption(settings.brands, device.brand)) : '';
            const type = device.type ? escapeHtml(getFriendlyOption(settings.types, device.type, formatDeviceType)) : '';
            const meta = [brand, type].filter(Boolean).join(' • ');
            return `
                <div class="port-search-result-item" data-protocol-client-id="${device.id}">
                    <div class="port-search-result-name">${displayName}</div>
                    ${meta ? `<div class="port-search-result-meta">${meta}</div>` : ''}
                </div>
            `;
        }).join('');

        resultsDiv.classList.remove('is-hidden');
        resultsDiv.querySelectorAll('[data-protocol-client-id]').forEach((item) => {
            item.addEventListener('click', () => {
                const clientId = String(item.getAttribute('data-protocol-client-id') || '').trim();
                if (!clientId) return;
                getProtocolChildState(protocol).add(clientId);
                searchInput.value = '';
                resultsDiv.innerHTML = '';
                resultsDiv.classList.add('is-hidden');
                renderSelected();
            });
        });
    });

    searchInput.addEventListener('blur', function() {
        setTimeout(() => {
            this.value = '';
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
        }, 200);
    });

    document.addEventListener('click', (event) => {
        if (!searchInput.contains(event.target) && !resultsDiv.contains(event.target)) {
            resultsDiv.classList.add('is-hidden');
        }
    });
}

function clearProtocolParentSelection(inputId, resultsId) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    if (!input) return;
    input.value = '';
    input.dataset.deviceId = '';
    input.classList.remove('port-search-valid', 'port-search-invalid');
    if (results) {
        results.classList.add('is-hidden');
        results.innerHTML = '';
    }
}

function setProtocolParentSelection(deviceId, inputId, resultsId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) {
        clearProtocolParentSelection(inputId, resultsId);
        return;
    }
    const target = devices.find((device) => String(device.id || '') === normalizedId);
    if (!target) {
        clearProtocolParentSelection(inputId, resultsId);
        return;
    }
    input.value = target.name || target.model || 'Unnamed Device';
    input.dataset.deviceId = normalizedId;
    input.classList.add('port-search-valid');
    input.classList.remove('port-search-invalid');
}

function setupProtocolParentSearch(options) {
    const { inputId, resultsId, noResultsText, isParentDevice } = options;
    const searchInput = document.getElementById(inputId);
    const resultsDiv = document.getElementById(resultsId);
    if (!searchInput || !resultsDiv) return;

    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();

        if (this.dataset.deviceId) {
            const currentDevice = devices.find((device) => device.id === this.dataset.deviceId);
            const currentName = currentDevice ? (currentDevice.name || currentDevice.model || 'Unnamed Device') : '';
            if (this.value !== currentName) {
                this.dataset.deviceId = '';
                this.classList.remove('port-search-valid');
            }
        }

        if (!query) {
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
            this.dataset.deviceId = '';
            this.classList.remove('port-search-valid', 'port-search-invalid');
            return;
        }

        const currentDeviceId = getCurrentFormDeviceId();
        const filteredDevices = devices
            .filter((device) => String(device.id || '') !== currentDeviceId)
            .filter((device) => isParentDevice(device))
            .filter((device) => {
                const name = (device.name || device.model || '').toLowerCase();
                const brand = (device.brand || '').toLowerCase();
                const type = (device.type || '').toLowerCase();
                return name.includes(query) || brand.includes(query) || type.includes(query);
            })
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .slice(0, 10);

        if (!filteredDevices.length) {
            resultsDiv.innerHTML = `<div class="port-search-result-item no-results">${noResultsText}</div>`;
            resultsDiv.classList.remove('is-hidden');
            return;
        }

        resultsDiv.innerHTML = filteredDevices
            .map((device) => {
                const rawName = device.name || device.model || 'Unnamed Device';
                const displayName = escapeHtml(rawName);
                const brand = device.brand ? escapeHtml(getFriendlyOption(settings.brands, device.brand)) : '';
                const type = device.type ? escapeHtml(getFriendlyOption(settings.types, device.type, formatDeviceType)) : '';
                const meta = [brand, type].filter(Boolean).join(' • ');
                return `
                    <div class="port-search-result-item" data-device-id="${device.id}" data-device-name="${escapeHtml(rawName)}">
                        <div class="port-search-result-name">${displayName}</div>
                        ${meta ? `<div class="port-search-result-meta">${meta}</div>` : ''}
                    </div>
                `;
            })
            .join('');

        resultsDiv.classList.remove('is-hidden');

        resultsDiv.querySelectorAll('.port-search-result-item[data-device-id]').forEach((item) => {
            item.addEventListener('click', function() {
                searchInput.value = this.dataset.deviceName;
                searchInput.dataset.deviceId = this.dataset.deviceId;
                searchInput.classList.add('port-search-valid');
                searchInput.classList.remove('port-search-invalid');
                resultsDiv.classList.add('is-hidden');
                resultsDiv.innerHTML = '';
            });
        });
    });

    searchInput.addEventListener('blur', function() {
        setTimeout(() => {
            if (this.value.trim() && !this.dataset.deviceId) {
                this.classList.add('port-search-invalid');
                return;
            }
            this.classList.remove('port-search-invalid');
        }, 200);
    });

    document.addEventListener('click', function(event) {
        if (!searchInput.contains(event.target) && !resultsDiv.contains(event.target)) {
            resultsDiv.classList.add('is-hidden');
        }
    });
}

function getSelectedZigbeeChildIds() {
    const currentDeviceId = getCurrentFormDeviceId();
    const result = [];
    selectedZigbeeChildIds.forEach((rawId) => {
        const childId = String(rawId || '').trim();
        if (!childId || childId === currentDeviceId) return;
        const targetDevice = devices.find((device) => String(device.id || '') === childId);
        if (!targetDevice || !isZigbeeConnectivity(targetDevice.connectivity)) return;
        result.push(childId);
    });
    return result;
}

function setSelectedZigbeeChildIds(ids) {
    const normalized = new Set();
    (Array.isArray(ids) ? ids : []).forEach((rawId) => {
        const childId = String(rawId || '').trim();
        if (childId) {
            normalized.add(childId);
        }
    });
    selectedZigbeeChildIds = normalized;
    renderSelectedZigbeeClients();
}

function setZigbeeChildrenFromParentDevice(parentId) {
    const normalizedParentId = String(parentId || '').trim();
    if (!normalizedParentId) {
        setSelectedZigbeeChildIds([]);
        return;
    }
    const linkedChildren = devices
        .filter((device) => String(device.id || '') !== normalizedParentId)
        .filter((device) => isZigbeeConnectivity(device.connectivity))
        .filter((device) => String(device.zigbeeParentId || '').trim() === normalizedParentId)
        .map((device) => String(device.id || '').trim())
        .filter(Boolean);
    setSelectedZigbeeChildIds(linkedChildren);
}

function updateZigbeeClientsManagerVisibility() {
    const group = document.getElementById('zigbee-linked-devices-group');
    if (!group) return;
    const shouldShow = (
        document.getElementById('device-zigbee-controller')?.checked ||
        document.getElementById('device-zigbee-repeater')?.checked
    );
    group.classList.toggle('is-hidden', !shouldShow);
    renderSelectedZigbeeClients();
}

function renderSelectedZigbeeClients() {
    renderProtocolLinkedDevices({
        protocol: 'zigbee',
        listId: 'zigbee-linked-devices-list',
        emptyId: 'zigbee-linked-devices-empty',
        getIds: getSelectedZigbeeChildIds,
        removeAttrName: 'data-zigbee-client-remove'
    });
}

function setupZigbeeClientsManager() {
    setupProtocolClientsManager({
        protocol: 'zigbee',
        searchInputId: 'device-zigbee-client-search',
        resultsId: 'device-zigbee-client-results',
        noResultsText: 'No Zigbee devices found',
        isChildDevice: (device) => isZigbeeConnectivity(device.connectivity),
        renderSelected: renderSelectedZigbeeClients
    });
}

function clearZigbeeParentSelection() {
    clearProtocolParentSelection('device-zigbee-parent', 'device-zigbee-parent-results');
}

function setZigbeeParentSelection(deviceId) {
    setProtocolParentSelection(deviceId, 'device-zigbee-parent', 'device-zigbee-parent-results');
}

function setupZigbeeParentSearch() {
    setupProtocolParentSearch({
        inputId: 'device-zigbee-parent',
        resultsId: 'device-zigbee-parent-results',
        noResultsText: 'No Zigbee routers or coordinators found',
        isParentDevice: isZigbeeParentDevice
    });
}

function getSelectedZwaveChildIds() {
    const currentDeviceId = getCurrentFormDeviceId();
    const result = [];
    selectedZwaveChildIds.forEach((rawId) => {
        const childId = String(rawId || '').trim();
        if (!childId || childId === currentDeviceId) return;
        const targetDevice = devices.find((device) => String(device.id || '') === childId);
        if (!targetDevice || !isZwaveConnectivity(targetDevice.connectivity)) return;
        result.push(childId);
    });
    return result;
}

function setSelectedZwaveChildIds(ids) {
    const normalized = new Set();
    (Array.isArray(ids) ? ids : []).forEach((rawId) => {
        const childId = String(rawId || '').trim();
        if (childId) {
            normalized.add(childId);
        }
    });
    selectedZwaveChildIds = normalized;
    renderSelectedZwaveClients();
}

function setZwaveChildrenFromControllerDevice(controllerId) {
    const normalizedControllerId = String(controllerId || '').trim();
    if (!normalizedControllerId) {
        setSelectedZwaveChildIds([]);
        return;
    }
    const linkedChildren = devices
        .filter((device) => String(device.id || '') !== normalizedControllerId)
        .filter((device) => isZwaveConnectivity(device.connectivity))
        .filter((device) => String(device.zwaveControllerId || '').trim() === normalizedControllerId)
        .map((device) => String(device.id || '').trim())
        .filter(Boolean);
    setSelectedZwaveChildIds(linkedChildren);
}

function updateZwaveClientsManagerVisibility() {
    const group = document.getElementById('zwave-linked-devices-group');
    if (!group) return;
    const shouldShow = Boolean(document.getElementById('device-zwave-controller')?.checked);
    group.classList.toggle('is-hidden', !shouldShow);
    renderSelectedZwaveClients();
}

function renderSelectedZwaveClients() {
    renderProtocolLinkedDevices({
        protocol: 'zwave',
        listId: 'zwave-linked-devices-list',
        emptyId: 'zwave-linked-devices-empty',
        getIds: getSelectedZwaveChildIds,
        removeAttrName: 'data-zwave-client-remove'
    });
}

function setupZwaveClientsManager() {
    setupProtocolClientsManager({
        protocol: 'zwave',
        searchInputId: 'device-zwave-client-search',
        resultsId: 'device-zwave-client-results',
        noResultsText: 'No Z-Wave devices found',
        isChildDevice: (device) => isZwaveConnectivity(device.connectivity),
        renderSelected: renderSelectedZwaveClients
    });
}

function clearZwaveCoordinatorSelection() {
    clearProtocolParentSelection('device-zwave-coordinator', 'device-zwave-coordinator-results');
}

function setZwaveCoordinatorSelection(deviceId) {
    setProtocolParentSelection(deviceId, 'device-zwave-coordinator', 'device-zwave-coordinator-results');
}

function setupZwaveCoordinatorSearch() {
    setupProtocolParentSearch({
        inputId: 'device-zwave-coordinator',
        resultsId: 'device-zwave-coordinator-results',
        noResultsText: 'No Z-Wave coordinators found',
        isParentDevice: isZwaveParentDevice
    });
}

// Port Management
let portCounter = 0;
const ETHERNET_CABLE_OPTIONS = [
    {
        value: 'cat1',
        text: 'Cat1'
    },
    {
        value: 'cat2',
        text: 'Cat2'
    },
    {
        value: 'cat3',
        text: 'Cat3'
    },
    {
        value: 'cat4',
        text: 'Cat4'
    },
    {
        value: 'cat5',
        text: 'Cat5'
    },
    {
        value: 'cat5e',
        text: 'Cat5e'
    },
    {
        value: 'cat6',
        text: 'Cat6'
    },
    {
        value: 'cat6a',
        text: 'Cat6a'
    },
    {
        value: 'cat7',
        text: 'Cat7'
    },
    {
        value: 'cat8',
        text: 'Cat8'
    }
];
const ETHERNET_SPEED_OPTIONS = [
    {
        value: '10Mbps',
        text: '10Mbps'
    },
    {
        value: '100Mbps',
        text: '100Mbps'
    },
    {
        value: '1Gbps',
        text: '1Gbps'
    },
    {
        value: '2.5Gbps',
        text: '2.5Gbps'
    },
    {
        value: '5Gbps',
        text: '5Gbps'
    },
    {
        value: '10Gbps',
        text: '10Gbps'
    },
    {
        value: '25Gbps',
        text: '25Gbps'
    },
    {
        value: '40Gbps',
        text: '40Gbps'
    }
];

function parsePortType(portType) {
    if (!portType || typeof portType !== 'string') {
        return { kind: 'ethernet', direction: 'input' };
    }
    const parts = portType.split('-');
    return {
        kind: parts[0] || 'ethernet',
        direction: parts[1] || 'input'
    };
}

function buildPortType(kind, direction) {
    return `${kind}-${direction}`;
}

function normalizePortKind(kind, isPower) {
    if (isPower) return 'power';
    if (kind === 'usb' || kind === 'ethernet') return kind;
    return 'ethernet';
}

function normalizePortDirection(direction) {
    return direction === 'output' ? 'output' : 'input';
}

function getPortLabel(portType) {
    const labels = {
        'ethernet-input': 'Ethernet Input',
        'ethernet-output': 'Ethernet Output',
        'usb-input': 'USB Input',
        'usb-output': 'USB Output',
        'power-input': 'Power Input',
        'power-output': 'Power Output'
    };
    return labels[portType] || portType;
}

function addPort(portType, connectedTo = '', containerId = 'ports-container', cableType = '', speed = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const portId = `port-${Date.now()}-${portCounter++}`;
    const isPowerContainer = containerId === 'power-ports-container';
    const parsed = parsePortType(portType);
    const portKind = normalizePortKind(parsed.kind, isPowerContainer);
    const portDirection = normalizePortDirection(parsed.direction);
    
    const portEl = document.createElement('div');
    portEl.className = 'port-item';
    portEl.dataset.portId = portId;
    portEl.dataset.portKind = portKind;
    portEl.dataset.portDirection = portDirection;
    portEl.dataset.portType = buildPortType(portKind, portDirection);
    
    const portLabel = getPortLabel(portEl.dataset.portType);
    
    // Get connected device name if exists
    let connectedDeviceName = '';
    if (connectedTo) {
        const connectedDevice = devices.find(d => d.id === connectedTo);
        if (connectedDevice) {
            connectedDeviceName = connectedDevice.name || connectedDevice.model || 'Unnamed Device';
        }
    }
    
    const isEthernetPort = portKind === 'ethernet';
    const cableTypeMarkup = `
        <div class="port-field">
            <label for="${portId}-cable-type">Cable type</label>
            <select id="${portId}-cable-type" class="port-select"${isEthernetPort ? '' : ' disabled'}>
                <option value="">Select cable type</option>
                ${ETHERNET_CABLE_OPTIONS.map(option => `
                    <option value="${option.value}"${option.value === cableType ? ' selected' : ''}>
                        ${escapeHtml(option.text)}
                    </option>
                `).join('')}
            </select>
        </div>
    `;
    const speedMarkup = `
        <div class="port-field">
            <label for="${portId}-speed">Speed</label>
            <select id="${portId}-speed" class="port-select"${isEthernetPort ? '' : ' disabled'}>
                <option value="">Select speed</option>
                ${ETHERNET_SPEED_OPTIONS.map(option => `
                    <option value="${option.value}"${option.value === speed ? ' selected' : ''}>
                        ${escapeHtml(option.text)}
                    </option>
                `).join('')}
            </select>
        </div>
    `;
    const directionSelectMarkup = `
        <div class="port-field">
            <label for="${portId}-direction">Direction</label>
            <select id="${portId}-direction" class="port-select port-direction-select">
                <option value="input"${portDirection === 'input' ? ' selected' : ''}>Input</option>
                <option value="output"${portDirection === 'output' ? ' selected' : ''}>Output</option>
            </select>
        </div>
    `;
    const typeSelectMarkup = isPowerContainer ? '' : `
        <div class="port-field">
            <label for="${portId}-type">Type</label>
            <select id="${portId}-type" class="port-select port-type-select">
                <option value="ethernet"${portKind === 'ethernet' ? ' selected' : ''}>Ethernet</option>
                <option value="usb"${portKind === 'usb' ? ' selected' : ''}>USB</option>
            </select>
        </div>
    `;
    const showExtraRow = Boolean(typeSelectMarkup) || isEthernetPort;

    portEl.innerHTML = `
        <div class="port-header">
            <span class="port-label">${escapeHtml(portLabel)}</span>
            <button type="button" class="btn btn-danger btn-sm btn-icon port-remove-btn" onclick="removePort('${portId}')" aria-label="Remove port" title="Remove port">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18"></path>
                    <path d="M8 6V4h8v2"></path>
                    <path d="M6 6l1 14h10l1-14"></path>
                    <path d="M10 11v6"></path>
                    <path d="M14 11v6"></path>
                </svg>
            </button>
        </div>
        <div class="port-body">
            <div class="port-main-row">
                ${directionSelectMarkup}
                <div class="port-search-wrapper">
                    <label for="${portId}-search">Connected to</label>
                    <input 
                        type="text" 
                        id="${portId}-search" 
                        class="port-device-search" 
                        placeholder="Search device..."
                        autocomplete="off"
                        value="${escapeHtml(connectedDeviceName)}"
                        data-device-id="${connectedTo}"
                    />
                    <div id="${portId}-results" class="port-search-results is-hidden"></div>
                </div>
            </div>
            <div class="port-extra-row${showExtraRow ? '' : ' is-hidden'}">
                ${typeSelectMarkup}
                <div class="port-ethernet-fields${isEthernetPort ? '' : ' is-hidden'}" data-ethernet-fields>
                    ${cableTypeMarkup}
                    ${speedMarkup}
                </div>
            </div>
        </div>
    `;
    
    container.appendChild(portEl);

    const typeSelect = document.getElementById(`${portId}-type`);
    const directionSelect = document.getElementById(`${portId}-direction`);
    const labelEl = portEl.querySelector('.port-label');
    const ethernetFields = portEl.querySelector('[data-ethernet-fields]');
    const extraRow = portEl.querySelector('.port-extra-row');
    const cableSelect = document.getElementById(`${portId}-cable-type`);
    const speedSelect = document.getElementById(`${portId}-speed`);

    const updatePortType = () => {
        const kind = typeSelect ? typeSelect.value : portEl.dataset.portKind;
        const direction = directionSelect ? directionSelect.value : portEl.dataset.portDirection;
        portEl.dataset.portKind = kind;
        portEl.dataset.portDirection = direction;
        const newPortType = buildPortType(kind, direction);
        portEl.dataset.portType = newPortType;
        if (labelEl) {
            labelEl.textContent = getPortLabel(newPortType);
        }
        const isEthernet = kind === 'ethernet';
        if (ethernetFields) {
            ethernetFields.classList.toggle('is-hidden', !isEthernet);
        }
        if (extraRow) {
            const showExtra = Boolean(typeSelect) || isEthernet;
            extraRow.classList.toggle('is-hidden', !showExtra);
        }
        if (cableSelect) {
            cableSelect.disabled = !isEthernet;
        }
        if (speedSelect) {
            speedSelect.disabled = !isEthernet;
        }
    };

    if (typeSelect) {
        typeSelect.addEventListener('change', updatePortType);
    }
    if (directionSelect) {
        directionSelect.addEventListener('change', updatePortType);
    }
    updatePortType();
    
    // Setup search functionality
    setupPortSearch(portId);
}

function setupPortSearch(portId) {
    const searchInput = document.getElementById(`${portId}-search`);
    const resultsDiv = document.getElementById(`${portId}-results`);
    
    if (!searchInput || !resultsDiv) return;
    
    // Search on input
    searchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        
        // Clear device ID if user is typing (not a valid selection)
        if (this.dataset.deviceId) {
            const currentDeviceId = this.dataset.deviceId;
            const currentDevice = devices.find(d => d.id === currentDeviceId);
            const currentDeviceName = currentDevice ? (currentDevice.name || currentDevice.model || 'Unnamed Device') : '';
            
            // If the current value doesn't match the selected device name, clear the selection
            if (this.value !== currentDeviceName) {
                this.dataset.deviceId = '';
                this.classList.remove('port-search-valid');
            }
        }
        
        if (!query) {
            resultsDiv.classList.add('is-hidden');
            resultsDiv.innerHTML = '';
            this.dataset.deviceId = '';
            this.classList.remove('port-search-valid');
            return;
        }
        
        // Filter devices (excluding current device)
        const currentDeviceId = editingDeviceId;
        const filteredDevices = devices
            .filter(d => d.id !== currentDeviceId)
            .filter(d => {
                const name = (d.name || d.model || '').toLowerCase();
                const brand = (d.brand || '').toLowerCase();
                const type = (d.type || '').toLowerCase();
                return name.includes(query) || brand.includes(query) || type.includes(query);
            })
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .slice(0, 10); // Limit to 10 results
        
        if (filteredDevices.length === 0) {
            resultsDiv.innerHTML = '<div class="port-search-result-item no-results">No devices found</div>';
            resultsDiv.classList.remove('is-hidden');
            return;
        }
        
        resultsDiv.innerHTML = filteredDevices
            .map(d => {
                const name = escapeHtml(d.name || d.model || 'Unnamed Device');
                const brand = d.brand ? escapeHtml(getFriendlyOption(settings.brands, d.brand)) : '';
                const type = d.type ? escapeHtml(getFriendlyOption(settings.types, d.type, formatDeviceType)) : '';
                const meta = [brand, type].filter(Boolean).join(' • ');
                
                return `
                    <div class="port-search-result-item" data-device-id="${d.id}" data-device-name="${escapeHtml(name)}">
                        <div class="port-search-result-name">${name}</div>
                        ${meta ? `<div class="port-search-result-meta">${meta}</div>` : ''}
                    </div>
                `;
            })
            .join('');
        
        resultsDiv.classList.remove('is-hidden');
        
        // Add click handlers to results
        resultsDiv.querySelectorAll('.port-search-result-item[data-device-id]').forEach(item => {
            item.addEventListener('click', function() {
                const deviceId = this.dataset.deviceId;
                const deviceName = this.dataset.deviceName;
                
                searchInput.value = deviceName;
                searchInput.dataset.deviceId = deviceId;
                searchInput.classList.add('port-search-valid');
                resultsDiv.classList.add('is-hidden');
                resultsDiv.innerHTML = '';
            });
        });
    });
    
    // Validate on blur
    searchInput.addEventListener('blur', function() {
        setTimeout(() => {
            // If there's text but no valid device selected, clear the field
            if (this.value.trim() && !this.dataset.deviceId) {
                this.value = '';
                this.classList.remove('port-search-valid');
            }
        }, 200); // Small delay to allow clicking on results
    });
    
    // Close results when clicking outside
    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.classList.add('is-hidden');
        }
    });
    
    // Show results on focus if there's a query
    searchInput.addEventListener('focus', function() {
        if (this.value.trim()) {
            // Trigger input event to show results
            this.dispatchEvent(new Event('input'));
        }
    });
}

function removePort(portId) {
    const portEl = document.querySelector(`[data-port-id="${portId}"]`);
    if (portEl) {
        portEl.remove();
    }
}

function getPortsData() {
    const ports = [];
    
    // Get ports from both containers
    const containers = ['ports-container', 'power-ports-container'];
    
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const portEls = container.querySelectorAll('.port-item');
        portEls.forEach(portEl => {
            const portId = portEl.dataset.portId;
            const searchInput = document.getElementById(`${portId}-search`);
            const connectedTo = searchInput ? searchInput.dataset.deviceId : '';
            const cableSelect = document.getElementById(`${portId}-cable-type`);
            const speedSelect = document.getElementById(`${portId}-speed`);
            const typeSelect = document.getElementById(`${portId}-type`);
            const directionSelect = document.getElementById(`${portId}-direction`);
            const portKind = typeSelect ? typeSelect.value : (portEl.dataset.portKind || 'power');
            const portDirection = directionSelect ? directionSelect.value : (portEl.dataset.portDirection || 'input');
            const portType = buildPortType(portKind, portDirection);
            
            if (connectedTo) {
                const portData = {
                    type: portType,
                    connectedTo: connectedTo
                };
                if (portKind === 'ethernet' && cableSelect) {
                    portData.cableType = cableSelect.value;
                }
                if (portKind === 'ethernet' && speedSelect) {
                    portData.speed = speedSelect.value;
                }
                ports.push(portData);
            }
        });
    });
    
    return ports;
}

function loadPorts(ports) {
    if (!ports || !Array.isArray(ports)) return;
    
    ports.forEach(port => {
        // Determine which container to use based on port type
        const containerId = (port.type === 'power-input' || port.type === 'power-output') 
            ? 'power-ports-container' 
            : 'ports-container';
        
        addPort(port.type, port.connectedTo, containerId, port.cableType || '', port.speed || '');
    });
}

// Get opposite port type
function getOppositePortType(portType) {
    const opposites = {
        'ethernet-input': 'ethernet-output',
        'ethernet-output': 'ethernet-input',
        'usb-input': 'usb-output',
        'usb-output': 'usb-input',
        'power-input': 'power-output',
        'power-output': 'power-input'
    };
    return opposites[portType];
}

// Sync ports bidirectionally
async function syncDevicePorts(currentDeviceId, currentDevicePorts) {
    // Reload all devices to get the latest data
    const allData = await loadData();
    const allDevices = allData.devices;
    
    // Track which devices are connected in the current device's ports
    const connectedDeviceIds = new Set();
    currentDevicePorts.forEach(port => {
        if (port.connectedTo) {
            connectedDeviceIds.add(port.connectedTo);
        }
    });
    
    // Update each connected device
    connectedDeviceIds.forEach(targetDeviceId => {
        const targetDevice = allDevices.find(d => d.id === targetDeviceId);
        if (!targetDevice) return;
        
        // Get current device's ports that connect to this target device
        const portsToTarget = currentDevicePorts.filter(p => p.connectedTo === targetDeviceId);
        
        // Initialize target device ports if not exists
        if (!targetDevice.ports) {
            targetDevice.ports = [];
        }
        
        // Remove old connections from target device to current device
        targetDevice.ports = targetDevice.ports.filter(p => p.connectedTo !== currentDeviceId);
        
        // Add reverse connections
        portsToTarget.forEach(port => {
            const oppositeType = getOppositePortType(port.type);
            if (oppositeType) {
                const reversePort = {
                    type: oppositeType,
                    connectedTo: currentDeviceId
                };
                if (oppositeType.startsWith('ethernet')) {
                    if (port.cableType) {
                        reversePort.cableType = port.cableType;
                    }
                    if (port.speed) {
                        reversePort.speed = port.speed;
                    }
                }
                targetDevice.ports.push(reversePort);
            }
        });
    });
    
    // Clean up ports from devices that are no longer connected
    allDevices.forEach(device => {
        if (device.id === currentDeviceId) return;
        if (!device.ports) return;
        
        // If this device has ports connecting to current device, but current device doesn't connect back, remove them
        if (!connectedDeviceIds.has(device.id)) {
            device.ports = device.ports.filter(p => p.connectedTo !== currentDeviceId);
        }
    });
    
    // Save updated devices
    allData.devices = allDevices;
    await saveData(allData);
    
    // Update local devices array
    devices = allDevices;
}

async function syncWifiClientsForAccessPoint(currentDeviceId, linkedClientIds) {
    const normalizedCurrentDeviceId = String(currentDeviceId || '').trim();
    if (!normalizedCurrentDeviceId) return;

    const allData = await loadData();
    const storedDevices = Array.isArray(allData.devices) ? allData.devices : [];
    const currentDevice = storedDevices.find((device) => String(device.id || '') === normalizedCurrentDeviceId);
    const currentDeviceIsAccessPoint = Boolean(currentDevice && isRouterOrAccessPointType(currentDevice.type));
    const desiredLinkedClients = new Set(
        (Array.isArray(linkedClientIds) ? linkedClientIds : [])
            .map((id) => String(id || '').trim())
            .filter((id) => id && id !== normalizedCurrentDeviceId)
    );

    storedDevices.forEach((device) => {
        const deviceId = String(device.id || '').trim();
        if (!deviceId || deviceId === normalizedCurrentDeviceId) return;

        const linkedToCurrentDevice = String(device.wifiAccessPointId || '').trim() === normalizedCurrentDeviceId;
        if (!currentDeviceIsAccessPoint) {
            if (linkedToCurrentDevice) {
                device.wifiAccessPointId = '';
            }
            return;
        }

        const isWifiClient = isStrictWifiConnectivity(device.connectivity);
        if (desiredLinkedClients.has(deviceId) && isWifiClient) {
            device.wifiAccessPointId = normalizedCurrentDeviceId;
            return;
        }
        if (linkedToCurrentDevice) {
            device.wifiAccessPointId = '';
        }
    });

    allData.devices = storedDevices;
    await saveData(allData);
    allDevices = storedDevices;
    devices = storedDevices;
}

async function syncZigbeeChildrenForParent(currentDeviceId, linkedChildIds) {
    const normalizedCurrentDeviceId = String(currentDeviceId || '').trim();
    if (!normalizedCurrentDeviceId) return;

    const allData = await loadData();
    const storedDevices = Array.isArray(allData.devices) ? allData.devices : [];
    const currentDevice = storedDevices.find((device) => String(device.id || '') === normalizedCurrentDeviceId);
    const currentDeviceIsParent = Boolean(currentDevice && isZigbeeParentDevice(currentDevice));
    const desiredLinkedChildren = new Set(
        (Array.isArray(linkedChildIds) ? linkedChildIds : [])
            .map((id) => String(id || '').trim())
            .filter((id) => id && id !== normalizedCurrentDeviceId)
    );

    storedDevices.forEach((device) => {
        const deviceId = String(device.id || '').trim();
        if (!deviceId || deviceId === normalizedCurrentDeviceId) return;

        const linkedToCurrentDevice = String(device.zigbeeParentId || '').trim() === normalizedCurrentDeviceId;
        if (!currentDeviceIsParent) {
            if (linkedToCurrentDevice) {
                device.zigbeeParentId = '';
            }
            return;
        }

        const isZigbeeChild = isZigbeeConnectivity(device.connectivity);
        if (desiredLinkedChildren.has(deviceId) && isZigbeeChild) {
            device.zigbeeParentId = normalizedCurrentDeviceId;
            return;
        }
        if (linkedToCurrentDevice) {
            device.zigbeeParentId = '';
        }
    });

    allData.devices = storedDevices;
    await saveData(allData);
    allDevices = storedDevices;
    devices = storedDevices;
}

async function syncZwaveChildrenForController(currentDeviceId, linkedChildIds) {
    const normalizedCurrentDeviceId = String(currentDeviceId || '').trim();
    if (!normalizedCurrentDeviceId) return;

    const allData = await loadData();
    const storedDevices = Array.isArray(allData.devices) ? allData.devices : [];
    const currentDevice = storedDevices.find((device) => String(device.id || '') === normalizedCurrentDeviceId);
    const currentDeviceIsController = Boolean(currentDevice && isZwaveParentDevice(currentDevice));
    const desiredLinkedChildren = new Set(
        (Array.isArray(linkedChildIds) ? linkedChildIds : [])
            .map((id) => String(id || '').trim())
            .filter((id) => id && id !== normalizedCurrentDeviceId)
    );

    storedDevices.forEach((device) => {
        const deviceId = String(device.id || '').trim();
        if (!deviceId || deviceId === normalizedCurrentDeviceId) return;

        const linkedToCurrentDevice = String(device.zwaveControllerId || '').trim() === normalizedCurrentDeviceId;
        if (!currentDeviceIsController) {
            if (linkedToCurrentDevice) {
                device.zwaveControllerId = '';
            }
            return;
        }

        const isZwaveChild = isZwaveConnectivity(device.connectivity);
        if (desiredLinkedChildren.has(deviceId) && isZwaveChild) {
            device.zwaveControllerId = normalizedCurrentDeviceId;
            return;
        }
        if (linkedToCurrentDevice) {
            device.zwaveControllerId = '';
        }
    });

    allData.devices = storedDevices;
    await saveData(allData);
    allDevices = storedDevices;
    devices = storedDevices;
}

// Make removePort available globally
window.removePort = removePort;

// CRUD Operations
async function createDevice(deviceData) {
    // Validate unique name
    const name = deviceData.name.trim();
    if (!name) {
        showAlert('Device name is required.');
        return;
    }
    
    if (allDevices.some(d => d.name && d.name.toLowerCase() === name.toLowerCase())) {
        showAlert('A device with this name already exists. Please choose a different name.');
        return;
    }
    
    let nextDeviceId = String(activeDeviceId || '').trim() || generateDeviceId();
    if (allDevices.some(device => String(device.id || '') === nextDeviceId)) {
        nextDeviceId = generateDeviceId();
    }
    activeDeviceId = nextDeviceId;

    const device = {
        id: nextDeviceId,
        name: name,
        brand: normalizeOptionValue(deviceData.brand),
        model: deviceData.model.trim(),
        type: normalizeOptionValue(deviceData.type),
        labels: normalizeLabelList(deviceData.labels),
        ip: deviceData.ip.trim() || '',
        mac: deviceData.mac.trim() || '',
        status: deviceData.status,
        power: deviceData.power,
        batteryType: normalizeOptionValue(deviceData.batteryType),
        batteryCount: deviceData.batteryCount ? parseInt(deviceData.batteryCount) : null,
        lastBatteryChange: deviceData.lastBatteryChange || '',
        batteryDuration: deviceData.batteryDuration ? parseFloat(deviceData.batteryDuration) : null,
        upsProtected: deviceData.upsProtected || false,
        idleConsumption: Number.isFinite(deviceData.idleConsumption) ? deviceData.idleConsumption : null,
        meanConsumption: Number.isFinite(deviceData.meanConsumption) ? deviceData.meanConsumption : null,
        maxConsumption: Number.isFinite(deviceData.maxConsumption) ? deviceData.maxConsumption : null,
        installationDate: deviceData.installationDate || '',
        serialNumber: deviceData.serialNumber ? deviceData.serialNumber.trim() : '',
        purchaseDate: deviceData.purchaseDate || '',
        purchaseStore: deviceData.purchaseStore ? deviceData.purchaseStore.trim() : '',
        purchasePrice: Number.isFinite(deviceData.purchasePrice) ? deviceData.purchasePrice : null,
        purchaseCurrency: deviceData.purchaseCurrency || '',
        warrantyExpiration: deviceData.warrantyExpiration || '',
        storageSize: deviceData.storageSize ? parseFloat(deviceData.storageSize) : null,
        storageUnit: deviceData.storageUnit || '',
        notes: deviceData.notes ? deviceData.notes.trim() : '',
        links: normalizeDeviceLinks(deviceData.links),
        connectivity: normalizeOptionValue(deviceData.connectivity),
        networkId: deviceData.networkId || '',
        wifiDownloadSpeed: Number.isFinite(deviceData.wifiDownloadSpeed) ? deviceData.wifiDownloadSpeed : null,
        wifiUploadSpeed: Number.isFinite(deviceData.wifiUploadSpeed) ? deviceData.wifiUploadSpeed : null,
        wifiBand: normalizeWifiBand(deviceData.wifiBand),
        wifiAccessPointId: deviceData.wifiAccessPointId || '',
        zigbeeParentId: deviceData.zigbeeParentId || '',
        zwaveControllerId: deviceData.zwaveControllerId || '',
        area: deviceData.area,
        controlledArea: deviceData.controlledArea || '',
        threadBorderRouter: deviceData.threadBorderRouter || false,
        matterHub: deviceData.matterHub || false,
        zigbeeController: deviceData.zigbeeController || false,
        zigbeeRepeater: deviceData.zigbeeRepeater || false,
        zwaveController: deviceData.zwaveController || false,
        homeAssistant: false,
        googleHome: deviceData.googleHome || false,
        alexa: deviceData.alexa || false,
        appleHomeKit: deviceData.appleHomeKit || false,
        samsungSmartThings: deviceData.samsungSmartThings || false,
        localOnly: deviceData.localOnly || false,
        ports: deviceData.ports || [],
        files: normalizeDeviceFiles(deviceData.files),
        deviceImage: null,
        createdAt: new Date().toISOString()
    };

    allDevices.push(device);
    devices = allDevices;
    await saveData({
        ...(await loadData()),
        devices: allDevices
    });

    // Upload pending device photo (add mode: ID wasn't available until now)
    if (pendingDeviceImageFile) {
        const imageRef = await uploadDeviceImageFile(pendingDeviceImageFile);
        if (imageRef) {
            device.deviceImage = imageRef;
            await saveData({ ...(await loadData()), devices: allDevices });
        }
        pendingDeviceImageFile = null;
    }

    // Sync ports bidirectionally
    await syncDevicePorts(device.id, device.ports);
    await syncWifiClientsForAccessPoint(device.id, deviceData.wifiLinkedDeviceIds || []);
    await syncZigbeeChildrenForParent(device.id, deviceData.zigbeeLinkedDeviceIds || []);
    await syncZwaveChildrenForController(device.id, deviceData.zwaveLinkedDeviceIds || []);

    window.location.href = 'devices.html';
}

async function updateDevice(id, deviceData, options = {}) {
    // Validate unique name
    const name = deviceData.name.trim();
    if (!name) {
        showAlert('Device name is required.');
        return;
    }
    
    if (allDevices.some(d => d.name && d.name.toLowerCase() === name.toLowerCase() && d.id !== id)) {
        showAlert('A device with this name already exists. Please choose a different name.');
        return;
    }
    
    const device = allDevices.find(d => d.id === id);
    if (device) {
        const previousName = String(device.name || '').trim();
        const previousArea = String(device.area || '').trim();
        const previousControlledArea = String(device.controlledArea || '').trim();
        const previousLabels = normalizeLabelList(device.labels);
        device.name = name;
        device.brand = normalizeOptionValue(deviceData.brand);
        device.model = deviceData.model.trim();
        device.type = normalizeOptionValue(deviceData.type);
        device.labels = normalizeLabelList(deviceData.labels);
        device.ip = deviceData.ip.trim() || '';
        device.mac = deviceData.mac.trim() || '';
        device.status = deviceData.status;
        device.power = deviceData.power;
        device.batteryType = normalizeOptionValue(deviceData.batteryType);
        device.batteryCount = deviceData.batteryCount ? parseInt(deviceData.batteryCount) : null;
        device.lastBatteryChange = deviceData.lastBatteryChange || '';
        device.batteryDuration = deviceData.batteryDuration ? parseFloat(deviceData.batteryDuration) : null;
        device.upsProtected = deviceData.upsProtected || false;
        device.idleConsumption = Number.isFinite(deviceData.idleConsumption) ? deviceData.idleConsumption : null;
        device.meanConsumption = Number.isFinite(deviceData.meanConsumption) ? deviceData.meanConsumption : null;
        device.maxConsumption = Number.isFinite(deviceData.maxConsumption) ? deviceData.maxConsumption : null;
        device.installationDate = deviceData.installationDate || '';
        device.serialNumber = deviceData.serialNumber ? deviceData.serialNumber.trim() : '';
        device.purchaseDate = deviceData.purchaseDate || '';
        device.purchaseStore = deviceData.purchaseStore ? deviceData.purchaseStore.trim() : '';
        device.purchasePrice = Number.isFinite(deviceData.purchasePrice) ? deviceData.purchasePrice : null;
        device.purchaseCurrency = deviceData.purchaseCurrency || '';
        device.warrantyExpiration = deviceData.warrantyExpiration || '';
        device.storageSize = deviceData.storageSize ? parseFloat(deviceData.storageSize) : null;
        device.storageUnit = deviceData.storageUnit || '';
        device.notes = deviceData.notes ? deviceData.notes.trim() : '';
        device.links = normalizeDeviceLinks(deviceData.links);
        device.connectivity = normalizeOptionValue(deviceData.connectivity);
        device.networkId = deviceData.networkId || '';
        device.wifiDownloadSpeed = Number.isFinite(deviceData.wifiDownloadSpeed) ? deviceData.wifiDownloadSpeed : null;
        device.wifiUploadSpeed = Number.isFinite(deviceData.wifiUploadSpeed) ? deviceData.wifiUploadSpeed : null;
        device.wifiBand = normalizeWifiBand(deviceData.wifiBand);
        device.wifiAccessPointId = deviceData.wifiAccessPointId || '';
        device.zigbeeParentId = deviceData.zigbeeParentId || '';
        device.zwaveControllerId = deviceData.zwaveControllerId || '';
        device.area = deviceData.area;
        device.controlledArea = deviceData.controlledArea || '';
        device.threadBorderRouter = deviceData.threadBorderRouter || false;
        device.matterHub = deviceData.matterHub || false;
        device.zigbeeController = deviceData.zigbeeController || false;
        device.zigbeeRepeater = deviceData.zigbeeRepeater || false;
        device.zwaveController = deviceData.zwaveController || false;
        device.googleHome = deviceData.googleHome || false;
        device.alexa = deviceData.alexa || false;
        device.appleHomeKit = deviceData.appleHomeKit || false;
        device.samsungSmartThings = deviceData.samsungSmartThings || false;
        device.localOnly = deviceData.localOnly || false;
        device.ports = deviceData.ports || [];
        device.files = normalizeDeviceFiles(deviceData.files);
        device.deviceImage = currentDeviceImage || null;
        delete device.website;
        device.updatedAt = new Date().toISOString();
        
        await saveData({
            ...(await loadData()),
            devices: allDevices
        });
        
        // Sync ports bidirectionally
        await syncDevicePorts(device.id, device.ports);
        await syncWifiClientsForAccessPoint(device.id, deviceData.wifiLinkedDeviceIds || []);
        await syncZigbeeChildrenForParent(device.id, deviceData.zigbeeLinkedDeviceIds || []);
        await syncZwaveChildrenForController(device.id, deviceData.zwaveLinkedDeviceIds || []);
        if (isHomeAssistantLinked(device.homeAssistant)) {
            const currentName = String(device.name || '').trim();
            const shouldSyncName = previousName !== currentName;
            const areaSyncTarget = getHaAreaSyncTarget();
            const previousTargetArea = areaSyncTarget === 'installed' ? previousArea : previousControlledArea;
            const nextTargetArea = areaSyncTarget === 'installed'
                ? String(device.area || '').trim()
                : String(device.controlledArea || '').trim();
            const shouldSyncArea = previousTargetArea !== nextTargetArea;
            const shouldSyncLabels = !labelsEqual(previousLabels, device.labels);

            try {
                if (shouldSyncName) {
                    await syncDeviceNameToHa(device.id, device.name);
                }
            } catch (error) {
                console.error('Failed to sync device name to Home Assistant:', error);
                await showAlert(`Device was saved locally, but Home Assistant name update failed: ${error?.message || error}`, {
                    title: 'Home Assistant Sync Failed'
                });
                return;
            }
            try {
                if (shouldSyncArea) {
                    await syncDeviceAreaToHa(device.id, nextTargetArea);
                }
            } catch (error) {
                console.error('Failed to sync device area to Home Assistant:', error);
                await showAlert(`Device was saved locally, but Home Assistant area update failed: ${error?.message || error}`, {
                    title: 'Home Assistant Sync Failed'
                });
                return;
            }
            try {
                if (shouldSyncLabels) {
                    await syncDeviceLabelsToHa(device.id, device.labels);
                }
            } catch (error) {
                console.error('Failed to sync device labels to Home Assistant:', error);
                await showAlert(`Device was saved locally, but Home Assistant label update failed: ${error?.message || error}`, {
                    title: 'Home Assistant Sync Failed'
                });
                return;
            }
        }
        devices = allDevices;
        
        if (options.stayOnPage) {
            showFormMessage('Device saved successfully.', 'success');
            return;
        }

        if (!options.stayOnPage) {
            window.location.href = 'devices.html';
        }
    }
}

async function handleDeleteDevice() {
    if (!editingDeviceId) return;
    const confirmed = await showConfirm('Are you sure you want to delete this device?', {
        title: 'Delete device',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }

    try {
        await addDeviceToExcludedListIfInHa(editingDeviceId);
    } catch (error) {
        console.error('Failed to add device to excluded_devices:', error);
    }

    const deviceToDelete = allDevices.find((device) => device.id === editingDeviceId);
    if (deviceToDelete) {
        await deleteAllDeviceFiles(deviceToDelete.files);
    }

    allDevices = allDevices.filter(device => device.id !== editingDeviceId);
    allDevices.forEach(device => {
        if (device.ports && Array.isArray(device.ports)) {
            device.ports = device.ports.filter(port => port.connectedTo !== editingDeviceId);
        }
        if (String(device.wifiAccessPointId || '').trim() === String(editingDeviceId || '').trim()) {
            device.wifiAccessPointId = '';
        }
        if (String(device.zigbeeParentId || '').trim() === String(editingDeviceId || '').trim()) {
            device.zigbeeParentId = '';
        }
        if (String(device.zwaveControllerId || '').trim() === String(editingDeviceId || '').trim()) {
            device.zwaveControllerId = '';
        }
    });

    await saveData({
        ...(await loadData()),
        devices: allDevices
    });

    window.location.href = 'devices.html';
}
