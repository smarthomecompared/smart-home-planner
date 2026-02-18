// Settings Page JavaScript

let selectedFile = null;
let settings = {};
let networks = [];
let networkModalMode = 'add';
let networkModalTargetId = '';
let optionAddModalGroupKey = '';
let activeSettingsPanel = 'general';
let excludedDevicesRows = [];
let excludedDevicesCurrentPage = 1;
let excludedDevicesSortColumn = 'name';
let excludedDevicesSortDirection = 'asc';
const EXCLUDED_DEVICES_PAGE_SIZE = 10;
const DEVICE_OPTIONS_GROUPS = [
    { key: 'brands', label: 'Brands', singularLabel: 'brand', addPlaceholder: 'Add brand' },
    { key: 'types', label: 'Device Types', singularLabel: 'device type', addPlaceholder: 'Add device type' },
    { key: 'connectivity', label: 'Connectivity Options', singularLabel: 'connectivity option', addPlaceholder: 'Add connectivity option' },
    { key: 'batteryTypes', label: 'Battery Types', singularLabel: 'battery type', addPlaceholder: 'Add battery type' }
];
const DEVICE_OPTIONS_GROUPS_BY_KEY = new Map(DEVICE_OPTIONS_GROUPS.map((group) => [group.key, group]));

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    initializeGithubSocialLink();
    initializeSettingsSubmenu('general');
    initializeEventListeners();
    renderHaIntegrationSettings();
    await renderExcludedDevicesManagement();
    await renderNetworksManagement();
    renderOptionsManagement();
});

function initializeSettingsSubmenu(defaultPanel = 'general') {
    const menuButtons = Array.from(document.querySelectorAll('[data-settings-panel-target]'));
    const panels = Array.from(document.querySelectorAll('[data-settings-panel]'));
    const tabList = document.querySelector('.settings-menu-list[role="tablist"]');
    if (!menuButtons.length || !panels.length) return;

    if (tabList) {
        tabList.setAttribute('aria-orientation', 'vertical');
    }

    const panelKeys = new Set(panels.map(panel => panel.getAttribute('data-settings-panel')).filter(Boolean));
    const initialPanel = panelKeys.has(defaultPanel) ? defaultPanel : (panels[0].getAttribute('data-settings-panel') || 'general');
    activateSettingsPanel(initialPanel);

    menuButtons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-settings-panel-target');
            if (!target) return;
            activateSettingsPanel(target);
            closeSettingsMobileMenu();
        });
        button.addEventListener('keydown', (event) => {
            const key = event.key;
            if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
                return;
            }
            event.preventDefault();
            const currentIndex = menuButtons.indexOf(button);
            if (currentIndex < 0) return;

            let nextIndex = currentIndex;
            if (key === 'ArrowRight' || key === 'ArrowDown') {
                nextIndex = (currentIndex + 1) % menuButtons.length;
            } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
                nextIndex = (currentIndex - 1 + menuButtons.length) % menuButtons.length;
            } else if (key === 'Home') {
                nextIndex = 0;
            } else if (key === 'End') {
                nextIndex = menuButtons.length - 1;
            }

            const nextButton = menuButtons[nextIndex];
            if (!nextButton) return;
            const target = nextButton.getAttribute('data-settings-panel-target');
            if (!target) return;
            activateSettingsPanel(target);
            nextButton.focus();
        });
    });
}

