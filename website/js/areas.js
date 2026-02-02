// Areas Page JavaScript

let allAreas = [];
let areas = [];
let allFloors = [];
let floors = [];
let editingAreaId = null;
let sortColumn = 'floor';
let sortDirection = 'asc';
let selectedHomeId = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const data = loadData();
    allAreas = data.areas;
    allFloors = data.floors;
    selectedHomeId = data.selectedHomeId;
    areas = allAreas.filter(area => area.homeId === selectedHomeId);
    floors = allFloors.filter(floor => floor.homeId === selectedHomeId);
    
    initializeEventListeners();
    updateFloorOptions();
    renderAreas();

    const params = new URLSearchParams(window.location.search);
    if (params.get('add') === '1') {
        openAreaForm();
    }
});

// Event Listeners
function initializeEventListeners() {
    document.getElementById('add-area-btn').addEventListener('click', (e) => {
        e.preventDefault();
        openAreaForm();
    });
    document.getElementById('area-modal-cancel').addEventListener('click', closeAreaForm);
    const modalOverlay = document.getElementById('area-modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (event) => {
            if (event.target === modalOverlay) {
                closeAreaForm();
            }
        });
    }
    document.getElementById('area-form').addEventListener('submit', handleAreaSubmit);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAreaForm();
        }
    });

    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');
            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortDirection = 'asc';
            }
            renderAreas();
        });
    });
}

// CRUD Operations
function createArea(name, floorId) {
    if (!floorId) {
        showAlert('Please select a floor for this area.');
        return null;
    }
    
    const area = {
        id: Date.now().toString(),
        name: name.trim(),
        floor: floorId,
        homeId: selectedHomeId,
        createdAt: new Date().toISOString()
    };
    allAreas.push(area);
    areas = allAreas.filter(item => item.homeId === selectedHomeId);
    saveData(getAllData());
    renderAreas();
    return area;
}

function updateArea(id, name, floorId) {
    if (!floorId) {
        showAlert('Please select a floor for this area.');
        return null;
    }
    
    const area = allAreas.find(a => a.id === id);
    if (area) {
        area.name = name.trim();
        area.floor = floorId;
        saveData(getAllData());
        areas = allAreas.filter(item => item.homeId === selectedHomeId);
        renderAreas();
        return area;
    }
    return null;
}

