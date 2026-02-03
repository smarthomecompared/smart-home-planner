// Devices Page JavaScript

let allDevices = [];
let devices = [];
let areas = [];
let floors = [];
let settings = {};
let selectedHomeId = '';

// Pagination and Sorting
let currentPage = 1;
let pageSize = 25;
let sortColumn = null;
let sortDirection = 'asc';
let filteredDevices = [];
let viewMode = 'table';

const VIEW_STORAGE_KEY = 'smartHomeDevicesView';

// Device Filters instance
let deviceFilters = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const data = loadData();
    selectedHomeId = data.selectedHomeId;
    allDevices = data.devices;
    settings = loadSettings();
    areas = data.areas.filter(area => area.homeId === selectedHomeId);
    floors = data.floors.filter(floor => floor.homeId === selectedHomeId);
    devices = allDevices.filter(device => device.homeId === selectedHomeId);
    
    // Initialize filters
    deviceFilters = new DeviceFilters();
    deviceFilters.init(devices, areas, floors, settings);
    deviceFilters.onFilterChange = (filtered) => {
        filteredDevices = filtered;
        currentPage = 1;
        renderDevices();
    };
    
    initializeEventListeners();
    initializeViewToggle();
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
}

function initializeViewToggle() {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === 'table' || saved === 'grid') {
        viewMode = saved;
    } else {
        viewMode = window.innerWidth <= 640 ? 'grid' : 'table';
    }

    const buttons = Array.from(document.querySelectorAll('.view-toggle-btn'));
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const next = button.getAttribute('data-view');
            if (!next || next === viewMode) return;
            viewMode = next;
            localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
            updateViewToggle();
            updateViewVisibility();
            renderDevices();
        });
    });

    updateViewToggle();
    updateViewVisibility();

    window.addEventListener('resize', () => {
        if (localStorage.getItem(VIEW_STORAGE_KEY)) return;
        const next = window.innerWidth <= 640 ? 'grid' : 'table';
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
    if (tableContainer) {
        tableContainer.style.display = viewMode === 'table' ? '' : 'none';
    }
    if (grid) {
        grid.style.display = viewMode === 'grid' ? 'grid' : 'none';
    }
}

// CRUD Operations
function createDevice(deviceData) {
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
        brand: deviceData.brand.trim(),
        model: deviceData.model.trim(),
        type: deviceData.type.trim(),
        ip: deviceData.ip.trim() || '',
        mac: deviceData.mac.trim() || '',
        status: deviceData.status,
        power: deviceData.power,
        batteryType: deviceData.batteryType.trim() || '',
        connectivity: deviceData.connectivity,
        area: deviceData.area || '',
        homeId: deviceData.homeId || selectedHomeId,
        createdAt: new Date().toISOString()
    };
    allDevices.push(device);
    devices = allDevices.filter(item => item.homeId === selectedHomeId);
    saveData(getAllData());
    deviceFilters.updateData(devices, areas, floors, settings);
    deviceFilters.applyFilters(); // Reapply filters to update filteredDevices
    return device;
}

function updateDevice(id, deviceData) {
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
        device.brand = deviceData.brand.trim();
        device.model = deviceData.model.trim();
        device.type = deviceData.type.trim();
        device.ip = deviceData.ip.trim() || '';
        device.mac = deviceData.mac.trim() || '';
        device.status = deviceData.status;
        device.power = deviceData.power;
        device.batteryType = deviceData.batteryType.trim() || '';
        device.connectivity = deviceData.connectivity;
        device.area = deviceData.area || '';
        device.updatedAt = new Date().toISOString();
        device.homeId = deviceData.homeId || device.homeId || selectedHomeId;
        saveData(getAllData());
        devices = allDevices.filter(item => item.homeId === selectedHomeId);
        deviceFilters.updateData(devices, areas, floors, settings);
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
    // Remove the device
    allDevices = allDevices.filter(d => d.id !== id);
    devices = allDevices.filter(d => d.homeId === selectedHomeId);
    
    // Clean up port references in other devices
    allDevices.forEach(device => {
        if (device.ports && Array.isArray(device.ports)) {
            device.ports = device.ports.filter(port => port.connectedTo !== id);
        }
    });
    
    saveData(getAllData());
    deviceFilters.updateData(devices, areas, floors, settings);
    deviceFilters.applyFilters(); // Reapply filters to update filteredDevices
}