function activateSettingsPanel(targetPanel) {
    const menuButtons = Array.from(document.querySelectorAll('[data-settings-panel-target]'));
    const panels = Array.from(document.querySelectorAll('[data-settings-panel]'));
    if (!menuButtons.length || !panels.length) return;

    panels.forEach(panel => {
        const panelKey = panel.getAttribute('data-settings-panel');
        const isActive = panelKey === targetPanel;
        panel.hidden = !isActive;
        panel.classList.toggle('is-active', isActive);
        panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    menuButtons.forEach(button => {
        const isActive = button.getAttribute('data-settings-panel-target') === targetPanel;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    activeSettingsPanel = targetPanel;
    updateSettingsMobileNavLabel(targetPanel);
}

function isMobileSettingsLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function updateSettingsMobileNavLabel(panelKey = '') {
    const label = document.getElementById('settings-mobile-nav-label');
    const toggle = document.getElementById('settings-mobile-nav-toggle');
    if (!label || !toggle) return;

    const selectedButton = panelKey
        ? document.querySelector(`[data-settings-panel-target="${panelKey}"]`)
        : document.querySelector('[data-settings-panel-target].is-active');
    const titleElement = selectedButton ? selectedButton.querySelector('.settings-menu-title') : null;
    const text = titleElement ? titleElement.textContent.trim() : 'Sections';

    label.textContent = text;
    toggle.setAttribute('aria-label', `Open sections menu. Current section: ${text}`);
}

function openSettingsMobileMenu() {
    if (!isMobileSettingsLayout()) return;
    const toggle = document.getElementById('settings-mobile-nav-toggle');
    document.body.classList.add('settings-menu-open');
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
    }
}

function closeSettingsMobileMenu() {
    const toggle = document.getElementById('settings-mobile-nav-toggle');
    document.body.classList.remove('settings-menu-open');
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
    }
}

function toggleSettingsMobileMenu() {
    if (document.body.classList.contains('settings-menu-open')) {
        closeSettingsMobileMenu();
    } else {
        openSettingsMobileMenu();
    }
}

function initializeGithubSocialLink() {
    const githubLink = document.getElementById('social-github-link');
    const githubItem = document.getElementById('social-github-item');
    if (!githubLink || !githubItem) return;

    const repoUrl = typeof appRepoUrl === 'string' ? appRepoUrl.trim() : '';
    if (!repoUrl) {
        githubItem.remove();
        return;
    }

    githubLink.href = repoUrl;
}

// Event Listeners
function initializeEventListeners() {
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', handleFileSelect);
    document.getElementById('import-confirm-btn').addEventListener('click', importData);
    document.querySelectorAll('input[name="ha-area-sync-target"]').forEach((radio) => {
        radio.addEventListener('change', saveHaIntegrationSettings);
    });
    document.getElementById('network-add-btn').addEventListener('click', () => openNetworkModal('add'));
    document.getElementById('network-modal-cancel').addEventListener('click', closeNetworkModal);
    document.getElementById('network-modal-save').addEventListener('click', handleNetworkModalSave);
    document.getElementById('network-modal-overlay').addEventListener('click', closeNetworkModal);
    document.getElementById('option-add-modal-cancel').addEventListener('click', closeOptionAddModal);
    document.getElementById('option-add-modal-save').addEventListener('click', () => {
        void handleOptionAddModalSave();
    });
    document.getElementById('option-add-modal-overlay').addEventListener('click', closeOptionAddModal);
    const optionAddModalInput = document.getElementById('option-add-modal-input');
    if (optionAddModalInput) {
        optionAddModalInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void handleOptionAddModalSave();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeOptionAddModal();
            }
        });
    }
    const mobileToggle = document.getElementById('settings-mobile-nav-toggle');
    const mobileClose = document.getElementById('settings-menu-close');
    const mobileBackdrop = document.getElementById('settings-menu-backdrop');
    if (mobileToggle) {
        mobileToggle.addEventListener('click', toggleSettingsMobileMenu);
    }
    if (mobileClose) {
        mobileClose.addEventListener('click', closeSettingsMobileMenu);
    }
    if (mobileBackdrop) {
        mobileBackdrop.addEventListener('click', closeSettingsMobileMenu);
    }
    window.addEventListener('resize', () => {
        if (!isMobileSettingsLayout()) {
            closeSettingsMobileMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (document.body.classList.contains('settings-menu-open')) {
                closeSettingsMobileMenu();
                return;
            }
            closeOptionAddModal();
            closeNetworkModal();
        }
    });
    initializeExcludedDevicesTableControls();
}

function initializeExcludedDevicesTableControls() {
    const sortableHeaders = document.querySelectorAll('#excluded-devices-table th.sortable');
    sortableHeaders.forEach((header) => {
        header.addEventListener('click', () => {
            const nextColumn = header.getAttribute('data-sort');
            if (!nextColumn) return;
            if (excludedDevicesSortColumn === nextColumn) {
                excludedDevicesSortDirection = excludedDevicesSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                excludedDevicesSortColumn = nextColumn;
                excludedDevicesSortDirection = 'asc';
            }
            excludedDevicesCurrentPage = 1;
            renderExcludedDevicesTable();
        });
    });

    const prevPageBtn = document.getElementById('excluded-prev-page-btn');
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => goToExcludedDevicesPage(excludedDevicesCurrentPage - 1));
    }

    const nextPageBtn = document.getElementById('excluded-next-page-btn');
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => goToExcludedDevicesPage(excludedDevicesCurrentPage + 1));
    }
}

function renderHaIntegrationSettings() {
    const value = settings.haAreaSyncTarget === 'installed' ? 'installed' : 'controlled';
    const targetInput = document.querySelector(`input[name="ha-area-sync-target"][value="${value}"]`);
    if (targetInput) {
        targetInput.checked = true;
    }
}

async function saveHaIntegrationSettings() {
    const selected = document.querySelector('input[name="ha-area-sync-target"]:checked');
    if (!selected) return;
    const target = selected.value === 'controlled' ? 'controlled' : 'installed';
    if (settings.haAreaSyncTarget === target) {
        return;
    }
    const nextSettings = {
        ...settings,
        haAreaSyncTarget: target
    };
    await saveSettings(nextSettings);
    settings = nextSettings;
    showMessage('Home Assistant integration settings saved.', 'success');
}

function getHaDevicesApiUrl() {
    if (typeof window.buildAppUrl === 'function') {
        return window.buildAppUrl('api/ha/devices');
    }
    return '/api/ha/devices';
}

