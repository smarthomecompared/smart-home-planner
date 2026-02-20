// Devices Page JavaScript

let allDevices = [];
let devices = [];
let areas = [];
let floors = [];
let networks = [];
let labels = [];
let settings = {};

// Pagination and Sorting
let currentPage = 1;
let pageSize = 25;
let sortColumn = null;
let sortDirection = 'asc';
let filteredDevices = [];
let viewMode = 'table';
let diagramReady = false;
let selectedDeviceIds = new Set();
let currentPageDeviceIds = [];
let bulkEditVisible = false;
const DEVICE_FILES_DELETE_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files') : '/api/device-files';
const HA_DEVICE_AREA_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-area') : '/api/ha/device-area';
const HA_DEVICE_LABELS_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-labels') : '/api/ha/device-labels';

const VIEW_STORAGE_KEYS = {
    desktop: 'smartHomeDevicesViewDesktop',
    mobile: 'smartHomeDevicesViewMobile'
};

function getViewStorageKey() {
    return window.innerWidth <= 640 ? VIEW_STORAGE_KEYS.mobile : VIEW_STORAGE_KEYS.desktop;
}

function getDefaultViewMode() {
    return window.innerWidth <= 640 ? 'grid' : 'table';
}

function normalizeDeviceFilePath(value) {
    return String(value || '').trim();
}

async function deleteDeviceFilesFromServer(files) {
    const items = Array.isArray(files) ? files : [];
    for (const item of items) {
        const path = normalizeDeviceFilePath(item && item.path);
        if (!path) continue;
        const url = `${DEVICE_FILES_DELETE_API_URL}?path=${encodeURIComponent(path)}`;
        try {
            await fetch(url, { method: 'DELETE' });
        } catch (error) {
            console.error(`Failed to remove file "${path}"`, error);
        }
    }
}

// Device Filters instance
let deviceFilters = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadData();
    allDevices = data.devices;
    settings = await loadSettings();
    areas = data.areas;
    floors = data.floors;
    networks = data.networks || [];
    labels = data.labels || [];
    devices = allDevices;
    applyAreaColumnVisibility();
    
    // Initialize filters
    deviceFilters = new DeviceFilters();
    deviceFilters.init(devices, areas, floors, networks, settings, labels);
    deviceFilters.onFilterChange = (filtered) => {
        filteredDevices = filtered;
        syncSelectionToFiltered();
        currentPage = 1;
        renderDevices();
        if (diagramReady && window.DeviceDiagram) {
            window.DeviceDiagram.setFilteredDevices(filteredDevices);
        }
    };
    
    initializeEventListeners();
    initializeBulkEdit();
    setBulkEditVisible(false, { skipRender: true, force: true });
    populateBulkEditOptions();
    await initializeViewToggle();
    applyQueryFilters();
    deviceFilters.applyFilters();
});

// Event Listeners
function initializeEventListeners() {
    // Pagination
    document.getElementById('prev-page-btn').addEventListener('click', () => goToPage(currentPage - 1));
    document.getElementById('next-page-btn').addEventListener('click', () => goToPage(currentPage + 1));
    document.getElementById('page-size').addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1;
        renderDevices();
    });
    
    // Sorting
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');
            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortDirection = 'asc';
            }
            currentPage = 1;
            renderDevices();
        });
    });

    const bulkToggle = document.getElementById("bulk-edit-toggle");
    if (bulkToggle) {
        bulkToggle.addEventListener("click", () => {
            setBulkEditVisible(!bulkEditVisible);
        });
    }

    const tableBody = document.getElementById('devices-table-body');
    if (tableBody) {
        tableBody.addEventListener('change', (event) => {
            const target = event.target;
            if (!target || !target.classList.contains('device-select')) return;
            const deviceId = target.dataset.deviceId;
            if (!deviceId) return;
            toggleDeviceSelection(deviceId, target.checked);
        });
    }

    const grid = document.getElementById('devices-grid');
    if (grid) {
        grid.addEventListener('change', (event) => {
            const target = event.target;
            if (!target || !target.classList.contains('device-select')) return;
            const deviceId = target.dataset.deviceId;
            if (!deviceId) return;
            toggleDeviceSelection(deviceId, target.checked);
        });
    }

    const selectAll = document.getElementById('select-all-page');
    if (selectAll) {
        selectAll.addEventListener('change', (event) => {
            if (!bulkEditVisible) {
                event.target.checked = false;
                return;
            }
            const shouldSelect = Boolean(event.target.checked);
            if (shouldSelect) {
                currentPageDeviceIds.forEach((id) => selectedDeviceIds.add(id));
            } else {
                currentPageDeviceIds.forEach((id) => selectedDeviceIds.delete(id));
            }
            updateBulkEditState();
            renderDevices();
        });
    }
}