// Rendering
function renderDevices() {
    const countLabel = document.getElementById('devices-count');
    if (countLabel) {
        const count = filteredDevices.length;
        countLabel.textContent = `${count} device${count !== 1 ? 's' : ''}`;
    }

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
                <td colspan="7" class="empty-state">
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
            const areaName = device.area ? getAreaName(areas, device.area) : 'No area';
            const typeDisplay = formatDeviceType(device.type);
            return `
                <tr>
                    <td><strong>${escapeHtml(device.name || 'Unnamed')}</strong></td>
                    <td>${escapeHtml(areaName)}</td>
                    <td>${escapeHtml(device.brand)}</td>
                    <td>${escapeHtml(typeDisplay)}</td>
                    <td><span class="status-badge status-${device.status}">${device.status}</span></td>
                    <td>${escapeHtml(device.connectivity)}</td>
                    <td class="actions-cell">
                        <button class="btn btn-sm btn-secondary btn-icon" onclick="editDevice('${device.id}')" aria-label="Edit device" title="Edit device">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                                <path d="M13.5 6.5l4 4"></path>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-secondary btn-icon" onclick="duplicateDevice('${device.id}')" aria-label="Duplicate device" title="Duplicate device">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="9" y="9" width="10" height="10"></rect>
                                <rect x="5" y="5" width="10" height="10"></rect>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteDeviceHandler('${device.id}')" aria-label="Delete device" title="Delete device">
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
}

function renderDevicesGrid(devicesToRender) {
    const grid = document.getElementById('devices-grid');
    if (!grid) return;

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
        const areaName = device.area ? getAreaName(areas, device.area) : 'No area';
        const typeDisplay = formatDeviceType(device.type);
        const connectivity = device.connectivity
            ? device.connectivity.charAt(0).toUpperCase() + device.connectivity.slice(1).replace('-', ' ')
            : '—';
        const brand = device.brand || '—';
        return `
            <div class="device-card">
                <div class="device-card-header">
                    <div class="device-card-title">${escapeHtml(device.name || 'Unnamed')}</div>
                </div>
                <div class="device-card-meta">
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Area</span>
                        <span class="device-card-meta-value">${escapeHtml(areaName)}</span>
                    </div>
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Type</span>
                        <span class="device-card-meta-value">${escapeHtml(typeDisplay || '—')}</span>
                    </div>
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Brand</span>
                        <span class="device-card-meta-value">${escapeHtml(brand)}</span>
                    </div>
                    <div class="device-card-meta-row">
                        <span class="device-card-meta-label">Connectivity</span>
                        <span class="device-card-meta-value">${escapeHtml(connectivity)}</span>
                    </div>
                </div>
                <div class="device-card-actions">
                    <span class="device-card-status status-${device.status}" aria-label="${escapeHtml(device.status || '')}" title="${escapeHtml(device.status || '')}"></span>
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="editDevice('${device.id}')" aria-label="Edit device" title="Edit device">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                            <path d="M13.5 6.5l4 4"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="duplicateDevice('${device.id}')" aria-label="Duplicate device" title="Duplicate device">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="9" y="9" width="10" height="10"></rect>
                            <rect x="5" y="5" width="10" height="10"></rect>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger btn-icon" onclick="deleteDeviceHandler('${device.id}')" aria-label="Delete device" title="Delete device">
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
        'filter-status',
        'filter-type',
        'filter-connectivity',
        'filter-power',
        'filter-ups-protected',
        'filter-battery-type',
        'filter-local-only'
    ];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('is-active', Boolean(el.value));
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

window.duplicateDevice = function(id) {
    const device = devices.find(d => d.id === id);
    if (device) {
        // Create a copy with modified name
        const duplicateData = {
            ...device,
            name: `${device.name || 'Unnamed'} (Copy)`
        };
        // Store duplicate data temporarily and redirect
        sessionStorage.setItem('duplicateDevice', JSON.stringify(duplicateData));
        window.location.href = 'device-add.html?duplicate=true';
    }
};

window.deleteDeviceHandler = function(id) {
    deleteDevice(id);
};

// Helper Functions
function getAllData() {
    return {
        ...loadData(),
        devices: allDevices
    };
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

    if (batteryTypeParam) {
        const advancedFilters = document.getElementById('advanced-filters');
        advancedFilters.classList.remove('is-collapsed');
        document.getElementById('toggle-advanced-filters').textContent = 'Hide Advanced Filters';
        document.getElementById('filter-battery-type').value = batteryTypeParam;
    }
    if (typeParam) {
        document.getElementById('filter-type').value = typeParam;
    }
    if (connectivityParam) {
        document.getElementById('filter-connectivity').value = connectivityParam;
    }
    if (brandParam) {
        document.getElementById('filter-brand').value = brandParam;
    }
    if (integrationParam) {
        const advancedFilters = document.getElementById('advanced-filters');
        advancedFilters.classList.remove('is-collapsed');
        document.getElementById('toggle-advanced-filters').textContent = 'Hide Advanced Filters';
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
        const advancedFilters = document.getElementById('advanced-filters');
        advancedFilters.classList.remove('is-collapsed');
        document.getElementById('toggle-advanced-filters').textContent = 'Hide Advanced Filters';
        const localOnlySelect = document.getElementById('filter-local-only');
        if (localOnlyParam === 'true' || localOnlyParam === 'false') {
            localOnlySelect.value = localOnlyParam;
        }
    }

    if (upsProtectedParam) {
        const advancedFilters = document.getElementById('advanced-filters');
        advancedFilters.classList.remove('is-collapsed');
        document.getElementById('toggle-advanced-filters').textContent = 'Hide Advanced Filters';
        const upsProtectedSelect = document.getElementById('filter-ups-protected');
        if (upsProtectedParam === 'true' || upsProtectedParam === 'false') {
            upsProtectedSelect.value = upsProtectedParam;
        }
    }
}