function normalizeExcludedDeviceId(value) {
    return String(value || '').trim();
}

function getExcludedDeviceIds(storage) {
    const source = Array.isArray(storage?.excluded_devices)
        ? storage.excluded_devices
        : (Array.isArray(storage?.excludedDevices) ? storage.excludedDevices : []);
    return source.map(normalizeExcludedDeviceId).filter(Boolean);
}

function normalizeHaBrandName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw === 'Google Inc.' ? 'Google' : raw;
}

function pickHaDeviceName(device) {
    const userName = String(device?.name_by_user || '').trim();
    if (userName) return userName;
    const name = String(device?.name || '').trim();
    if (name) return name;
    return normalizeExcludedDeviceId(device?.id);
}

function buildHaDeviceDetailsUrl(deviceId) {
    const normalizedId = normalizeExcludedDeviceId(deviceId);
    if (!normalizedId) return '';
    return `${window.location.origin}/config/devices/device/${encodeURIComponent(normalizedId)}`;
}

function formatExcludedDeviceField(value, fallback = '-') {
    const text = String(value || '').trim();
    return text || fallback;
}

function buildRestoredDeviceFromHa(haDevice) {
    const id = normalizeExcludedDeviceId(haDevice?.id);
    const areaId = normalizeExcludedDeviceId(haDevice?.area_id);
    return {
        id: id,
        name: pickHaDeviceName(haDevice) || id,
        brand: normalizeHaBrandName(haDevice?.manufacturer),
        model: String(haDevice?.model || '').trim(),
        homeAssistant: true,
        status: 'working',
        area: areaId,
        controlledArea: areaId
    };
}

async function renderExcludedDevicesManagement() {
    const tableContainer = document.getElementById('excluded-devices-table-container');
    const emptyEl = document.getElementById('excluded-devices-empty');
    const paginationEl = document.getElementById('excluded-devices-pagination');
    if (!tableContainer || !emptyEl || !paginationEl) return;

    let excludedIds = [];
    let haDevices = [];

    try {
        const storage = await loadStorage();
        excludedIds = getExcludedDeviceIds(storage);
        haDevices = await loadHaRegistry(getHaDevicesApiUrl());
    } catch (error) {
        console.error('Failed to load excluded devices:', error);
        tableContainer.style.display = 'none';
        paginationEl.style.display = 'none';
        emptyEl.textContent = 'Failed to load excluded devices.';
        emptyEl.classList.remove('is-hidden');
        return;
    }

    const haById = new Map(
        haDevices
            .filter(device => device && typeof device === 'object')
            .map(device => [normalizeExcludedDeviceId(device.id), device])
            .filter(([id]) => Boolean(id))
    );

    excludedDevicesRows = excludedIds.map((deviceId) => {
        const haDevice = haById.get(deviceId);
        const name = haDevice ? (pickHaDeviceName(haDevice) || deviceId) : 'Device not found in Home Assistant';
        const manufacturer = formatExcludedDeviceField(normalizeHaBrandName(haDevice?.manufacturer));
        const model = formatExcludedDeviceField(haDevice?.model);
        return {
            id: deviceId,
            name,
            manufacturer,
            model,
            haAvailable: Boolean(haDevice),
            haUrl: haDevice ? buildHaDeviceDetailsUrl(deviceId) : ''
        };
    });

    if (!excludedDevicesRows.length) {
        tableContainer.style.display = 'none';
        paginationEl.style.display = 'none';
        emptyEl.textContent = 'No excluded devices.';
        emptyEl.classList.remove('is-hidden');
        return;
    }

    tableContainer.style.display = '';
    paginationEl.style.display = '';
    emptyEl.classList.add('is-hidden');
    renderExcludedDevicesTable();
}

function getExcludedDeviceSortValue(row, column) {
    if (!row) return '';
    if (column === 'manufacturer') return String(row.manufacturer || '').toLowerCase();
    if (column === 'model') return String(row.model || '').toLowerCase();
    return String(row.name || '').toLowerCase();
}

function getSortedExcludedDevicesRows() {
    const sorted = [...excludedDevicesRows];
    sorted.sort((a, b) => {
        const aValue = getExcludedDeviceSortValue(a, excludedDevicesSortColumn);
        const bValue = getExcludedDeviceSortValue(b, excludedDevicesSortColumn);
        const compare = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
        return excludedDevicesSortDirection === 'asc' ? compare : -compare;
    });
    return sorted;
}