function initializeBulkEdit() {
    const bulkField = document.getElementById('bulk-edit-field');
    const applyBtn = document.getElementById('bulk-apply-btn');

    if (bulkField) {
        bulkField.addEventListener('change', () => {
            updateBulkFieldVisibility();
            updateBulkEditState();
        });
    }

    document.querySelectorAll('.bulk-edit-field select').forEach((select) => {
        select.addEventListener('change', updateBulkEditState);
    });

    if (applyBtn) {
        applyBtn.addEventListener('click', handleBulkApply);
    }

    updateBulkFieldVisibility();
    updateBulkEditState();
}

async function initializeViewToggle() {
    const saved = await getUiPreference(getViewStorageKey());
    if (saved === 'table' || saved === 'grid' || saved === 'diagram') {
        viewMode = saved;
    } else {
        viewMode = getDefaultViewMode();
    }

    const buttons = Array.from(document.querySelectorAll('.view-toggle-btn'));
    buttons.forEach(button => {
        button.addEventListener('click', async () => {
            const next = button.getAttribute('data-view');
            if (!next || next === viewMode) return;
            viewMode = next;
            await setUiPreference(getViewStorageKey(), viewMode);
            updateViewToggle();
            updateViewVisibility();
            renderDevices();
        });
    });

    updateViewToggle();
    updateViewVisibility();

    window.addEventListener('resize', async () => {
        const savedNext = await getUiPreference(getViewStorageKey());
        const next = (savedNext === 'table' || savedNext === 'grid' || savedNext === 'diagram')
            ? savedNext
            : getDefaultViewMode();
        if (next === viewMode) return;
        viewMode = next;
        updateViewToggle();
        updateViewVisibility();
        renderDevices();
    });
}

