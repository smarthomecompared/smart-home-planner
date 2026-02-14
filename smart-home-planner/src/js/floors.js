// Floors Page JavaScript

let allFloors = [];
let floors = [];
let editingFloorId = null;
let sortColumn = 'level';
let sortDirection = 'asc';
let viewMode = 'table';

const VIEW_STORAGE_KEY = 'smartHomeFloorsView';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadData();
    allFloors = data.floors;
    floors = allFloors;
    
    initializeEventListeners();
    await initializeViewToggle();
    await renderFloors();

    const params = new URLSearchParams(window.location.search);
    if (params.get('add') === '1') {
        openFloorForm();
    }
});

// Event Listeners
function initializeEventListeners() {
    document.getElementById('add-floor-btn').addEventListener('click', (e) => {
        e.preventDefault();
        openFloorForm();
    });
    document.getElementById('floor-modal-cancel').addEventListener('click', closeFloorForm);
    const modalOverlay = document.getElementById('floor-modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (event) => {
            if (event.target === modalOverlay) {
                closeFloorForm();
            }
        });
    }
    document.getElementById('floor-form').addEventListener('submit', handleFloorSubmit);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeFloorForm();
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
            renderFloors();
        });
    });
}

async function initializeViewToggle() {
    const saved = await getUiPreference(VIEW_STORAGE_KEY);
    if (saved === 'table' || saved === 'grid') {
        viewMode = saved;
    } else {
        viewMode = window.innerWidth <= 640 ? 'grid' : 'table';
    }

    const buttons = Array.from(document.querySelectorAll('.view-toggle-btn'));
    buttons.forEach(button => {
        button.addEventListener('click', async () => {
            const next = button.getAttribute('data-view');
            if (!next || next === viewMode) return;
            viewMode = next;
            await setUiPreference(VIEW_STORAGE_KEY, viewMode);
            updateViewToggle();
            updateViewVisibility();
            renderFloors();
        });
    });

    updateViewToggle();
    updateViewVisibility();

    window.addEventListener('resize', async () => {
        if (await getUiPreference(VIEW_STORAGE_KEY)) return;
        const next = window.innerWidth <= 640 ? 'grid' : 'table';
        if (next === viewMode) return;
        viewMode = next;
        updateViewToggle();
        updateViewVisibility();
        renderFloors();
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
    const tableContainer = document.getElementById('floors-table-container');
    const grid = document.getElementById('floors-grid');
    if (tableContainer) {
        tableContainer.style.display = viewMode === 'table' ? '' : 'none';
    }
    if (grid) {
        grid.style.display = viewMode === 'grid' ? 'grid' : 'none';
    }
}

// CRUD Operations
async function createFloor(name, level) {
    const floor = {
        id: Date.now().toString(),
        name: name.trim(),
        level: level ? parseInt(level) : null,
        createdAt: new Date().toISOString()
    };
    allFloors.push(floor);
    floors = allFloors;
    await saveData(await getAllData());
    await renderFloors();
    return floor;
}

async function updateFloor(id, name, level) {
    const floor = allFloors.find(f => f.id === id);
    if (floor) {
        floor.name = name.trim();
        floor.level = level ? parseInt(level) : null;
        await saveData(await getAllData());
        floors = allFloors;
        await renderFloors();
        return floor;
    }
    return null;
}

async function deleteFloor(id) {
    const data = await loadData();
    const areasAssigned = data.areas.filter(a => a.floor === id);
    
    if (areasAssigned.length > 0) {
        showAlert(`Cannot delete this floor. It has ${areasAssigned.length} area${areasAssigned.length !== 1 ? 's' : ''} assigned. Please remove or reassign the areas first.`, {
            title: 'Delete blocked'
        });
        return;
    }
    
    const confirmed = await showConfirm('Are you sure you want to delete this floor?', {
        title: 'Delete floor',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }
    allFloors = allFloors.filter(f => f.id !== id);
    floors = allFloors;
    await saveData(await getAllData());
    await renderFloors();
}

// Rendering
async function renderFloors() {
    const floorsList = document.getElementById('floors-list');
    const countLabel = document.getElementById('floors-count');
    if (countLabel) {
        const count = floors.length;
        countLabel.textContent = `${count} floor${count !== 1 ? 's' : ''}`;
    }
    
    if (floors.length === 0) {
        floorsList.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state-cell">
                    <div class="empty-state">
                        <div class="empty-state-icon">🏢</div>
                        <div class="empty-state-text">No floors defined</div>
                        <div class="empty-state-subtext">Add your first floor to organize your areas</div>
                    </div>
                </td>
            </tr>
        `;
        renderFloorsGrid([]);
        return;
    }
    
    const data = await loadData();
    const areas = data.areas;
    const devices = data.devices;
    
    const areaCounts = new Map();
    const devicesByArea = new Map();
    areas.forEach(area => {
        areaCounts.set(area.floor, (areaCounts.get(area.floor) || 0) + 1);
        devicesByArea.set(area.id, 0);
    });

    devices.forEach(device => {
        if (!device.area) return;
        devicesByArea.set(device.area, (devicesByArea.get(device.area) || 0) + 1);
    });

    const floorRows = floors.map(floor => {
        const areaCount = areaCounts.get(floor.id) || 0;
        let deviceCount = 0;
        areas.forEach(area => {
            if (area.floor === floor.id) {
                deviceCount += devicesByArea.get(area.id) || 0;
            }
        });
        const levelValue = floor.level !== null ? floor.level : null;
        return {
            floor,
            levelValue,
            areaCount,
            deviceCount
        };
    });

    const sortedFloors = floorRows.sort((a, b) => {
        let aVal = '';
        let bVal = '';
        let isNumeric = false;

        if (sortColumn === 'name') {
            aVal = a.floor.name || '';
            bVal = b.floor.name || '';
        } else if (sortColumn === 'level') {
            aVal = a.levelValue !== null ? a.levelValue : Number.MAX_SAFE_INTEGER;
            bVal = b.levelValue !== null ? b.levelValue : Number.MAX_SAFE_INTEGER;
            isNumeric = true;
        } else if (sortColumn === 'areas') {
            aVal = a.areaCount;
            bVal = b.areaCount;
            isNumeric = true;
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

    floorsList.innerHTML = sortedFloors.map(({ floor, areaCount, deviceCount }) => {
        const levelText = floor.level !== null ? `Level ${floor.level}` : '—';
        return `
            <tr>
                <td data-label="Floor"><strong>${escapeHtml(floor.name)}</strong></td>
                <td data-label="Level">${levelText}</td>
                <td data-label="Areas">${areaCount} area${areaCount !== 1 ? 's' : ''}</td>
                <td data-label="Devices">${deviceCount} device${deviceCount !== 1 ? 's' : ''}</td>
                <td class="actions-cell" data-label="Actions">
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="editFloor('${floor.id}')" aria-label="Edit" title="Edit">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                            <path d="M13.5 6.5l4 4"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger btn-icon" onclick="deleteFloorHandler('${floor.id}')" aria-label="Delete" title="Delete">
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

    renderFloorsGrid(sortedFloors);
}

function renderFloorsGrid(floorRows) {
    const grid = document.getElementById('floors-grid');
    if (!grid) return;
    if (!floorRows.length) {
        grid.innerHTML = `
            <div class="floor-card">
                <div class="empty-state">
                    <div class="empty-state-icon">🏢</div>
                    <div class="empty-state-text">No floors defined</div>
                    <div class="empty-state-subtext">Add your first floor to organize your areas</div>
                </div>
            </div>
        `;
        return;
    }

    grid.innerHTML = floorRows.map(({ floor, areaCount, deviceCount }) => {
        const levelText = floor.level !== null ? `${floor.level}` : '—';
        return `
            <div class="floor-card">
                <div class="floor-card-header">
                    <div class="floor-card-title">${escapeHtml(floor.name)}</div>
                </div>
                <div class="floor-card-meta">
                    <div class="floor-card-meta-row level">
                        <span class="floor-card-meta-label">Level</span>
                        <span class="floor-card-meta-value">${levelText}</span>
                    </div>
                    <div class="floor-card-meta-row">
                        <span class="floor-card-meta-label">Areas</span>
                        <span class="floor-card-meta-value">${areaCount}</span>
                    </div>
                    <div class="floor-card-meta-row">
                        <span class="floor-card-meta-label">Devices</span>
                        <span class="floor-card-meta-value">${deviceCount}</span>
                    </div>
                </div>
                <div class="floor-card-actions">
                    <button class="btn btn-sm btn-secondary btn-icon" onclick="editFloor('${floor.id}')" aria-label="Edit" title="Edit">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                            <path d="M13.5 6.5l4 4"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger btn-icon" onclick="deleteFloorHandler('${floor.id}')" aria-label="Delete" title="Delete">
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

// Form Functions
function openFloorForm(floorId = null) {
    editingFloorId = floorId;
    const modal = document.getElementById('floor-modal');
    const form = document.getElementById('floor-form');
    const title = document.getElementById('floor-modal-title');
    
    if (floorId) {
        const floor = floors.find(f => f.id === floorId);
        if (floor) {
            title.textContent = 'Edit Floor';
            document.getElementById('floor-name').value = floor.name;
            document.getElementById('floor-level').value = floor.level !== null ? floor.level : '';
        }
    } else {
        title.textContent = 'Add Floor';
        form.reset();
    }
    
    if (modal) {
        modal.classList.remove('is-hidden');
        modal.setAttribute('aria-hidden', 'false');
    }
}

function closeFloorForm() {
    const modal = document.getElementById('floor-modal');
    if (modal) {
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
    }
    editingFloorId = null;
    document.getElementById('floor-form').reset();
}

async function handleFloorSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('floor-name').value;
    const level = document.getElementById('floor-level').value;
    
    if (editingFloorId) {
        await updateFloor(editingFloorId, name, level);
    } else {
        await createFloor(name, level);
    }
    
    closeFloorForm();
}

// Global Functions (for onclick handlers)
window.editFloor = function(id) {
    openFloorForm(id);
};

window.deleteFloorHandler = async function(id) {
    await deleteFloor(id);
};

// Helper Functions
async function getAllData() {
    return {
        ...(await loadData()),
        floors: allFloors
    };
}
