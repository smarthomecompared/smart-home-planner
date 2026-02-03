// Common JavaScript for Smart Home Manager

// Data Storage Keys
const STORAGE_KEYS = {
    DEVICES: 'smartHomeDevices',
    AREAS: 'smartHomeAreas',
    FLOORS: 'smartHomeFloors',
    SETTINGS: 'smartHomeSettings',
    HOMES: 'smartHomeHomes',
    SELECTED_HOME: 'smartHomeSelectedHome'
};

function buildHome(name) {
    return {
        id: `home-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name,
        createdAt: new Date().toISOString()
    };
}

// Data Management Functions
function loadData() {
    const devicesData = localStorage.getItem(STORAGE_KEYS.DEVICES);
    const areasData = localStorage.getItem(STORAGE_KEYS.AREAS);
    const floorsData = localStorage.getItem(STORAGE_KEYS.FLOORS);
    const homesData = localStorage.getItem(STORAGE_KEYS.HOMES);
    const selectedHomeRaw = localStorage.getItem(STORAGE_KEYS.SELECTED_HOME);
    
    let devices = devicesData ? JSON.parse(devicesData) : [];
    let areas = areasData ? JSON.parse(areasData) : [];
    let floors = floorsData ? JSON.parse(floorsData) : [];
    let homes = homesData ? JSON.parse(homesData) : [];
    let selectedHomeId = selectedHomeRaw || '';
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
        localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(devices));
        localStorage.setItem(STORAGE_KEYS.HOMES, JSON.stringify(homes));
        localStorage.setItem(STORAGE_KEYS.SELECTED_HOME, selectedHomeId);
    }

    return {
        devices: devices,
        areas: areas,
        floors: floors,
        homes: homes,
        selectedHomeId: selectedHomeId
    };
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(data.devices));
    localStorage.setItem(STORAGE_KEYS.AREAS, JSON.stringify(data.areas));
    localStorage.setItem(STORAGE_KEYS.FLOORS, JSON.stringify(data.floors));
    if (data.homes) {
        localStorage.setItem(STORAGE_KEYS.HOMES, JSON.stringify(data.homes));
    }
    if (data.selectedHomeId) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_HOME, data.selectedHomeId);
    }
    if (data.settings) {
        saveSettings(data.settings);
    }
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

function loadSettings() {
    const settingsData = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const defaults = getDefaultSettings();
    if (settingsData) {
        const saved = JSON.parse(settingsData);
        // Merge with defaults to ensure all keys exist
        return ensureFriendlySettings({
            brands: saved.brands || defaults.brands,
            types: saved.types || defaults.types,
            connectivity: saved.connectivity || defaults.connectivity,
            batteryTypes: saved.batteryTypes || defaults.batteryTypes
        });
    }
    return ensureFriendlySettings(defaults);
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

function getSelectedHomeId() {
    const data = loadData();
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
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/\s*&\s*/g, '-')
        .replace(/\//g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
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
    return normalized === 'wifi' || normalized === 'wi-fi';
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

function applyIconTooltip(el) {
    if (!el || !el.classList || !el.classList.contains('btn-icon')) return;
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

document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    initIconTooltips();
});