function renderExcludedDevicesTable() {
    const tbody = document.getElementById('excluded-devices-table-body');
    if (!tbody) return;

    const sortedRows = getSortedExcludedDevicesRows();
    const totalItems = sortedRows.length;
    const totalPages = Math.ceil(totalItems / EXCLUDED_DEVICES_PAGE_SIZE);

    if (excludedDevicesCurrentPage > totalPages) {
        excludedDevicesCurrentPage = totalPages || 1;
    }
    if (excludedDevicesCurrentPage < 1) {
        excludedDevicesCurrentPage = 1;
    }

    const startIndex = (excludedDevicesCurrentPage - 1) * EXCLUDED_DEVICES_PAGE_SIZE;
    const endIndex = Math.min(startIndex + EXCLUDED_DEVICES_PAGE_SIZE, totalItems);
    const pagedRows = sortedRows.slice(startIndex, endIndex);

    document.querySelectorAll('#excluded-devices-table th.sortable').forEach((header) => {
        const column = header.getAttribute('data-sort');
        header.classList.remove('sort-asc', 'sort-desc');
        if (column === excludedDevicesSortColumn) {
            header.classList.add(`sort-${excludedDevicesSortDirection}`);
        }
    });

    tbody.innerHTML = pagedRows.map((row) => {
        const escapedId = escapeHtml(row.id);
        const escapedName = escapeHtml(row.name);
        const escapedManufacturer = escapeHtml(row.manufacturer);
        const escapedModel = escapeHtml(row.model);
        const missingClass = row.haAvailable ? '' : ' class="is-missing"';
        const openAction = row.haAvailable && row.haUrl
            ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(row.haUrl)}" target="_blank" rel="noopener noreferrer">Open in HA</a>`
            : '<button class="btn btn-secondary btn-sm" type="button" disabled>Open in HA</button>';
        const restoreDisabled = row.haAvailable ? '' : ' disabled';

        return `
            <tr${missingClass}>
                <td><strong>${escapedName}</strong></td>
                <td>${escapedManufacturer}</td>
                <td>${escapedModel}</td>
                <td class="actions-cell">
                    ${openAction}
                    <button class="btn btn-primary btn-sm" type="button" data-excluded-restore="${escapedId}"${restoreDisabled}>Restore</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-excluded-restore]').forEach((button) => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-excluded-restore');
            if (!targetId) return;
            button.disabled = true;
            try {
                await restoreExcludedDevice(targetId);
            } finally {
                button.disabled = false;
            }
        });
    });

    updateExcludedDevicesPagination(totalPages, startIndex, endIndex, totalItems);
}

function updateExcludedDevicesPagination(totalPages, startIndex, endIndex, totalItems) {
    const infoEl = document.getElementById('excluded-pagination-info');
    const prevBtn = document.getElementById('excluded-prev-page-btn');
    const nextBtn = document.getElementById('excluded-next-page-btn');
    const pageNumbersEl = document.getElementById('excluded-page-numbers');
    if (!infoEl || !prevBtn || !nextBtn || !pageNumbersEl) return;

    if (totalItems === 0) {
        infoEl.textContent = 'Showing 0-0 of 0';
    } else {
        infoEl.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalItems}`;
    }

    prevBtn.disabled = excludedDevicesCurrentPage <= 1;
    nextBtn.disabled = excludedDevicesCurrentPage >= totalPages || totalPages === 0;

    pageNumbersEl.innerHTML = '';
    if (totalPages <= 0) return;

    const maxPagesToShow = 5;
    let startPage = Math.max(1, excludedDevicesCurrentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.className = 'page-number';
        firstBtn.textContent = '1';
        firstBtn.addEventListener('click', () => goToExcludedDevicesPage(1));
        pageNumbersEl.appendChild(firstBtn);
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.className = 'excluded-page-ellipsis';
            pageNumbersEl.appendChild(ellipsis);
        }
    }

    for (let page = startPage; page <= endPage; page += 1) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-number${page === excludedDevicesCurrentPage ? ' active' : ''}`;
        pageBtn.textContent = String(page);
        pageBtn.addEventListener('click', () => goToExcludedDevicesPage(page));
        pageNumbersEl.appendChild(pageBtn);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.className = 'excluded-page-ellipsis';
            pageNumbersEl.appendChild(ellipsis);
        }
        const lastBtn = document.createElement('button');
        lastBtn.className = 'page-number';
        lastBtn.textContent = String(totalPages);
        lastBtn.addEventListener('click', () => goToExcludedDevicesPage(totalPages));
        pageNumbersEl.appendChild(lastBtn);
    }
}

function goToExcludedDevicesPage(page) {
    const totalPages = Math.ceil(excludedDevicesRows.length / EXCLUDED_DEVICES_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    excludedDevicesCurrentPage = page;
    renderExcludedDevicesTable();
}

async function restoreExcludedDevice(deviceId) {
    const normalizedId = normalizeExcludedDeviceId(deviceId);
    if (!normalizedId) return;

    try {
        const storage = await loadStorage();
        const excludedIds = getExcludedDeviceIds(storage);
        if (!excludedIds.includes(normalizedId)) {
            await renderExcludedDevicesManagement();
            return;
        }

        const haDevices = await loadHaRegistry(getHaDevicesApiUrl());
        const haDevice = haDevices.find(device => normalizeExcludedDeviceId(device?.id) === normalizedId);
        if (!haDevice) {
            showMessage('Device not found in Home Assistant registry.', 'error');
            await renderExcludedDevicesManagement();
            return;
        }

        const data = await loadData();
        const nextDevices = Array.isArray(data.devices) ? [...data.devices] : [];
        const alreadyExists = nextDevices.some(device => normalizeExcludedDeviceId(device?.id) === normalizedId);
        if (!alreadyExists) {
            nextDevices.push(buildRestoredDeviceFromHa(haDevice));
        }

        const nextExcluded = excludedIds.filter(id => id !== normalizedId);
        await saveData({
            ...data,
            devices: nextDevices,
            excluded_devices: nextExcluded
        });

        await renderExcludedDevicesManagement();
        showMessage('Device restored successfully.', 'success');
    } catch (error) {
        console.error('Failed to restore excluded device:', error);
        showMessage(error?.message || 'Failed to restore device.', 'error');
    }
}

// Export Data
async function exportData() {
    try {
        const exportUrl = typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/export') : '/api/export';
        const response = await fetch(exportUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Export request failed: ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const datePart = now.toISOString().split('T')[0];
        const timePart = [
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0')
        ].join('-');
        a.download = `samart-home-planner-${datePart}-${timePart}.tar`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Show success message
        showMessage('Backup exported successfully.', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showMessage('Error exporting backup: ' + error.message, 'error');
    }
}

// Handle File Selection
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    if (!file.name.toLowerCase().endsWith('.tar')) {
        showMessage('Please select a TAR backup file.', 'error');
        return;
    }

    selectedFile = file;
    document.getElementById('import-file-name').textContent = file.name;
    document.getElementById('import-confirm-btn').style.display = 'inline-flex';
}

function readTarHeaderString(bytes, start, length) {
    const end = start + length;
    const slice = bytes.subarray(start, end);
    const nullIndex = slice.indexOf(0);
    const effective = nullIndex >= 0 ? slice.subarray(0, nullIndex) : slice;
    return new TextDecoder('utf-8').decode(effective).trim();
}

function readTarHeaderSize(bytes, start, length) {
    const raw = readTarHeaderString(bytes, start, length).replace(/\0/g, '').trim();
    if (!raw) return 0;
    const sanitized = raw.replace(/[^\d]/g, '');
    if (!sanitized) return 0;
    return parseInt(sanitized, 8);
}

function extractDataJsonFromTar(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const blockSize = 512;
    let offset = 0;

    while (offset + blockSize <= bytes.length) {
        const header = bytes.subarray(offset, offset + blockSize);
        const isZeroBlock = header.every((value) => value === 0);
        if (isZeroBlock) {
            break;
        }

        const name = readTarHeaderString(bytes, offset, 100);
        const prefix = readTarHeaderString(bytes, offset + 345, 155);
        const fullName = prefix ? `${prefix}/${name}` : name;
        const fileSize = readTarHeaderSize(bytes, offset + 124, 12);
        const dataStart = offset + blockSize;
        const dataEnd = dataStart + fileSize;

        if (fullName === 'data.json' && fileSize >= 0 && dataEnd <= bytes.length) {
            return bytes.subarray(dataStart, dataEnd);
        }

        const blocksForFile = Math.ceil(fileSize / blockSize);
        offset = dataStart + (blocksForFile * blockSize);
    }

    return null;
}

async function countDevicesInTarFile(file) {
    try {
        const buffer = await file.arrayBuffer();
        const dataJsonBytes = extractDataJsonFromTar(buffer);
        if (!dataJsonBytes) {
            return null;
        }
        const text = new TextDecoder('utf-8').decode(dataJsonBytes);
        const parsed = JSON.parse(text);
        const devices = Array.isArray(parsed?.devices) ? parsed.devices : [];
        return devices.length;
    } catch (error) {
        console.warn('Unable to inspect TAR backup before import:', error);
        return null;
    }
}

// Import Data
async function importData() {
    if (!selectedFile) {
        showMessage('Please select a file first.', 'error');
        return;
    }

    try {
        const devicesToImport = await countDevicesInTarFile(selectedFile);
        const confirmMessage = Number.isFinite(devicesToImport)
            ? `This will replace all existing data and device files with ${devicesToImport} devices from this backup. Are you sure?`
            : 'This will replace all existing data and device files with the selected backup. Are you sure?';
        const confirmed = await showConfirm(confirmMessage, {
            title: 'Import backup',
            confirmText: 'Import'
        });
        if (!confirmed) {
            return;
        }

        const importUrl = typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/import') : '/api/import';
        const response = await fetch(importUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-tar'
            },
            body: selectedFile
        });
        if (!response.ok) {
            let message = `Import request failed: ${response.status}`;
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
        const importedDevices = Number(payload?.result?.devices || 0);
        const importedFiles = Number(payload?.result?.files || 0);

        showMessage(`Backup imported successfully (${importedDevices} devices, ${importedFiles} files). Reloading...`, 'success');
        setTimeout(() => {
            window.location.reload();
        }, 300);
    } catch (error) {
        console.error('Import error:', error);
        showMessage('Error importing data: ' + error.message, 'error');
    }
}


// Show Message
function showMessage(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type === 'error' ? 'error' : 'success');
    }
}

async function renderNetworksManagement() {
    const data = await loadData();
    networks = data.networks || [];

    const list = document.getElementById('networks-list');
    if (!list) return;

    const canDelete = networks.length > 1;
    list.innerHTML = networks.map(network => `
        <div class="networks-item">
            <div class="networks-item-info">
                <span>${escapeHtml(network.name)}</span>
            </div>
            <div class="networks-item-actions">
                <button class="btn btn-secondary btn-sm btn-icon" data-network-rename="${network.id}" aria-label="Rename network" title="Rename network">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                        <path d="M13.5 6.5l4 4"></path>
                    </svg>
                </button>
                ${canDelete ? `<button class="btn btn-danger btn-sm btn-icon" data-network-delete="${network.id}" aria-label="Delete network" title="Delete network">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4h8v2"></path>
                        <path d="M6 6l1 14h10l1-14"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                    </svg>
                </button>` : ''}
            </div>
        </div>
    `).join('');

    list.querySelectorAll('button[data-network-delete]').forEach(button => {
        button.addEventListener('click', () => {
            const networkId = button.getAttribute('data-network-delete');
            handleDeleteNetwork(networkId);
        });
    });

    list.querySelectorAll('button[data-network-rename]').forEach(button => {
        button.addEventListener('click', () => {
            const networkId = button.getAttribute('data-network-rename');
            openNetworkModal('rename', networkId);
        });
    });
}

function openNetworkModal(mode, networkId = '') {
    const modal = document.getElementById('network-modal');
    const title = document.getElementById('network-modal-title');
    const input = document.getElementById('network-modal-input');
    if (!modal || !title || !input) return;

    networkModalMode = mode;
    networkModalTargetId = networkId;
    const currentNetwork = networks.find(network => network.id === networkId);

    title.textContent = mode === 'rename' ? 'Rename Network' : 'Add Network';
    input.value = mode === 'rename' && currentNetwork ? currentNetwork.name : '';

    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.focus();
    input.select();
}

function closeNetworkModal() {
    const modal = document.getElementById('network-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function capitalizeFirstWord(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function openOptionAddModal(key) {
    const group = getDeviceOptionGroupConfig(key);
    if (!group) return;

    const modal = document.getElementById('option-add-modal');
    const title = document.getElementById('option-add-modal-title');
    const label = document.getElementById('option-add-modal-label');
    const input = document.getElementById('option-add-modal-input');
    if (!modal || !title || !label || !input) return;

    optionAddModalGroupKey = group.key;
    const singularTitle = capitalizeFirstWord(group.singularLabel);
    title.textContent = `Add ${singularTitle}`;
    label.textContent = singularTitle;
    input.value = '';
    input.placeholder = group.addPlaceholder || `Add ${group.singularLabel}`;

    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.focus();
}

function closeOptionAddModal() {
    const modal = document.getElementById('option-add-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    optionAddModalGroupKey = '';
}

async function handleOptionAddModalSave() {
    const group = getDeviceOptionGroupConfig(optionAddModalGroupKey);
    if (!group) {
        closeOptionAddModal();
        return;
    }

    const input = document.getElementById('option-add-modal-input');
    if (!input) return;

    const saved = await addDeviceOption(group.key, input.value);
    if (saved) {
        closeOptionAddModal();
    }
}

async function handleNetworkModalSave() {
    const input = document.getElementById('network-modal-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        showMessage('Network name cannot be empty.', 'error');
        return;
    }
    if (networks.some(network => network.name.toLowerCase() === name.toLowerCase() && network.id !== networkModalTargetId)) {
        showMessage('A network with this name already exists.', 'error');
        return;
    }

    const data = await loadData();
    if (networkModalMode === 'rename') {
        const updatedNetworks = (data.networks || []).map(network => (
            network.id === networkModalTargetId ? { ...network, name: name } : network
        ));
        await saveData({
            ...data,
            networks: updatedNetworks
        });
        showMessage('Network renamed successfully!', 'success');
    } else {
        const newNetwork = buildNetwork(name);
        const updatedNetworks = [...(data.networks || []), newNetwork];
        await saveData({
            ...data,
            networks: updatedNetworks
        });
        showMessage('Network created successfully!', 'success');
    }

    closeNetworkModal();
    await renderNetworksManagement();
}

async function handleDeleteNetwork(networkId) {
    if (!networkId) return;
    if (networks.length <= 1) {
        showMessage('You must keep at least one network.', 'error');
        return;
    }
    const targetNetwork = networks.find(network => network.id === networkId);
    const name = targetNetwork ? targetNetwork.name : 'this network';
    const confirmed = await showConfirm(`Delete "${name}"? Devices using this network will be cleared.`, {
        title: 'Delete network',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }

    const data = await loadData();
    const remainingNetworks = (data.networks || []).filter(network => network.id !== networkId);
    const updatedDevices = (data.devices || []).map(device => {
        if (device.networkId === networkId) {
            return {
                ...device,
                networkId: ''
            };
        }
        return device;
    });

    await saveData({
        ...data,
        networks: remainingNetworks,
        devices: updatedDevices
    });

    await renderNetworksManagement();
    showMessage('Network deleted successfully!', 'success');
}


// Options Management
function getDeviceOptionGroupConfig(key) {
    return DEVICE_OPTIONS_GROUPS_BY_KEY.get(String(key || '').trim()) || null;
}

function normalizeOptionIdentity(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = normalizeOptionValue(raw);
    return normalized || raw.toLowerCase();
}

function buildUniqueOptionValues(values) {
    const seen = new Set();
    const result = [];
    (values || []).forEach((value) => {
        const text = String(value || '').trim();
        if (!text) return;
        const key = normalizeOptionIdentity(text);
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(text);
    });
    return result;
}

function sortOptionValues(values) {
    return [...(values || [])]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getOptionValuesByKey(key) {
    const source = Array.isArray(settings?.[key]) ? settings[key] : [];
    return buildUniqueOptionValues(source);
}

function encodeOptionToken(value) {
    return encodeURIComponent(String(value || '').trim());
}

function decodeOptionToken(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch (_error) {
        return String(value || '');
    }
}

function findOptionIndex(values, targetValue) {
    const target = String(targetValue || '').trim();
    if (!target) return -1;
    const exactIndex = values.findIndex((value) => String(value || '').trim() === target);
    if (exactIndex >= 0) return exactIndex;
    const targetKey = normalizeOptionIdentity(target);
    return values.findIndex((value) => normalizeOptionIdentity(value) === targetKey);
}

async function persistDeviceOptions(key, nextValues, successMessage) {
    const nextSettings = {
        ...settings,
        [key]: sortOptionValues(buildUniqueOptionValues(nextValues)),
        haAreaSyncTarget: settings.haAreaSyncTarget === 'installed' ? 'installed' : 'controlled'
    };
    await saveSettings(nextSettings);
    settings = nextSettings;
    renderOptionsManagement();
    if (successMessage) {
        showMessage(successMessage, 'success');
    }
}

function buildOptionEditorItemMarkup(key, value) {
    const safeValue = String(value || '').trim();
    const valueToken = encodeOptionToken(safeValue);
    return `
        <div class="option-editor-item" data-option-key="${escapeHtml(key)}" data-option-value="${escapeHtml(valueToken)}">
            <div class="option-editor-value">${escapeHtml(safeValue)}</div>
            <div class="option-editor-actions">
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-option-rename-start aria-label="Rename" title="Rename">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                        <path d="M13.5 6.5l4 4"></path>
                    </svg>
                </button>
                <button class="btn btn-danger btn-sm btn-icon" type="button" data-option-delete aria-label="Delete" title="Delete">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4h8v2"></path>
                        <path d="M6 6l1 14h10l1-14"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                    </svg>
                </button>
            </div>
            <div class="option-editor-rename">
                <input type="text" class="option-editor-rename-input" value="${escapeHtml(safeValue)}" maxlength="80">
                <button class="btn btn-primary btn-sm btn-icon" type="button" data-option-rename-save aria-label="Save" title="Save">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                </button>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-option-rename-cancel aria-label="Cancel" title="Cancel">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M18 6L6 18"></path>
                        <path d="M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function renderOptionsManagement() {
    const container = document.getElementById('options-management');
    if (!container) return;

    container.innerHTML = `
        <div class="option-editor-layout">
            ${DEVICE_OPTIONS_GROUPS.map((group) => {
                const values = sortOptionValues(getOptionValuesByKey(group.key));
                const listContent = values.length
                    ? values.map((value) => buildOptionEditorItemMarkup(group.key, value)).join('')
                    : `<div class="option-editor-empty">No ${escapeHtml(group.label.toLowerCase())} yet.</div>`;
                return `
                    <div class="option-editor-group" data-option-group="${escapeHtml(group.key)}">
                        <div class="option-editor-group-header">
                            <div class="option-editor-group-heading">
                                <div class="option-editor-group-title">${escapeHtml(group.label)}</div>
                                <span class="option-editor-group-count">${values.length}</span>
                            </div>
                            <button class="btn btn-primary btn-sm option-editor-group-add-btn" type="button" data-option-add-open="${escapeHtml(group.key)}" aria-label="Add" title="Add">+</button>
                        </div>
                        <div class="option-editor-list">
                            ${listContent}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    initializeOptionEditorEvents();
}