function updateViewToggle() {
    document.querySelectorAll('.view-toggle-btn').forEach(button => {
        const isActive = button.getAttribute('data-view') === viewMode;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function updateViewVisibility() {
    const tableContainer = document.getElementById('devices-table-container');
    const grid = document.getElementById('devices-grid');
    const diagram = document.getElementById('diagram-section');
    const pagination = document.querySelector('.pagination-container');
    if (tableContainer) {
        tableContainer.style.display = viewMode === 'table' ? '' : 'none';
    }
    if (grid) {
        grid.style.display = viewMode === 'grid' ? 'grid' : 'none';
    }
    if (diagram) {
        diagram.style.display = viewMode === 'diagram' ? 'block' : 'none';
    }
    if (pagination) {
        pagination.style.display = viewMode === 'diagram' ? 'none' : '';
    }

    if (viewMode === 'diagram') {
        ensureDiagramReady();
        if (window.DeviceDiagram) {
            window.DeviceDiagram.setVisible(true);
            window.DeviceDiagram.setFilteredDevices(filteredDevices);
        }
    } else if (diagramReady && window.DeviceDiagram) {
        window.DeviceDiagram.setVisible(false);
    }

    updateBulkEditAvailability();
}

function updateBulkFieldVisibility() {
    const fieldValue = document.getElementById('bulk-edit-field')?.value || '';
    document.querySelectorAll('.bulk-edit-field').forEach((group) => {
        const supportedFields = (group.dataset.bulkField || '')
            .split(/\s+/)
            .map(value => value.trim())
            .filter(Boolean);
        const shouldShow = supportedFields.includes(fieldValue);
        group.classList.toggle('is-collapsed', !shouldShow);
    });
}

function setBulkEditVisible(isVisible, options = {}) {
    const shouldShow = Boolean(isVisible);
    if (bulkEditVisible === shouldShow && !options.force) return;
    bulkEditVisible = shouldShow;
    document.body.classList.toggle("bulk-edit-active", bulkEditVisible);
    const bulkToggle = document.getElementById("bulk-edit-toggle");
    if (bulkToggle) {
        bulkToggle.setAttribute("aria-pressed", bulkEditVisible ? "true" : "false");
        bulkToggle.classList.toggle("is-active", bulkEditVisible);
    }
    if (!bulkEditVisible) {
        selectedDeviceIds.clear();
    }
    updateBulkEditState();
    if (!options.skipRender) {
        renderDevices();
    }
}

function updateBulkEditAvailability() {
    const isDiagram = viewMode === "diagram";
    document.body.classList.toggle("diagram-view", isDiagram);
    const bulkToggle = document.getElementById("bulk-edit-toggle");
    if (bulkToggle) {
        bulkToggle.hidden = isDiagram;
    }
    if (isDiagram && bulkEditVisible) {
        setBulkEditVisible(false, { skipRender: true, force: true });
    }
}

function updateBulkEditState() {
    const countLabel = document.getElementById('bulk-edit-count');
    const applyBtn = document.getElementById('bulk-apply-btn');
    const selectAll = document.getElementById('select-all-page');
    const selectedCount = selectedDeviceIds.size;
    if (countLabel) {
        countLabel.textContent = `${selectedCount} selected`;
    }

    if (selectAll) {
        const totalOnPage = currentPageDeviceIds.length;
        const selectedOnPage = currentPageDeviceIds.filter((id) => selectedDeviceIds.has(id)).length;
        selectAll.checked = totalOnPage > 0 && selectedOnPage === totalOnPage;
        selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < totalOnPage;
    }

    if (applyBtn) {
        applyBtn.disabled = !bulkEditVisible || selectedCount === 0 || !getBulkEditValue().isValid;
    }
}

function toggleDeviceSelection(deviceId, isSelected) {
    if (!bulkEditVisible) return;
    if (!deviceId) return;
    if (isSelected) {
        selectedDeviceIds.add(deviceId);
    } else {
        selectedDeviceIds.delete(deviceId);
    }
    updateBulkEditState();
}

function syncSelectionToFiltered() {
    const visibleIds = new Set(filteredDevices.map((device) => device.id));
    let changed = false;
    selectedDeviceIds.forEach((id) => {
        if (!visibleIds.has(id)) {
            selectedDeviceIds.delete(id);
            changed = true;
        }
    });
    if (changed) {
        updateBulkEditState();
    }
}

function getBulkEditValue() {
    const field = document.getElementById('bulk-edit-field')?.value || '';
    const selectValue = (id) => document.getElementById(id)?.value || '';
    let value = '';
    if (field === 'installed-area') {
        value = selectValue('bulk-installed-area');
    } else if (field === 'controlled-area') {
        value = selectValue('bulk-controlled-area');
    } else if (field === 'labels-add' || field === 'labels-remove') {
        value = selectValue('bulk-labels');
    } else if (field === 'type') {
        value = selectValue('bulk-type');
    } else if (field === 'brand') {
        value = selectValue('bulk-brand');
    } else if (field === 'status') {
        value = selectValue('bulk-status');
    }
    const isValid = Boolean(field && value);
    return { field, value, isValid };
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

function populateBulkEditOptions() {
    const installedSelect = document.getElementById('bulk-installed-area');
    const controlledSelect = document.getElementById('bulk-controlled-area');
    const labelSelect = document.getElementById('bulk-labels');
    const typeSelect = document.getElementById('bulk-type');
    const brandSelect = document.getElementById('bulk-brand');

    const sortedAreas = [...areas].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    );
    const areaOptions = sortedAreas
        .map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`)
        .join('');

    if (installedSelect) {
        installedSelect.innerHTML = areaOptions +
            '<option value="__clear__">Clear area</option>';
    }
    if (controlledSelect) {
        controlledSelect.innerHTML = areaOptions +
            '<option value="__clear__">Clear area</option>';
    }

    if (labelSelect) {
        const labelOptions = (labels || [])
            .map(label => ({
                id: normalizeLabelId(label.id || label.label_id),
                name: String(label.name || '').trim()
            }))
            .filter(option => option.id)
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }));
        labelSelect.innerHTML = labelOptions
            .map(option => `<option value="${option.id}">${escapeHtml(option.name || option.id)}</option>`)
            .join('');
    }

    if (typeSelect) {
        const configuredTypes = settings.types || [];
        const deviceTypes = [...new Set(devices.map(d => d.type).filter(Boolean))];
        const typeOptions = buildFriendlyOptions(configuredTypes, deviceTypes, formatDeviceType);
        typeSelect.innerHTML = typeOptions.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('') +
            '<option value="__clear__">Clear type</option>';
    }

    if (brandSelect) {
        const configuredBrands = settings.brands || [];
        const deviceBrands = [...new Set(devices.map(d => d.brand).filter(Boolean))];
        const brandOptions = buildFriendlyOptions(configuredBrands, deviceBrands, formatDeviceType);
        brandSelect.innerHTML = brandOptions.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('') +
            '<option value="__clear__">Clear brand</option>';
    }
}

function getHaAreaSyncTarget() {
    return settings?.haAreaSyncTarget === 'controlled' ? 'controlled' : 'installed';
}

function applyAreaColumnVisibility() {
    const tableContainer = document.getElementById('devices-table-container');
    if (!tableContainer) return;
    const target = getHaAreaSyncTarget();
    tableContainer.classList.remove('area-target-installed', 'area-target-controlled');
    tableContainer.classList.add(`area-target-${target}`);
}

function ensureDiagramReady() {
    if (diagramReady) return;
    if (!window.DeviceDiagram) return;
    const mapContainer = document.getElementById('network-map');
    if (!mapContainer) return;
    window.DeviceDiagram.init({
        devices,
        areas,
        floors,
        networks,
        settings,
        filteredDevices
    });
    diagramReady = true;
}

// CRUD Operations
async function createDevice(deviceData) {
    // Validate unique name
    const name = deviceData.name.trim();
    if (!name) {
        showAlert('Device name is required.');
        return null;
    }
    
    if (allDevices.some(d => d.name && d.name.toLowerCase() === name.toLowerCase())) {
        showAlert('A device with this name already exists. Please choose a different name.');
        return null;
    }
    
    const device = {
        id: Date.now().toString(),
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
        connectivity: normalizeOptionValue(deviceData.connectivity),
        area: deviceData.area || '',
        createdAt: new Date().toISOString()
    };
    allDevices.push(device);
    devices = allDevices;
    await saveData(await getAllData());
    deviceFilters.updateData(devices, areas, floors, networks, settings, labels);
    if (diagramReady && window.DeviceDiagram) {
        window.DeviceDiagram.updateData({ devices, areas, floors, networks, settings });
    }
    deviceFilters.applyFilters(); // Reapply filters to update filteredDevices
    return device;
}

async function updateDevice(id, deviceData) {
    // Validate unique name
    const name = deviceData.name.trim();
    if (!name) {
        showAlert('Device name is required.');
        return null;
    }
    
    if (allDevices.some(d => d.name && d.name.toLowerCase() === name.toLowerCase() && d.id !== id)) {
        showAlert('A device with this name already exists. Please choose a different name.');
        return null;
    }
    
    const device = allDevices.find(d => d.id === id);
    if (device) {
        device.name = name;
        device.brand = normalizeOptionValue(deviceData.brand);
        device.model = deviceData.model.trim();
        device.type = normalizeOptionValue(deviceData.type);
        if (deviceData.labels !== undefined) {
            device.labels = normalizeLabelList(deviceData.labels);
        }
        device.ip = deviceData.ip.trim() || '';
        device.mac = deviceData.mac.trim() || '';
        device.status = deviceData.status;
        device.power = deviceData.power;
        device.batteryType = normalizeOptionValue(deviceData.batteryType);
        device.connectivity = normalizeOptionValue(deviceData.connectivity);
        device.area = deviceData.area || '';
        device.updatedAt = new Date().toISOString();
        await saveData(await getAllData());
        devices = allDevices;
        deviceFilters.updateData(devices, areas, floors, networks, settings, labels);
        if (diagramReady && window.DeviceDiagram) {
            window.DeviceDiagram.updateData({ devices, areas, floors, networks, settings });
        }
        deviceFilters.applyFilters(); // Reapply filters to update filteredDevices
        return device;
    }
    return null;
}

async function deleteDevice(id) {
    const confirmed = await showConfirm('Are you sure you want to delete this device?', {
        title: 'Delete device',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }

    try {
        await addDeviceToExcludedListIfInHa(id);
    } catch (error) {
        console.error('Failed to add device to excluded_devices:', error);
    }

    const deviceToDelete = allDevices.find(d => d.id === id);
    if (deviceToDelete) {
        await deleteDeviceFilesFromServer(deviceToDelete.files);
    }

    // Remove the device
    allDevices = allDevices.filter(d => d.id !== id);
    devices = allDevices;
    selectedDeviceIds.delete(id);
    
    // Clean up port references in other devices
    allDevices.forEach(device => {
        if (device.ports && Array.isArray(device.ports)) {
            device.ports = device.ports.filter(port => port.connectedTo !== id);
        }
    });
    
    await saveData(await getAllData());
    deviceFilters.updateData(devices, areas, floors, networks, settings, labels);
    if (diagramReady && window.DeviceDiagram) {
        window.DeviceDiagram.updateData({ devices, areas, floors, networks, settings });
    }
    deviceFilters.applyFilters(); // Reapply filters to update filteredDevices
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

async function syncDeviceLabelsToHa(deviceId, labelIds) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) {
        return;
    }
    const normalizedLabels = normalizeLabelList(labelIds);

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

async function handleBulkApply() {
    const { field, value, isValid } = getBulkEditValue();
    if (!isValid) {
        return;
    }
    const ids = Array.from(selectedDeviceIds);
    if (ids.length === 0) {
        showAlert('Select at least one device for bulk edit.');
        return;
    }

    const areaSyncTarget = getHaAreaSyncTarget();
    const shouldSyncArea = (field === 'installed-area' && areaSyncTarget === 'installed') ||
        (field === 'controlled-area' && areaSyncTarget === 'controlled');
    const shouldSyncLabels = field === 'labels-add' || field === 'labels-remove';

    const selectedSet = new Set(ids);
    const validLabelIds = new Set(
        (labels || [])
            .map(label => normalizeLabelId(label.id || label.label_id))
            .filter(Boolean)
    );
    const updatedDevices = allDevices.map((device) => {
        if (!selectedSet.has(device.id)) return device;
        const next = { ...device };
        if (field === 'installed-area') {
            next.area = value === '__clear__' ? '' : value;
        } else if (field === 'controlled-area') {
            next.controlledArea = value === '__clear__' ? '' : value;
        } else if (field === 'labels-add') {
            const normalizedLabel = normalizeLabelId(value);
            const existingLabels = normalizeLabelList(next.labels);
            if (normalizedLabel && validLabelIds.has(normalizedLabel) && !existingLabels.includes(normalizedLabel)) {
                existingLabels.push(normalizedLabel);
            }
            next.labels = existingLabels;
        } else if (field === 'labels-remove') {
            const normalizedLabel = normalizeLabelId(value);
            const existingLabels = normalizeLabelList(next.labels);
            if (normalizedLabel) {
                next.labels = existingLabels.filter(label => label !== normalizedLabel);
            } else {
                next.labels = existingLabels;
            }
        } else if (field === 'type') {
            next.type = value === '__clear__' ? '' : normalizeOptionValue(value);
        } else if (field === 'brand') {
            next.brand = value === '__clear__' ? '' : normalizeOptionValue(value);
        } else if (field === 'status') {
            next.status = value;
        }
        next.updatedAt = new Date().toISOString();
        return next;
    });

    allDevices = updatedDevices;
    devices = allDevices;
    await saveData(await getAllData());

    const haFailures = [];
    if (shouldSyncArea || shouldSyncLabels) {
        for (const device of updatedDevices) {
            if (!selectedSet.has(device.id)) continue;
            if (!isHomeAssistantLinked(device.homeAssistant)) continue;
            try {
                if (shouldSyncArea) {
                    const areaValue = field === 'installed-area' ? device.area : device.controlledArea;
                    await syncDeviceAreaToHa(device.id, areaValue);
                }
                if (shouldSyncLabels) {
                    await syncDeviceLabelsToHa(device.id, device.labels);
                }
            } catch (error) {
                haFailures.push({
                    id: device.id,
                    name: device.name || device.id,
                    error: error?.message || String(error)
                });
            }
        }
    }

    deviceFilters.updateData(devices, areas, floors, networks, settings, labels);
    deviceFilters.applyFilters();
    renderDevices();
    populateBulkEditOptions();

    if (haFailures.length > 0) {
        const names = haFailures.map(item => item.name).join(', ');
        await showAlert(`Bulk edit saved locally, but Home Assistant sync failed for: ${names}`, {
            title: 'Home Assistant Sync Failed'
        });
        return;
    }

    showToast('Bulk edit applied to selected devices.');
}

// Rendering
function renderDevices() {
    const countLabel = document.getElementById('devices-count');
    if (countLabel) {
        const count = filteredDevices.length;
        countLabel.textContent = `${count} device${count !== 1 ? 's' : ''}`;
    }
    const labelNameMap = buildLabelNameMap(labels);
    const labelMetaMap = buildLabelMetaMap(labels);

    // Sort devices
    let sortedDevices = [...filteredDevices];
    if (sortColumn) {
        sortedDevices.sort((a, b) => {
            let aVal = a[sortColumn] || '';
            let bVal = b[sortColumn] || '';
            
            // Special handling for area (convert to name)
            if (sortColumn === 'area') {
                aVal = a.area ? getAreaName(areas, a.area) : '';
                bVal = b.area ? getAreaName(areas, b.area) : '';
            }

            if (sortColumn === 'controlledArea') {
                aVal = a.controlledArea ? getAreaName(areas, a.controlledArea) : '';
                bVal = b.controlledArea ? getAreaName(areas, b.controlledArea) : '';
            }

            if (sortColumn === 'homeAssistant') {
                aVal = isHomeAssistantLinked(a.homeAssistant) ? 1 : 0;
                bVal = isHomeAssistantLinked(b.homeAssistant) ? 1 : 0;
                if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            }

            if (sortColumn === 'labels') {
                aVal = formatDeviceLabels(a, labelNameMap);
                bVal = formatDeviceLabels(b, labelNameMap);
            }
            
            // Handle name field
            if (sortColumn === 'name') {
                aVal = a.name || '';
                bVal = b.name || '';
            }
            
            // Convert to string for comparison
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
            
            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    // Calculate pagination
    const totalPages = Math.ceil(sortedDevices.length / pageSize);
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, sortedDevices.length);
    const paginatedDevices = sortedDevices.slice(startIndex, endIndex);
    currentPageDeviceIds = paginatedDevices.map((device) => device.id);
    
    // Update sort icons
    document.querySelectorAll('.sortable').forEach(th => {
        const column = th.getAttribute('data-sort');
        th.classList.remove('sort-asc', 'sort-desc');
        if (column === sortColumn) {
            th.classList.add(`sort-${sortDirection}`);
        }
    });
    
    // Render table
    const tbody = document.getElementById('devices-table-body');
    
    if (paginatedDevices.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                        <div style="text-align: center; padding: 2rem;">
                        <div class="empty-state-icon">🔌</div>
                        <div class="empty-state-text">No devices found</div>
                        <div class="empty-state-subtext">${devices.length === 0 ? 'Add your first device to get started' : 'Try adjusting your filters'}</div>
                    </div>
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = paginatedDevices.map(device => {
            const areaName = device.area ? getAreaName(areas, device.area) : '-';
            const controlledAreaName = device.controlledArea ? getAreaName(areas, device.controlledArea) : '-';
            const typeDisplay = getFriendlyOption(settings.types, device.type, formatDeviceType);
            const brandDisplay = getFriendlyOption(settings.brands, device.brand, formatDeviceType) || '-';
            const modelDisplay = device.model ? device.model.trim() : '-';
            const labelChips = renderDeviceLabelChips(device, labelMetaMap);
            const isHaEnabled = isHomeAssistantLinked(device.homeAssistant);
            const normalizedStatus = normalizeStatusValue(device.status);
            const statusLabel = formatStatusLabel(normalizedStatus);
            return `
                <tr>
                    <td class="col-select">
                        <label class="table-select">
                            <input type="checkbox" class="device-select" data-device-id="${device.id}" ${selectedDeviceIds.has(device.id) ? 'checked' : ''} aria-label="Select device">
                        </label>
                    </td>
                    <td><strong>${escapeHtml(device.name || 'Unnamed')}</strong></td>
                    <td class="col-optional-lg">
                        ${labelChips ? `<div class="device-labels-inline">${labelChips}</div>` : '<span class="table-empty-value">-</span>'}
                    </td>
                    <td class="table-col-ha col-optional-md">
                        ${isHaEnabled
                            ? `<span class="ha-enabled-icon ha-enabled-icon-table" title="Home Assistant enabled" aria-label="Home Assistant enabled">
                                <img src="img/ha.png" alt="Home Assistant" loading="lazy">
                            </span>`
                            : '<span class="table-empty-value">-</span>'}
                    </td>
                    <td class="col-area-installed">${escapeHtml(areaName)}</td>
                    <td class="col-area-controlled">${escapeHtml(controlledAreaName)}</td>
                    <td>${escapeHtml(brandDisplay)}</td>
                    <td>${escapeHtml(modelDisplay)}</td>
                    <td>${escapeHtml(typeDisplay)}</td>
                    <td><span class="status-badge status-${normalizedStatus}">${escapeHtml(statusLabel)}</span></td>
                    <td class="actions-cell">
                        <button class="btn btn-sm btn-secondary btn-icon" onclick="editDevice('${device.id}')" aria-label="Edit" title="Edit">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                                <path d="M13.5 6.5l4 4"></path>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-secondary btn-icon" onclick="duplicateDevice('${device.id}')" aria-label="Duplicate" title="Duplicate">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="9" y="9" width="10" height="10"></rect>
                                <rect x="5" y="5" width="10" height="10"></rect>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteDeviceHandler('${device.id}')" aria-label="Delete" title="Delete">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3 6h18"></path>
                                <path d="M8 6V4h8v2"></path>
                                <path d="M6 6l1 14h10l1-14"></path>
                                <path d="M10 11v6"></path>
                                <path d="M14 11v6"></path>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    renderDevicesGrid(paginatedDevices);

    // Update pagination controls
    updatePaginationControls(totalPages, startIndex, endIndex, sortedDevices.length);
    updateBulkEditState();
}

function renderDevicesGrid(devicesToRender) {
    const grid = document.getElementById('devices-grid');
    if (!grid) return;
    const labelNameMap = buildLabelNameMap(labels);
    const labelMetaMap = buildLabelMetaMap(labels);

    if (!devicesToRender.length) {
        grid.innerHTML = `
            <div class="device-card">
                <div class="empty-state">
                    <div class="empty-state-icon">🔌</div>
                    <div class="empty-state-text">No devices found</div>
                    <div class="empty-state-subtext">${devices.length === 0 ? 'Add your first device to get started' : 'Try adjusting your filters'}</div>
                </div>
            </div>
        `;
        return;
    }

    grid.innerHTML = devicesToRender.map(device => {
        const areaName = device.area ? getAreaName(areas, device.area) : '-';
        const controlledAreaName = device.controlledArea ? getAreaName(areas, device.controlledArea) : '-';
        const typeDisplay = getFriendlyOption(settings.types, device.type, formatDeviceType) || '-';
        const labelChips = renderDeviceLabelChips(device, labelMetaMap);
        const brand = getFriendlyOption(settings.brands, device.brand, formatDeviceType) || '-';
        const isHaEnabled = isHomeAssistantLinked(device.homeAssistant);
        const normalizedStatus = normalizeStatusValue(device.status);
        const statusLabel = formatStatusLabel(normalizedStatus);
        return `
            <div class="device-card${isHaEnabled ? ' has-ha' : ''}">
                <div class="device-card-header">
                    <div class="device-card-title">${escapeHtml(device.name || 'Unnamed')}</div>
                </div>
                <div class="device-card-meta">
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Installed Area</span>
                        <span class="device-card-meta-value">${escapeHtml(areaName)}</span>
                    </div>
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Controlled Area</span>
                        <span class="device-card-meta-value">${escapeHtml(controlledAreaName)}</span>
                    </div>
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Type</span>
                        <span class="device-card-meta-value">${escapeHtml(typeDisplay || '—')}</span>
                    </div>
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Brand</span>
                        <span class="device-card-meta-value">${escapeHtml(brand)}</span>
                    </div>
                </div>
                <div class="device-card-actions">
                    <div class="device-card-indicators">
                        <span class="device-card-status status-${normalizedStatus}" data-status="${escapeHtml(statusLabel)}" aria-label="${escapeHtml(statusLabel)}"></span>
                        ${isHaEnabled
                            ? `<span class="ha-enabled-icon device-card-ha-icon device-card-ha-badge" data-tooltip="Integrated with Home Assistant" aria-label="Integrated with Home Assistant" tabindex="0">
                                <img src="img/ha.png" alt="Home Assistant" loading="lazy">
                              </span>`
                            : ''}
                    </div>
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="editDevice('${device.id}')" aria-label="Edit" title="Edit">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                            <path d="M13.5 6.5l4 4"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="duplicateDevice('${device.id}')" aria-label="Duplicate" title="Duplicate">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="9" y="9" width="10" height="10"></rect>
                            <rect x="5" y="5" width="10" height="10"></rect>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger btn-icon" onclick="deleteDeviceHandler('${device.id}')" aria-label="Delete" title="Delete">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18"></path>
                            <path d="M8 6V4h8v2"></path>
                            <path d="M6 6l1 14h10l1-14"></path>
                            <path d="M10 11v6"></path>
                            <path d="M14 11v6"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function formatStatusLabel(status) {
    const normalizedStatus = normalizeStatusValue(status);
    return normalizedStatus
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function normalizeStatusValue(status) {
    const normalized = String(status || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');

    if (['working', 'pending', 'wishlist', 'not-working'].includes(normalized)) {
        return normalized;
    }

    return 'pending';
}

function formatPowerLabel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '-';
    if (normalized === 'wired') return 'Wired';
    if (normalized === 'battery') return 'Battery';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isHomeAssistantLinked(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function updatePaginationControls(totalPages, startIndex, endIndex, totalItems) {
    // Update info
    document.getElementById('pagination-info').textContent = 
        `Showing ${startIndex + 1}-${endIndex} of ${totalItems}`;
    
    // Update buttons
    document.getElementById('prev-page-btn').disabled = currentPage === 1;
    document.getElementById('next-page-btn').disabled = currentPage === totalPages || totalPages === 0;
    
    // Update page numbers
    const pageNumbers = document.getElementById('page-numbers');
    pageNumbers.innerHTML = '';
    
    if (totalPages === 0) return;
    
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.className = 'page-number';
        firstBtn.textContent = '1';
        firstBtn.onclick = () => goToPage(1);
        pageNumbers.appendChild(firstBtn);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 0.5rem';
            pageNumbers.appendChild(ellipsis);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = 'page-number' + (i === currentPage ? ' active' : '');
        btn.textContent = i;
        btn.onclick = () => goToPage(i);
        pageNumbers.appendChild(btn);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 0.5rem';
            pageNumbers.appendChild(ellipsis);
        }
        
        const lastBtn = document.createElement('button');
        lastBtn.className = 'page-number';
        lastBtn.textContent = totalPages;
        lastBtn.onclick = () => goToPage(totalPages);
        pageNumbers.appendChild(lastBtn);
    }
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredDevices.length / pageSize);
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderDevices();
    }
}

// Filter Functions (now handled by DeviceFilters module)

function updateActiveFilters() {
    const nameInput = document.getElementById('filter-name');
    nameInput.classList.toggle('is-active', Boolean(nameInput.value.trim()));

    const selects = [
        'filter-floor',
        'filter-area',
        'filter-brand',
        'filter-model',
        'filter-status',
        'filter-type',
        'filter-connectivity',
        'filter-labels',
        'filter-network',
        'filter-power',
        'filter-ups-protected',
        'filter-battery-type',
        'filter-local-only'
    ];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.multiple) {
            const hasSelection = Array.from(el.selectedOptions || []).length > 0;
            el.classList.toggle('is-active', hasSelection);
            if (id === 'filter-labels') {
                const picker = document.getElementById('filter-labels-picker');
                if (picker) {
                    picker.classList.toggle('is-active', hasSelection);
                }
            }
        } else {
            el.classList.toggle('is-active', Boolean(el.value));
        }
    });

    const checkboxFilters = [
        'filter-thread-border-router',
        'filter-matter-hub',
        'filter-zigbee-controller',
        'filter-zigbee-repeater',
        'filter-home-assistant',
        'filter-google-home',
        'filter-alexa',
        'filter-apple-home-kit',
        'filter-samsung-smartthings'
    ];
    checkboxFilters.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const label = input.closest('label');
        if (label) {
            label.classList.toggle('is-active', input.checked);
        }
    });
}

// Form functions removed - now handled in device-form.js on separate pages

// Global Functions (for onclick handlers)
window.editDevice = function(id) {
    window.location.href = `device-edit.html?id=${id}`;
};

window.duplicateDevice = async function(id) {
    const device = devices.find(d => d.id === id);
    if (device) {
        // Create a copy with modified name
        const duplicateData = {
            ...device,
            name: `${device.name || 'Unnamed'} (Copy)`
        };
        // Store duplicate data temporarily and redirect
        await setUiPreference('duplicateDevice', duplicateData);
        window.location.href = 'device-add.html?duplicate=true';
    }
};

window.deleteDeviceHandler = async function(id) {
    await deleteDevice(id);
};

// Helper Functions
async function getAllData() {
    return {
        ...(await loadData()),
        devices: allDevices
    };
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

function buildLabelNameMap(labelItems) {
    const map = new Map();
    (labelItems || []).forEach((label) => {
        if (!label || typeof label !== 'object') return;
        const id = normalizeLabelId(label.id || label.label_id);
        if (!id || map.has(id)) return;
        const name = String(label.name || '').trim() || id;
        map.set(id, name);
    });
    return map;
}

function formatDeviceLabels(device, labelNameMap) {
    const labelIds = normalizeLabelList(device && device.labels);
    if (!labelIds.length) {
        return '-';
    }
    const names = labelIds
        .map((id) => labelNameMap.get(id) || id)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return names.join(', ');
}

function buildLabelMetaMap(labelItems) {
    const map = new Map();
    (labelItems || []).forEach((label) => {
        if (!label || typeof label !== 'object') return;
        const id = normalizeLabelId(label.id || label.label_id);
        if (!id || map.has(id)) return;
        const name = String(label.name || '').trim() || id;
        const color = typeof resolveLabelColor === 'function' ? resolveLabelColor(label.color) : String(label.color || '').trim();
        map.set(id, {
            id,
            name,
            color
        });
    });
    return map;
}

function renderDeviceLabelChips(device, labelMetaMap) {
    const labelIds = normalizeLabelList(device && device.labels);
    if (!labelIds.length) {
        return '';
    }
    const orderedLabels = labelIds
        .map((id) => {
            const meta = labelMetaMap.get(id) || { id, name: id, color: '' };
            return {
                id,
                name: meta.name || id,
                color: meta.color || ''
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return orderedLabels
        .map((meta) => {
            const colorStyle = meta.color ? ` style="--label-color: ${meta.color};"` : '';
            const colorClass = meta.color ? ' has-color' : '';
            return `
                <span class="label-chip label-chip-compact label-chip-static${colorClass}"${colorStyle}>
                    <span class="label-chip-body">
                        <span class="label-swatch"></span>
                        <span class="label-name">${escapeHtml(meta.name)}</span>
                    </span>
                </span>
            `;
        })
        .join('');
}

function formatDeviceType(typeSlug) {
    if (!typeSlug) return '';
    
    // Convert slug to readable format (e.g., "air-quality-monitors" -> "Air Quality Monitors")
    return typeSlug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function applyQueryFilters() {
    const params = new URLSearchParams(window.location.search);
    const batteryTypeParam = params.get('batteryType');
    const typeParam = params.get('type');
    const connectivityParam = params.get('connectivity');
    const brandParam = params.get('brand');
    const integrationParam = params.get('integration');
    const localOnlyParam = params.get('localOnly');
    const upsProtectedParam = params.get('upsProtected');
    const advancedFilters = document.getElementById('advanced-filters');
    const filtersContainer = document.querySelector('.filters-container');
    const toggleBtn = document.getElementById('toggle-advanced-filters');

    if (batteryTypeParam) {
        if (advancedFilters) advancedFilters.classList.remove('is-collapsed');
        if (filtersContainer) filtersContainer.classList.remove('is-collapsed');
        if (toggleBtn) {
            toggleBtn.classList.add('is-expanded');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        document.getElementById('filter-battery-type').value = normalizeOptionValue(batteryTypeParam);
    }
    if (typeParam) {
        document.getElementById('filter-type').value = normalizeOptionValue(typeParam);
    }
    if (connectivityParam) {
        document.getElementById('filter-connectivity').value = normalizeOptionValue(connectivityParam);
    }
    if (brandParam) {
        document.getElementById('filter-brand').value = normalizeOptionValue(brandParam);
    }
    if (integrationParam) {
        if (advancedFilters) advancedFilters.classList.remove('is-collapsed');
        if (filtersContainer) filtersContainer.classList.remove('is-collapsed');
        if (toggleBtn) {
            toggleBtn.classList.add('is-expanded');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        const integrationMap = {
            homeAssistant: 'filter-home-assistant',
            googleHome: 'filter-google-home',
            alexa: 'filter-alexa',
            appleHomeKit: 'filter-apple-home-kit',
            samsungSmartThings: 'filter-samsung-smartthings',
            localOnly: 'filter-local-only'
        };
        const targetId = integrationMap[integrationParam];
        if (targetId) {
            if (targetId === 'filter-local-only') {
                document.getElementById(targetId).value = 'true';
            } else {
                document.getElementById(targetId).checked = true;
            }
        }
    }

    if (localOnlyParam) {
        if (advancedFilters) advancedFilters.classList.remove('is-collapsed');
        if (filtersContainer) filtersContainer.classList.remove('is-collapsed');
        if (toggleBtn) {
            toggleBtn.classList.add('is-expanded');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        const localOnlySelect = document.getElementById('filter-local-only');
        if (localOnlyParam === 'true' || localOnlyParam === 'false') {
            localOnlySelect.value = localOnlyParam;
        }
    }

    if (upsProtectedParam) {
        if (advancedFilters) advancedFilters.classList.remove('is-collapsed');
        if (filtersContainer) filtersContainer.classList.remove('is-collapsed');
        if (toggleBtn) {
            toggleBtn.classList.add('is-expanded');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        const upsProtectedSelect = document.getElementById('filter-ups-protected');
        if (upsProtectedParam === 'true' || upsProtectedParam === 'false') {
            upsProtectedSelect.value = upsProtectedParam;
        }
    }
}
