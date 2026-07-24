// Settings Page JavaScript

let selectedFile = null;
let settings = {};
let networks = [];
let networkModalMode = 'add';
let networkModalTargetId = '';
let isps = [];
let ispDevices = [];
let ispModalMode = 'add';
let ispModalTargetId = '';
let optionAddModalGroupKey = '';
let activeSettingsPanel = 'general';
let excludedDevicesRows = [];
let excludedDevicesCurrentPage = 1;
let excludedDevicesSortColumn = 'name';
let excludedDevicesSortDirection = 'asc';
const EXCLUDED_DEVICES_PAGE_SIZE = 10;
// `usage` tells which stored records reference a value, so deleting a custom can
// warn how many entries currently use it. `noun` is what those records are called.
const DEVICE_OPTIONS_GROUPS = [
    { key: 'brands', label: 'Brands', singularLabel: 'brand', addPlaceholder: 'Add brand', usage: { collection: 'devices', field: 'brand', noun: 'device' } },
    { key: 'types', label: 'Device Types', singularLabel: 'device type', addPlaceholder: 'Add device type', usage: { collection: 'devices', field: 'type', noun: 'device' } },
    { key: 'connectivity', label: 'Connectivity Options', singularLabel: 'connectivity option', addPlaceholder: 'Add connectivity option', usage: { collection: 'devices', field: 'connectivity', noun: 'device' } },
    { key: 'batteryTypes', label: 'Battery Types', singularLabel: 'battery type', addPlaceholder: 'Add battery type', usage: { collection: 'devices', field: 'batteryType', noun: 'device' } }
];
const TEST_CASE_OPTIONS_GROUPS = [
    { key: 'testCaseCategories', label: 'Test Case Categories', singularLabel: 'test case category', addPlaceholder: 'Add test case category', usage: { collection: 'testCases', field: 'category', noun: 'test case' } }
];
const OPTION_GROUPS = [...DEVICE_OPTIONS_GROUPS, ...TEST_CASE_OPTIONS_GROUPS];
const OPTION_GROUPS_BY_KEY = new Map(OPTION_GROUPS.map((group) => [group.key, group]));

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const deepLink = readSettingsDeepLink();
    settings = await loadSettings();
    initializeGithubSocialLink();
    initializeSettingsSubmenu(deepLink.panel || 'general');
    initializeEventListeners();
    renderHaIntegrationSettings();
    renderNotificationSettings();
    await renderExcludedDevicesManagement();
    await renderNetworksManagement();
    await renderIspsManagement();
    renderOptionsManagement();
    renderTestCaseCategoriesManagement();
    applySettingsDeepLink(deepLink);
});

// Deep link from the diagram: settings.html?panel=isps&isp=<id> opens the
// provider straight in its edit modal. The query is dropped afterwards so a
// reload doesn't reopen it.
function readSettingsDeepLink() {
    const params = new URLSearchParams(window.location.search);
    return {
        panel: String(params.get('panel') || '').trim(),
        ispId: String(params.get('isp') || '').trim()
    };
}

function applySettingsDeepLink(deepLink) {
    if (!deepLink || (!deepLink.panel && !deepLink.ispId)) return;

    if (deepLink.ispId && isps.some(isp => isp.id === deepLink.ispId)) {
        openIspModal('edit', deepLink.ispId);
    }

    window.history.replaceState({}, '', window.location.pathname);
}

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
    const exportReportBtn = document.getElementById('export-report-btn');
    if (exportReportBtn) {
        exportReportBtn.addEventListener('click', () => {
            void handleExportReport();
        });
    }
    document.querySelectorAll('input[name="report-format"]').forEach((radio) => {
        radio.addEventListener('change', updateReportExportButtonLabel);
    });
    updateReportExportButtonLabel();
    document.querySelectorAll('input[name="ha-area-sync-target"]').forEach((radio) => {
        radio.addEventListener('change', saveHaIntegrationSettings);
    });
    document.getElementById('network-add-btn').addEventListener('click', () => openNetworkModal('add'));
    document.getElementById('network-modal-cancel').addEventListener('click', closeNetworkModal);
    document.getElementById('network-modal-save').addEventListener('click', handleNetworkModalSave);
    document.getElementById('network-modal-overlay').addEventListener('click', closeNetworkModal);
    document.getElementById('isp-add-btn').addEventListener('click', () => openIspModal('add'));
    document.getElementById('isp-modal-cancel').addEventListener('click', closeIspModal);
    document.getElementById('isp-modal-save').addEventListener('click', handleIspModalSave);
    document.getElementById('isp-modal-overlay').addEventListener('click', closeIspModal);
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

    ['notif-enabled', 'notif-type-battery', 'notif-type-warranty', 'notif-type-backup', 'notif-type-tests'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { void _notifAutoSave(); });
    });
}