function initializeOptionEditorEvents() {
    const container = document.getElementById('options-management');
    if (!container) return;
    if (container.dataset.optionEditorBound === 'true') return;

    container.dataset.optionEditorBound = 'true';
    container.addEventListener('click', (event) => {
        void handleOptionEditorClick(event);
    });
    container.addEventListener('keydown', (event) => {
        void handleOptionEditorKeydown(event);
    });
}

function getOptionEditorItemContext(target) {
    const item = target.closest('.option-editor-item');
    if (!item) return null;
    const key = String(item.dataset.optionKey || '').trim();
    const group = getDeviceOptionGroupConfig(key);
    if (!group) return null;
    const currentValue = decodeOptionToken(item.dataset.optionValue);
    return { item, key, group, currentValue };
}

function enterOptionRenameMode(item) {
    if (!item) return;
    item.classList.add('is-renaming');
    const input = item.querySelector('.option-editor-rename-input');
    if (input) {
        const currentValue = decodeOptionToken(item.dataset.optionValue);
        input.value = currentValue;
        input.focus();
        input.select();
    }
}

function exitOptionRenameMode(item) {
    if (!item) return;
    item.classList.remove('is-renaming');
    const input = item.querySelector('.option-editor-rename-input');
    if (input) {
        input.value = decodeOptionToken(item.dataset.optionValue);
    }
}