async function deleteArea(id) {
    const data = loadData();
    const devicesAssigned = data.devices.filter(d => d.area === id && d.homeId === selectedHomeId);
    
    if (devicesAssigned.length > 0) {
        showAlert(`Cannot delete this area. It has ${devicesAssigned.length} device${devicesAssigned.length !== 1 ? 's' : ''} assigned. Please remove or reassign the devices first.`, {
            title: 'Delete blocked'
        });
        return;
    }
    
    const confirmed = await showConfirm('Are you sure you want to delete this area?', {
        title: 'Delete area',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }
    allAreas = allAreas.filter(a => a.id !== id);
    areas = allAreas.filter(a => a.homeId === selectedHomeId);
    saveData(getAllData());
    renderAreas();
}

// Rendering
function renderAreas() {
    const areasList = document.getElementById('areas-list');
    const data = loadData();
    const devices = data.devices.filter(device => device.homeId === selectedHomeId);
    const countLabel = document.getElementById('areas-count');
    if (countLabel) {
        const count = areas.length;
        countLabel.textContent = `${count} area${count !== 1 ? 's' : ''}`;
    }
    
    if (areas.length === 0) {
        areasList.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state-cell">
                    <div class="empty-state">
                        <div class="empty-state-icon">🏠</div>
                        <div class="empty-state-text">No areas defined</div>
                        <div class="empty-state-subtext">Add your first area to organize your devices</div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    const deviceCounts = new Map();
    devices.forEach(device => {
        if (!device.area) return;
        deviceCounts.set(device.area, (deviceCounts.get(device.area) || 0) + 1);
    });

    const areaRows = areas.map(area => {
        const floor = area.floor ? getFloorById(floors, area.floor) : null;
        const floorLevel = floor && floor.level !== null ? floor.level : null;
        const floorName = floor ? floor.name : '—';
        const deviceCount = deviceCounts.get(area.id) || 0;
        return {
            area,
            floorName,
            floorLevel,
            deviceCount
        };
    });

    const sortedAreas = areaRows.sort((a, b) => {
        let aVal = '';
        let bVal = '';
        let isNumeric = false;

        if (sortColumn === 'name') {
            aVal = a.area.name || '';
            bVal = b.area.name || '';
        } else if (sortColumn === 'floor') {
            if (a.floorLevel !== null || b.floorLevel !== null) {
                aVal = a.floorLevel !== null ? a.floorLevel : Number.MAX_SAFE_INTEGER;
                bVal = b.floorLevel !== null ? b.floorLevel : Number.MAX_SAFE_INTEGER;
                isNumeric = true;
            } else {
                aVal = a.floorName || '';
                bVal = b.floorName || '';
            }
        } else if (sortColumn === 'devices') {
            aVal = a.deviceCount;
            bVal = b.deviceCount;
            isNumeric = true;
        }

        if (isNumeric) {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }

        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    document.querySelectorAll('.sortable').forEach(th => {
        const column = th.getAttribute('data-sort');
        th.classList.remove('sort-asc', 'sort-desc');
        if (column === sortColumn) {
            th.classList.add(`sort-${sortDirection}`);
        }
    });

    areasList.innerHTML = sortedAreas.map(({ area, floorName, deviceCount }) => {
        return `
            <tr>
                <td><strong>${escapeHtml(area.name)}</strong></td>
                <td>${escapeHtml(floorName)}</td>
                <td>${deviceCount} device${deviceCount !== 1 ? 's' : ''}</td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="editArea('${area.id}')" aria-label="Edit area" title="Edit area">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                            <path d="M13.5 6.5l4 4"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger btn-icon" onclick="deleteAreaHandler('${area.id}')" aria-label="Delete area" title="Delete area">
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

function updateFloorOptions() {
    const floorSelect = document.getElementById('area-floor');
    const currentValue = floorSelect ? floorSelect.value : '';
    
    if (floorSelect) {
        floorSelect.innerHTML = '<option value="">Select a floor</option>' + 
            floors.map(floor => `<option value="${floor.id}">${escapeHtml(floor.name)}</option>`).join('');
        if (currentValue) {
            floorSelect.value = currentValue;
        }
    }
}

// Form Functions
function openAreaForm(areaId = null) {
    editingAreaId = areaId;
    const modal = document.getElementById('area-modal');
    const form = document.getElementById('area-form');
    const title = document.getElementById('area-modal-title');
    
    updateFloorOptions();
    
    if (areaId) {
        const area = areas.find(a => a.id === areaId);
        if (area) {
            title.textContent = 'Edit Area';
            document.getElementById('area-name').value = area.name;
            document.getElementById('area-floor').value = area.floor || '';
        }
    } else {
        title.textContent = 'Add Area';
        form.reset();
    }
    
    if (modal) {
        modal.classList.remove('is-hidden');
        modal.setAttribute('aria-hidden', 'false');
    }
}

function closeAreaForm() {
    const modal = document.getElementById('area-modal');
    if (modal) {
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
    }
    editingAreaId = null;
    document.getElementById('area-form').reset();
}

function handleAreaSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('area-name').value;
    const floorId = document.getElementById('area-floor').value;
    
    if (!floorId) {
        showAlert('Please select a floor for this area.');
        return;
    }
    
    if (editingAreaId) {
        updateArea(editingAreaId, name, floorId);
    } else {
        createArea(name, floorId);
    }
    
    closeAreaForm();
}

// Global Functions (for onclick handlers)
window.editArea = function(id) {
    openAreaForm(id);
};

window.deleteAreaHandler = function(id) {
    deleteArea(id);
};

// Helper Functions
function getAllData() {
    return {
        ...loadData(),
        areas: allAreas
    };
}