// Reports
function getSelectedReportFormat() {
    const checked = document.querySelector('input[name="report-format"]:checked');
    return checked ? checked.value : 'pdf';
}

function getSelectedReportSections() {
    const sections = {};
    document.querySelectorAll('.report-section-check').forEach((cb) => {
        sections[cb.value] = cb.checked;
    });
    return sections;
}

function updateReportExportButtonLabel() {
    const btn = document.getElementById('export-report-btn');
    if (!btn) return;
    btn.textContent = getSelectedReportFormat() === 'markdown' ? 'Export Markdown' : 'Export to PDF';
}

async function handleExportReport() {
    const format = getSelectedReportFormat();
    const sections = getSelectedReportSections();

    if (!Object.values(sections).some(Boolean)) {
        showToast('Select at least one section to export.', 'error');
        return;
    }

    if (format === 'markdown') {
        await generateSmartHomeMarkdown({ sections });
    } else {
        await generateSmartHomePDF({ sections });
    }
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
        haDeviceIds: [id],
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

    const filteredExcludedIds = excludedIds.filter((deviceId) => haById.has(deviceId));
    if (filteredExcludedIds.length !== excludedIds.length) {
        await patchStorage({
            excluded_devices: filteredExcludedIds
        });
    }
    excludedIds = filteredExcludedIds;

    excludedDevicesRows = excludedIds.map((deviceId) => {
        const haDevice = haById.get(deviceId);
        const name = haDevice ? (pickHaDeviceName(haDevice) || deviceId) : deviceId;
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
            const nextExcluded = excludedIds.filter(id => id !== normalizedId);
            await patchStorage({ excluded_devices: nextExcluded });
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
        a.download = `smart-home-planner-${datePart}-${timePart}.tar`;
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

// Internet Providers Management
function formatIspSpeedSummary(isp) {
    const download = Number(isp.downloadSpeed);
    const upload = Number(isp.uploadSpeed);
    const hasDownload = Number.isFinite(download) && download > 0;
    const hasUpload = Number.isFinite(upload) && upload > 0;
    if (hasDownload && hasUpload) return `${download} / ${upload} Mbps`;
    if (hasDownload) return `${download} Mbps`;
    if (hasUpload) return `${upload} Mbps up`;
    return '';
}

function getIspGatewayName(isp) {
    const gatewayId = String(isp.gatewayDeviceId || '').trim();
    if (!gatewayId) return '';
    const device = ispDevices.find(d => d.id === gatewayId);
    return device ? (device.name || device.model || 'Unnamed Device') : '';
}

async function renderIspsManagement() {
    const data = await loadData();
    isps = data.isps || [];
    ispDevices = data.devices || [];

    const list = document.getElementById('isps-list');
    if (!list) return;

    const canDelete = isps.length > 1;
    list.innerHTML = isps.map(isp => {
        const technologyLabel = getIspTechnologyLabel(isp.technology);
        const speedSummary = formatIspSpeedSummary(isp);
        const gatewayName = getIspGatewayName(isp);
        const metaParts = [
            technologyLabel,
            speedSummary,
            gatewayName ? `Gateway: ${gatewayName}` : 'Gateway: auto-detect'
        ].filter(Boolean);
        return `
        <div class="networks-item">
            <div class="networks-item-info isp-item-info">
                <span class="isp-item-name">${escapeHtml(isp.name)}</span>
                ${isp.role === 'backup' ? '<span class="isp-role-badge">Backup</span>' : ''}
                <span class="isp-item-meta">${escapeHtml(metaParts.join(' · '))}</span>
            </div>
            <div class="networks-item-actions">
                <button class="btn btn-secondary btn-sm btn-icon" data-isp-edit="${isp.id}" aria-label="Edit provider" title="Edit provider">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                        <path d="M13.5 6.5l4 4"></path>
                    </svg>
                </button>
                ${canDelete ? `<button class="btn btn-danger btn-sm btn-icon" data-isp-delete="${isp.id}" aria-label="Delete provider" title="Delete provider">
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
    `;
    }).join('');

    list.querySelectorAll('button[data-isp-edit]').forEach(button => {
        button.addEventListener('click', () => {
            openIspModal('edit', button.getAttribute('data-isp-edit'));
        });
    });

    list.querySelectorAll('button[data-isp-delete]').forEach(button => {
        button.addEventListener('click', () => {
            handleDeleteIsp(button.getAttribute('data-isp-delete'));
        });
    });
}

function populateIspModalSelects(keepGatewayDeviceId = '') {
    const technologySelect = document.getElementById('isp-technology-select');
    if (technologySelect && technologySelect.options.length <= 1) {
        ISP_TECHNOLOGY_OPTIONS.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.label;
            technologySelect.appendChild(optionEl);
        });
    }

    const gatewaySelect = document.getElementById('isp-gateway-select');
    if (gatewaySelect) {
        // The value is set by openIspModal after this runs, so it is passed in
        // explicitly to keep a legacy assignment listed even when ineligible.
        const keepDeviceId = String(keepGatewayDeviceId || '').trim();
        while (gatewaySelect.options.length > 1) {
            gatewaySelect.remove(1);
        }
        // Only devices that can actually terminate a WAN line (router, modem/ONT,
        // gateway) — a motion sensor is never a gateway. A legacy assignment to
        // an ineligible device is kept so editing an ISP never silently drops it.
        const sortedDevices = [...ispDevices]
            .filter(device => device && device.id)
            .filter(device => isIspGatewayEligibleDevice(device) || device.id === keepDeviceId)
            .sort((a, b) => String(a.name || a.model || '').localeCompare(String(b.name || b.model || '')));
        sortedDevices.forEach(device => {
            const optionEl = document.createElement('option');
            optionEl.value = device.id;
            optionEl.textContent = device.name || device.model || 'Unnamed Device';
            gatewaySelect.appendChild(optionEl);
        });
    }
}

function openIspModal(mode, ispId = '') {
    const modal = document.getElementById('isp-modal');
    const title = document.getElementById('isp-modal-title');
    if (!modal || !title) return;

    ispModalMode = mode;
    ispModalTargetId = ispId;
    const currentIsp = isps.find(isp => isp.id === ispId);

    populateIspModalSelects(currentIsp ? currentIsp.gatewayDeviceId : '');

    title.textContent = mode === 'edit' ? 'Edit Provider' : 'Add Provider';
    const nameInput = document.getElementById('isp-name-input');
    nameInput.value = mode === 'edit' && currentIsp ? currentIsp.name : '';
    document.getElementById('isp-technology-select').value = currentIsp ? (currentIsp.technology || '') : '';
    document.getElementById('isp-role-select').value = currentIsp && currentIsp.role === 'backup' ? 'backup' : 'primary';
    document.getElementById('isp-download-input').value = currentIsp && currentIsp.downloadSpeed != null ? currentIsp.downloadSpeed : '';
    document.getElementById('isp-upload-input').value = currentIsp && currentIsp.uploadSpeed != null ? currentIsp.uploadSpeed : '';
    document.getElementById('isp-gateway-select').value = currentIsp ? (currentIsp.gatewayDeviceId || '') : '';
    document.getElementById('isp-notes-input').value = currentIsp ? (currentIsp.notes || '') : '';

    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    nameInput.focus();
    nameInput.select();
}

function closeIspModal() {
    const modal = document.getElementById('isp-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function parseIspSpeedInput(rawValue, label) {
    const raw = String(rawValue || '').trim();
    if (!raw) return { value: null };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `${label} must be a non-negative number.` };
    }
    return { value: parsed };
}

async function handleIspModalSave() {
    const name = String(document.getElementById('isp-name-input').value || '').trim();
    if (!name) {
        showMessage('Provider name cannot be empty.', 'error');
        return;
    }
    if (isps.some(isp => isp.name.toLowerCase() === name.toLowerCase() && isp.id !== ispModalTargetId)) {
        showMessage('A provider with this name already exists.', 'error');
        return;
    }
    const download = parseIspSpeedInput(document.getElementById('isp-download-input').value, 'Download speed');
    if (download.error) {
        showMessage(download.error, 'error');
        return;
    }
    const upload = parseIspSpeedInput(document.getElementById('isp-upload-input').value, 'Upload speed');
    if (upload.error) {
        showMessage(upload.error, 'error');
        return;
    }

    const fields = {
        name: name,
        technology: document.getElementById('isp-technology-select').value || '',
        role: document.getElementById('isp-role-select').value === 'backup' ? 'backup' : 'primary',
        downloadSpeed: download.value,
        uploadSpeed: upload.value,
        gatewayDeviceId: document.getElementById('isp-gateway-select').value || '',
        notes: String(document.getElementById('isp-notes-input').value || '').trim()
    };

    const data = await loadData();
    if (ispModalMode === 'edit') {
        const updatedIsps = (data.isps || []).map(isp => (
            isp.id === ispModalTargetId ? { ...isp, ...fields } : isp
        ));
        await saveData({
            ...data,
            isps: updatedIsps
        });
        showMessage('Provider updated successfully!', 'success');
    } else {
        const newIsp = buildIsp(name, fields);
        await saveData({
            ...data,
            isps: [...(data.isps || []), newIsp]
        });
        showMessage('Provider created successfully!', 'success');
    }

    closeIspModal();
    await renderIspsManagement();
}

async function handleDeleteIsp(ispId) {
    if (!ispId) return;
    if (isps.length <= 1) {
        showMessage('You must keep at least one internet provider.', 'error');
        return;
    }
    const targetIsp = isps.find(isp => isp.id === ispId);
    const name = targetIsp ? targetIsp.name : 'this provider';
    const confirmed = await showConfirm(`Delete "${name}"? It will disappear from the Diagram view.`, {
        title: 'Delete provider',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }

    const data = await loadData();
    await saveData({
        ...data,
        isps: (data.isps || []).filter(isp => isp.id !== ispId)
    });

    await renderIspsManagement();
    showMessage('Provider deleted successfully!', 'success');
}


// Options Management
function getDeviceOptionGroupConfig(key) {
    return OPTION_GROUPS_BY_KEY.get(String(key || '').trim()) || null;
}

function normalizeOptionIdentity(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = normalizeOptionValue(raw);
    return normalized || raw.toLowerCase();
}

// Settings lists everything — visible defaults, hidden defaults and customs —
// so the user can see the full catalog and bring hidden entries back.
function getOptionEditorEntries(key) {
    const hiddenSlugs = new Set(getHiddenDefaultSlugs(settings, key));
    const entries = getDefaultOptionValuesByKey(key).map(value => ({
        value,
        isDefault: true,
        isHidden: hiddenSlugs.has(normalizeOptionValue(value))
    }));
    getCustomOptionValues(settings, key).forEach((value) => {
        entries.push({ value, isDefault: false, isHidden: false });
    });
    return entries.sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { sensitivity: 'base' }));
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

// Only the edited group is written. It used to spread the whole settings object,
// which persisted every other list too — that is how adding a single brand froze
// the device types and kept later releases from delivering new ones.
async function persistOptionGroup(key, patch, successMessage) {
    const nextSettings = {
        ...settings,
        customOptions: { ...settings.customOptions, ...(patch.customs ? { [key]: patch.customs } : {}) },
        hiddenDefaults: { ...settings.hiddenDefaults, ...(patch.hidden ? { [key]: patch.hidden } : {}) }
    };
    await saveSettings(nextSettings);
    settings = await loadSettings();
    renderOptionsManagement();
    renderTestCaseCategoriesManagement();
    if (successMessage) {
        showMessage(successMessage, 'success');
    }
}

const OPTION_ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>';
const OPTION_ICON_EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.9 5.7A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4"></path><path d="M6.3 7.9A16.7 16.7 0 0 0 2 12s3.6 6.5 10 6.5a9.9 9.9 0 0 0 3.6-.66"></path><path d="M10.3 10.3a2.6 2.6 0 0 0 3.4 3.4"></path><path d="M3 3l18 18"></path></svg>';

const OPTION_ICON_DELETE = `<svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4h8v2"></path>
                        <path d="M6 6l1 14h10l1-14"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                    </svg>`;

// Defaults live in the code: their slugs back icons, map layers and lookups, so
// renaming or deleting one would break those silently — they can only be hidden.
// Regular customs get the full rename/delete pair. A custom in a fixed group
// (a connectivity value typed in before those were locked) can only be deleted:
// renaming would let it masquerade as a new one, which the group no longer allows.
function buildOptionEditorItemMarkup(key, entry) {
    const safeValue = String(entry?.value || '').trim();
    const valueToken = encodeOptionToken(safeValue);
    const isDefault = !!entry?.isDefault;
    const isHidden = !!entry?.isHidden;
    const allowRename = !isDefault && !isFixedOptionGroup(key);

    const badge = isDefault
        ? (isHidden ? '<span class="option-editor-badge is-hidden-badge">Hidden</span>' : '')
        : '<span class="option-editor-badge is-custom-badge">Custom</span>';

    const renameButton = allowRename
        ? `<button class="btn btn-secondary btn-sm btn-icon" type="button" data-option-rename-start aria-label="Rename" title="Rename">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                        <path d="M13.5 6.5l4 4"></path>
                    </svg>
                </button>`
        : '';
    const deleteButton = `<button class="btn btn-danger btn-sm btn-icon" type="button" data-option-delete aria-label="Delete" title="Delete">${OPTION_ICON_DELETE}</button>`;

    const actions = isDefault
        ? `<button class="btn btn-secondary btn-sm btn-icon" type="button" data-option-toggle-hidden aria-label="${isHidden ? 'Show' : 'Hide'}" title="${isHidden ? 'Show in pickers' : 'Hide from pickers'}">
                    ${isHidden ? OPTION_ICON_EYE : OPTION_ICON_EYE_OFF}
                </button>`
        : `${renameButton}${deleteButton}`;

    const renameEditor = !allowRename ? '' : `
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
            </div>`;

    const classNames = ['option-editor-item'];
    if (isDefault) classNames.push('is-default');
    if (isHidden) classNames.push('is-hidden-option');

    return `
        <div class="${classNames.join(' ')}" data-option-key="${escapeHtml(key)}" data-option-value="${escapeHtml(valueToken)}" data-option-default="${isDefault ? 'true' : 'false'}">
            <div class="option-editor-value">${escapeHtml(safeValue)}${badge}</div>
            <div class="option-editor-actions">
                ${actions}
            </div>${renameEditor}
        </div>
    `;
}

function renderOptionsManagement() {
    renderOptionGroups('options-management', DEVICE_OPTIONS_GROUPS);
}

function renderTestCaseCategoriesManagement() {
    renderOptionGroups('test-case-categories-management', TEST_CASE_OPTIONS_GROUPS);
}

function renderOptionGroups(containerId, groups) {
    const container = document.getElementById(containerId);
    if (!container || !Array.isArray(groups) || !groups.length) return;

    container.innerHTML = `
        <div class="option-editor-layout">
            ${groups.map((group) => {
                const entries = getOptionEditorEntries(group.key);
                const hiddenCount = entries.filter(entry => entry.isHidden).length;
                const listContent = entries.length
                    ? entries.map((entry) => buildOptionEditorItemMarkup(group.key, entry)).join('')
                    : `<div class="option-editor-empty">No ${escapeHtml(group.label.toLowerCase())} yet.</div>`;
                // Connectivity values map to protocol logic in the code, so a custom
                // one would be an inert label: no add button there.
                const addButton = isFixedOptionGroup(group.key)
                    ? ''
                    : `<button class="btn btn-primary btn-sm option-editor-group-add-btn" type="button" data-option-add-open="${escapeHtml(group.key)}" aria-label="Add" title="Add">+</button>`;
                return `
                    <div class="option-editor-group" data-option-group="${escapeHtml(group.key)}">
                        <div class="option-editor-group-header">
                            <div class="option-editor-group-heading">
                                <div class="option-editor-group-title">${escapeHtml(group.label)}</div>
                                <span class="option-editor-group-count">${entries.length - hiddenCount}</span>
                                ${hiddenCount ? `<span class="option-editor-group-hidden-count">${hiddenCount} hidden</span>` : ''}
                            </div>
                            ${addButton}
                        </div>
                        <div class="option-editor-list">
                            ${listContent}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    initializeOptionEditorEvents(containerId);
}

function initializeOptionEditorEvents(containerId) {
    const container = document.getElementById(containerId);
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
    if (!group || isFixedOptionGroup(key)) return false;

    const value = String(nextValue || '').trim();
    if (!value) {
        showMessage(`Enter a ${group.singularLabel} first.`, 'error');
        return false;
    }

    const valueKey = normalizeOptionIdentity(value);
    // A name that matches a hidden default is a request to bring it back, not a
    // new custom — otherwise the user would end up with two entries alike.
    if (isDefaultOptionValue(key, value)) {
        if (!isHiddenDefaultOption(settings, key, value)) {
            showMessage(`That ${group.singularLabel} already exists.`, 'error');
            return false;
        }
        const hidden = getHiddenDefaultSlugs(settings, key).filter(slug => slug !== normalizeOptionValue(value));
        await persistOptionGroup(key, { hidden }, `${group.label} updated.`);
        return true;
    }

    const customs = getCustomOptionValues(settings, key);
    if (customs.some((item) => normalizeOptionIdentity(item) === valueKey)) {
        showMessage(`That ${group.singularLabel} already exists.`, 'error');
        return false;
    }

    await persistOptionGroup(key, { customs: [...customs, value] }, `${group.label} updated.`);
    return true;
}

async function toggleHiddenDefaultOption(context) {
    if (!context) return;
    const { key, group, currentValue } = context;
    const slug = normalizeOptionValue(currentValue);
    if (!slug || !isDefaultOptionValue(key, currentValue)) return;

    const hidden = getHiddenDefaultSlugs(settings, key);
    const isHidden = hidden.includes(slug);
    const nextHidden = isHidden ? hidden.filter(item => item !== slug) : [...hidden, slug];
    const label = String(currentValue || '').trim() || group.singularLabel;
    await persistOptionGroup(key, { hidden: nextHidden }, `"${label}" ${isHidden ? 'shown' : 'hidden'}.`);
}

// How many stored records reference this value. Matches on the normalized slug
// so casing/spacing differences don't hide a use.
async function countOptionUsage(group, value) {
    const usage = group?.usage;
    const target = normalizeOptionValue(value);
    if (!usage || !target) return 0;
    const data = await loadData();
    const records = Array.isArray(data?.[usage.collection]) ? data[usage.collection] : [];
    return records.filter(record => normalizeOptionValue(record?.[usage.field]) === target).length;
}

// Deleting a custom also clears it from every record that uses it — same as
// deleting a network clears it from its devices — so no record is left pointing
// at a value that no longer exists.
function buildDeleteOptionMessage(group, label, usageCount) {
    if (!usageCount) {
        return `Delete "${label}"?`;
    }
    const noun = group?.usage?.noun || 'record';
    const field = group?.singularLabel || 'value';
    const subject = usageCount === 1 ? `1 ${noun} uses` : `${usageCount} ${noun}s use`;
    const them = usageCount === 1 ? 'it' : 'them';
    return `${subject} "${label}". Deleting it will clear the ${field} from ${them}.`;
}

// Blanks the field on every record in the usage collection that points at this
// value. Returns the updated data (or null when nothing referenced it).
function clearOptionFromRecords(data, group, value) {
    const usage = group?.usage;
    const target = normalizeOptionValue(value);
    if (!usage || !target) return null;
    const records = Array.isArray(data?.[usage.collection]) ? data[usage.collection] : [];
    let changed = false;
    const updated = records.map((record) => {
        if (record && normalizeOptionValue(record[usage.field]) === target) {
            changed = true;
            return { ...record, [usage.field]: '' };
        }
        return record;
    });
    return changed ? { ...data, [usage.collection]: updated } : null;
}

async function deleteDeviceOption(context) {
    if (!context) return;
    const { key, group, currentValue } = context;
    const customs = getCustomOptionValues(settings, key);
    const index = findOptionIndex(customs, currentValue);
    if (index < 0) {
        renderOptionsManagement();
        return;
    }
    const nextValues = customs.filter((_, itemIndex) => itemIndex !== index);

    // Clear the value from referencing records first, in its own save, so the
    // records never point at a preset that is already gone.
    const data = await loadData();
    const cleared = clearOptionFromRecords(data, group, currentValue);
    if (cleared) {
        await saveData(cleared);
    }

    await persistOptionGroup(key, { customs: nextValues }, `${group.label} updated.`);
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

    const customs = getCustomOptionValues(settings, key);
    const index = findOptionIndex(customs, currentValue);
    if (index < 0) {
        renderOptionsManagement();
        return;
    }

    const collidesWithDefault = isDefaultOptionValue(key, nextValue);
    const duplicate = customs.some((value, itemIndex) => (
        itemIndex !== index && normalizeOptionIdentity(value) === normalizeOptionIdentity(nextValue)
    ));
    if (collidesWithDefault || duplicate) {
        showMessage(`That ${group.singularLabel} already exists.`, 'error');
        input.focus();
        input.select();
        return;
    }

    const nextValues = [...customs];
    nextValues[index] = nextValue;
    await persistOptionGroup(key, { customs: nextValues }, `${group.label} updated.`);
}

async function handleOptionEditorClick(event) {
    const addOpenBtn = event.target.closest('[data-option-add-open]');
    if (addOpenBtn) {
        const key = addOpenBtn.getAttribute('data-option-add-open') || '';
        openOptionAddModal(key);
        return;
    }

    const toggleHiddenBtn = event.target.closest('[data-option-toggle-hidden]');
    if (toggleHiddenBtn) {
        await toggleHiddenDefaultOption(getOptionEditorItemContext(toggleHiddenBtn));
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
        if (!context) return;
        const label = String(context.currentValue || '').trim() || context.group.singularLabel;
        const usageCount = await countOptionUsage(context.group, context.currentValue);
        const message = buildDeleteOptionMessage(context.group, label, usageCount);
        const confirmed = await showConfirm(message, { title: `Delete ${context.group.singularLabel}`, confirmText: 'Delete' });
        if (!confirmed) return;
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


// Notification Settings

let _notifFeedbackTimer = null;

function _notifUpdateMasterState(enabled) {
    const masterCard = document.getElementById('notif-master-card');
    const typesPanel = document.getElementById('notif-types-panel');
    if (masterCard) masterCard.classList.toggle('is-on', enabled);
    if (typesPanel) typesPanel.classList.toggle('is-disabled', !enabled);
}

function _notifShowFeedback(text, isError) {
    const el = document.getElementById('notif-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'notif-save-feedback' + (isError ? ' is-error' : ' is-success');
    clearTimeout(_notifFeedbackTimer);
    _notifFeedbackTimer = setTimeout(() => {
        if (el) { el.textContent = ''; el.className = 'notif-save-feedback'; }
    }, 2000);
}

function renderNotificationSettings() {
    const notif = (settings && settings.notifications) ? settings.notifications : {};
    const types = notif.types || {};
    const enabled = notif.enabled !== false; // default true for new installs

    const enabledEl = document.getElementById('notif-enabled');
    if (enabledEl) enabledEl.checked = enabled;

    const batteryEl = document.getElementById('notif-type-battery');
    if (batteryEl) batteryEl.checked = types.battery !== false;

    const warrantyEl = document.getElementById('notif-type-warranty');
    if (warrantyEl) warrantyEl.checked = types.warranty !== false;

    const backupEl = document.getElementById('notif-type-backup');
    if (backupEl) backupEl.checked = types.backup !== false;

    const testsEl = document.getElementById('notif-type-tests');
    if (testsEl) testsEl.checked = types.tests !== false;

    _notifUpdateMasterState(enabled);
}

async function _notifAutoSave() {
    const enabled = Boolean(document.getElementById('notif-enabled')?.checked);
    const battery = Boolean(document.getElementById('notif-type-battery')?.checked);
    const warranty = Boolean(document.getElementById('notif-type-warranty')?.checked);
    const backup = Boolean(document.getElementById('notif-type-backup')?.checked);
    const tests = Boolean(document.getElementById('notif-type-tests')?.checked);

    _notifUpdateMasterState(enabled);

    const notifications = { enabled, types: { battery, warranty, backup, tests } };
    try {
        await patchStorage({ settings: { notifications } });
        if (!settings) settings = {};
        settings.notifications = notifications;
        _notifShowFeedback('Saved', false);
    } catch (error) {
        _notifShowFeedback(error?.message || 'Failed to save', true);
    }
}