async function addDeviceOption(key, nextValue = '') {
    const group = getDeviceOptionGroupConfig(key);
    if (!group) return false;

    const value = String(nextValue || '').trim();
    if (!value) {
        showMessage(`Enter a ${group.singularLabel} first.`, 'error');
        return false;
    }

    const currentValues = getOptionValuesByKey(key);
    const valueKey = normalizeOptionIdentity(value);
    const alreadyExists = currentValues.some((item) => normalizeOptionIdentity(item) === valueKey);
    if (alreadyExists) {
        showMessage(`That ${group.singularLabel} already exists.`, 'error');
        return false;
    }

    await persistDeviceOptions(key, [...currentValues, value], `${group.label} updated.`);
    return true;
}

async function deleteDeviceOption(context) {
    if (!context) return;
    const { key, group, currentValue } = context;
    const currentValues = getOptionValuesByKey(key);
    const index = findOptionIndex(currentValues, currentValue);
    if (index < 0) {
        renderOptionsManagement();
        return;
    }
    const nextValues = currentValues.filter((_, itemIndex) => itemIndex !== index);
    await persistDeviceOptions(key, nextValues, `${group.label} updated.`);
}

async function renameDeviceOption(context) {
    if (!context) return;
    const { item, key, group, currentValue } = context;
    const input = item.querySelector('.option-editor-rename-input');
    if (!input) return;

    const nextValue = String(input.value || '').trim();
    if (!nextValue) {
        showMessage(`Enter a ${group.singularLabel} name.`, 'error');
        input.focus();
        return;
    }

    const currentValues = getOptionValuesByKey(key);
    const index = findOptionIndex(currentValues, currentValue);
    if (index < 0) {
        renderOptionsManagement();
        return;
    }

    const duplicate = currentValues.some((value, itemIndex) => (
        itemIndex !== index && normalizeOptionIdentity(value) === normalizeOptionIdentity(nextValue)
    ));
    if (duplicate) {
        showMessage(`That ${group.singularLabel} already exists.`, 'error');
        input.focus();
        input.select();
        return;
    }

    const nextValues = [...currentValues];
    nextValues[index] = nextValue;
    await persistDeviceOptions(key, nextValues, `${group.label} updated.`);
}

async function handleOptionEditorClick(event) {
    const addOpenBtn = event.target.closest('[data-option-add-open]');
    if (addOpenBtn) {
        const key = addOpenBtn.getAttribute('data-option-add-open') || '';
        openOptionAddModal(key);
        return;
    }

    const renameStartBtn = event.target.closest('[data-option-rename-start]');
    if (renameStartBtn) {
        const context = getOptionEditorItemContext(renameStartBtn);
        if (!context) return;
        enterOptionRenameMode(context.item);
        return;
    }

    const renameCancelBtn = event.target.closest('[data-option-rename-cancel]');
    if (renameCancelBtn) {
        const context = getOptionEditorItemContext(renameCancelBtn);
        if (!context) return;
        exitOptionRenameMode(context.item);
        return;
    }

    const renameSaveBtn = event.target.closest('[data-option-rename-save]');
    if (renameSaveBtn) {
        const context = getOptionEditorItemContext(renameSaveBtn);
        await renameDeviceOption(context);
        return;
    }

    const deleteBtn = event.target.closest('[data-option-delete]');
    if (deleteBtn) {
        const context = getOptionEditorItemContext(deleteBtn);
        await deleteDeviceOption(context);
    }
}

async function handleOptionEditorKeydown(event) {
    const renameInput = event.target.closest('.option-editor-rename-input');
    if (!renameInput) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        const context = getOptionEditorItemContext(renameInput);
        if (!context) return;
        exitOptionRenameMode(context.item);
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        const context = getOptionEditorItemContext(renameInput);
        await renameDeviceOption(context);
    }
}
