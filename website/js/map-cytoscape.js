// Map Page JavaScript with Cytoscape.js

let devices = [];
let areas = [];
let floors = [];
let settings = {};
let cy = null;
let deviceFilters = null;
let isLayoutEditable = false;
let hasUnsavedLayoutChanges = false;
let isPanningFromNode = false;
let lastPanPosition = null;
let cachedPositions = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const data = loadData();
    const selectedHomeId = data.selectedHomeId;
    devices = data.devices.filter(device => device.homeId === selectedHomeId);
    areas = data.areas.filter(area => area.homeId === selectedHomeId);
    floors = data.floors.filter(floor => floor.homeId === selectedHomeId);
    settings = loadSettings();
    
    // Initialize device filters
    deviceFilters = new DeviceFilters();
    deviceFilters.init(devices, areas, floors, settings);
    deviceFilters.onFilterChange = (filteredDevices) => {
        // Just re-render the network with filtered devices
        renderNetwork();
    };
    
    initializeEventListeners();
    initializeCytoscape();
    renderNetwork();
});

// Event listeners
function initializeEventListeners() {
    const ethernetToggle = document.getElementById('show-ethernet-connections');
    if (ethernetToggle) {
        ethernetToggle.addEventListener('change', renderNetwork);
    }
    const usbToggle = document.getElementById('show-usb-connections');
    if (usbToggle) {
        usbToggle.addEventListener('change', renderNetwork);
    }
    const powerToggle = document.getElementById('show-power-connections');
    if (powerToggle) {
        powerToggle.addEventListener('change', renderNetwork);
    }
    const powerLabelMode = document.getElementById('power-label-mode');
    if (powerLabelMode) {
        powerLabelMode.addEventListener('change', renderNetwork);
    }
    const configToggle = document.querySelector('.map-display-toggle');
    const configPanel = document.getElementById('map-config');
    if (configToggle && configPanel) {
        configToggle.addEventListener('click', () => {
            const isCollapsed = configPanel.classList.toggle('is-collapsed');
            configToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        });
    }
    document.getElementById('fit-network-btn').addEventListener('click', fitNetwork);
    const editLayoutBtn = document.getElementById('toggle-edit-layout-btn');
    if (editLayoutBtn) {
        editLayoutBtn.addEventListener('click', toggleLayoutEdit);
    }
    document.getElementById('reset-layout-btn').addEventListener('click', resetLayout);
    const cancelLayoutBtn = document.getElementById('cancel-layout-btn');
    if (cancelLayoutBtn) {
        cancelLayoutBtn.addEventListener('click', cancelLayoutChanges);
    }
    document.getElementById('save-positions-btn').addEventListener('click', savePositions);
    const fullscreenBtn = document.getElementById('fullscreen-map-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleMapFullscreen);
    }
    updateLayoutButtons();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', () => {
        setMapFullscreen(false);
    });
    document.addEventListener('keydown', handleFullscreenEscape);
    document.addEventListener('keydown', handlePowerDialogEscape);
}

function toggleLayoutEdit() {
    setLayoutEditable(!isLayoutEditable);
}

function markLayoutDirty() {
    if (!isLayoutEditable) return;
    if (hasUnsavedLayoutChanges) return;
    hasUnsavedLayoutChanges = true;
    updateLayoutButtons();
}

function updateLayoutButtons() {
    const saveBtn = document.getElementById('save-positions-btn');
    if (saveBtn) {
        saveBtn.disabled = !(isLayoutEditable && hasUnsavedLayoutChanges);
        saveBtn.style.display = isLayoutEditable ? '' : 'none';
    }
    const resetBtn = document.getElementById('reset-layout-btn');
    if (resetBtn) {
        resetBtn.disabled = !isLayoutEditable;
        resetBtn.style.display = isLayoutEditable ? '' : 'none';
    }
    const cancelBtn = document.getElementById('cancel-layout-btn');
    if (cancelBtn) {
        cancelBtn.disabled = !isLayoutEditable;
        cancelBtn.style.display = isLayoutEditable ? '' : 'none';
    }
    const secondaryRow = document.querySelector('.map-controls-secondary');
    if (secondaryRow) {
        secondaryRow.style.display = isLayoutEditable ? 'flex' : 'none';
    }
}

function setLayoutEditable(editable) {
    isLayoutEditable = Boolean(editable);

    if (cy) {
        const nodes = cy.nodes('[type="device"]');
        if (isLayoutEditable) {
            if (!cachedPositions) {
                cachedPositions = loadPositions();
            }
            nodes.unlock();
            nodes.grabify();
        } else {
            nodes.lock();
            nodes.ungrabify();
        }
    }

    const editBtn = document.getElementById('toggle-edit-layout-btn');
    if (editBtn) {
        editBtn.textContent = isLayoutEditable ? 'Stop Editing' : 'Edit Layout';
        editBtn.classList.toggle('btn-success', isLayoutEditable);
        editBtn.classList.toggle('btn-secondary', !isLayoutEditable);
    }
    updateLayoutButtons();
}

function setMapFullscreen(isFullscreen) {
    document.body.classList.toggle('map-fullscreen', isFullscreen);
    const fullscreenBtn = document.getElementById('fullscreen-map-btn');
    if (fullscreenBtn) {
        const label = isFullscreen ? 'Exit full screen' : 'Full screen';
        fullscreenBtn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
        fullscreenBtn.setAttribute('aria-label', label);
        fullscreenBtn.setAttribute('title', label);
    }
    resizeCytoscape();
}

function toggleMapFullscreen() {
    const isFullscreen = Boolean(document.fullscreenElement);
    if (isFullscreen) {
        document.exitFullscreen();
        return;
    }

    const mapSection = document.getElementById('map-section');
    if (mapSection && mapSection.requestFullscreen) {
        mapSection.requestFullscreen().catch(() => {
            setMapFullscreen(false);
        });
    } else {
        // Fallback: avoid hiding the header if fullscreen API is unavailable
        setMapFullscreen(false);
    }
}

function handleFullscreenChange() {
    if (document.fullscreenElement) {
        setMapFullscreen(true);
        return;
    }

    if (document.body.classList.contains('map-fullscreen')) {
        setMapFullscreen(false);
    }
}

function handleFullscreenEscape(event) {
    if (event.key !== 'Escape') return;
    if (document.fullscreenElement) return;
    if (!document.body.classList.contains('map-fullscreen')) return;
    setMapFullscreen(false);
}

function resizeCytoscape() {
    if (!cy) return;
    requestAnimationFrame(() => {
        cy.resize();
    });
}

// Initialize Cytoscape
function initializeCytoscape() {
    const container = document.getElementById('network-map');
    
    cy = cytoscape({
        container: container,
        
        style: [
            // Floor style
            {
                selector: 'node[type="floor"]',
                style: {
                    'background-color': 'rgba(30, 41, 59, 0.4)',
                    'border-color': '#3b82f6',
                    'border-width': 3,
                    'label': 'data(label)',
                    'text-valign': 'top',
                    'text-halign': 'center',
                    'text-margin-y': 20,
                    'font-size': 20,
                    'font-weight': 'bold',
                    'color': '#60a5fa',
                    'text-background-color': 'rgba(30, 41, 59, 0.9)',
                    'text-background-opacity': 1,
                    'text-background-padding': 8,
                    'text-background-shape': 'roundrectangle',
                    'shape': 'roundrectangle',
                    'padding': 40
                }
            },
            // Area style
            {
                selector: 'node[type="area"]',
                style: {
                    'background-opacity': 0,
                    'border-color': 'rgba(100, 116, 139, 0.4)',
                    'border-width': 2,
                    'border-style': 'dashed',
                    'label': 'data(label)',
                    'text-valign': 'top',
                    'text-halign': 'center',
                    'text-margin-y': 18,
                    'font-size': 16,
                    'font-weight': 'bold',
                    'color': '#94a3b8',
                    'text-background-color': 'rgba(30, 41, 59, 0.9)',
                    'text-background-opacity': 1,
                    'text-background-padding': 8,
                    'text-background-shape': 'roundrectangle',
                    'shape': 'roundrectangle',
                    'padding': 35
                }
            },
            // Device style
            {
                selector: 'node[type="device"]',
                style: {
                    'background-color': '#1e293b',
                    'border-color': '#3b82f6',
                    'border-width': 2,
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-wrap': 'wrap',
                    'text-max-width': 100,
                    'font-size': 12,
                    'color': '#f1f5f9',
                    'shape': 'roundrectangle',
                    'width': 140,
                    'height': 60,
                    'padding': 5
                }
            },
            {
                selector: 'node[type="device"][hasStorage = "true"]',
                style: {
                    'background-image': 'data(storageIcon)',
                    'background-fit': 'none',
                    'background-repeat': 'no-repeat',
                    'background-position-x': '95%',
                    'background-position-y': '85%',
                    'background-width': 56,
                    'background-height': 24,
                    'text-margin-y': -6
                }
            },
            // Device pending status
            {
                selector: 'node[type="device"][status="pending"]',
                style: {
                    'border-color': '#f59e0b'
                }
            },
            // Device not working status
            {
                selector: 'node[type="device"][status="not-working"]',
                style: {
                    'border-color': '#ef4444'
                }
            },
            // Device working status
            {
                selector: 'node[type="device"][status="working"]',
                style: {
                    'border-color': '#10b981'
                }
            },
            // Edge styles
            {
                selector: 'edge[connectionType="ethernet"]',
                style: {
                    'width': 2,
                    'line-color': '#3b82f6',
                    'target-arrow-color': '#3b82f6',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f8fafc',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(15, 23, 42, 0.9)',
                    'text-background-color': 'rgba(15, 23, 42, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="usb"]',
                style: {
                    'width': 2,
                    'line-color': '#14b8a6',
                    'target-arrow-color': '#14b8a6',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f8fafc',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(15, 23, 42, 0.9)',
                    'text-background-color': 'rgba(15, 23, 42, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="power"]',
                style: {
                    'width': 2,
                    'line-color': '#f59e0b',
                    'target-arrow-color': '#f59e0b',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f8fafc',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(15, 23, 42, 0.9)',
                    'text-background-color': 'rgba(15, 23, 42, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            }
        ],
        
        layout: {
            name: 'preset'
        },
        
        minZoom: 0.3,
        maxZoom: 3,
        wheelSensitivity: 0.2
    });
    
    // Event handlers
    cy.on('tap', 'node[type="device"]', function(evt) {
        const node = evt.target;
        const deviceId = node.id();
        
        // Show tooltip on click
        showDeviceTooltip(node);
    });
    
    cy.on('dbltap', 'node[type="device"]', function(evt) {
        const node = evt.target;
        const deviceId = node.id();
        window.location.href = `device-edit.html?id=${deviceId}`;
    });

    cy.on('tap', 'edge[connectionType="power"]', function(evt) {
        const edge = evt.target;
        const deviceId = edge.data('target');
        const consumer = devices.find(d => d.id === deviceId);
        if (consumer) {
            showPowerConnectionDialog(consumer);
        }
    });

    cy.on('dragfree', 'node[type="device"]', () => {
        markLayoutDirty();
    });

    // Allow panning by dragging on nodes when not in edit mode
    cy.on('tapstart', 'node[type="device"]', (event) => {
        if (isLayoutEditable) return;
        isPanningFromNode = true;
        lastPanPosition = event.renderedPosition;
    });

    cy.on('tapdrag', (event) => {
        if (!isPanningFromNode || !lastPanPosition) return;
        const current = event.renderedPosition;
        const dx = current.x - lastPanPosition.x;
        const dy = current.y - lastPanPosition.y;
        cy.panBy({ x: dx, y: dy });
        lastPanPosition = current;
    });

    cy.on('tapend', () => {
        isPanningFromNode = false;
        lastPanPosition = null;
    });
    
    // Hide tooltip on tap elsewhere
    cy.on('tap', function(evt) {
        if (evt.target === cy) {
            hideDeviceTooltip();
            hidePowerConnectionDialog();
        }
    });
}

// Show device tooltip
function showDeviceTooltip(node) {
    hideDeviceTooltip();
    
    const device = devices.find(d => d.id === node.id());
    if (!device) return;
    
    const area = areas.find(a => a.id === device.area);
    const floor = area ? floors.find(f => f.id === area.floor) : null;
    
    const renderedPosition = node.renderedPosition();
    
    const tooltip = document.createElement('div');
    tooltip.id = 'device-tooltip';
    tooltip.className = 'device-tooltip';
    
    const name = device.name || device.model || 'Unnamed Device';
    const floorName = floor ? floor.name : 'No Floor';
    const areaName = area ? area.name : 'No Area';
    const type = device.type ? getFriendlyOption(settings?.types, device.type, formatDeviceType) : 'N/A';
    const brand = device.brand ? getFriendlyOption(settings?.brands, device.brand, formatDeviceType) : 'N/A';
    const status = device.status || 'N/A';
    const connectivity = device.connectivity ? getFriendlyOption(settings?.connectivity, device.connectivity, formatConnectivity) : 'N/A';
    
    tooltip.innerHTML = `
        <div class="tooltip-header">
            <strong>${escapeHtml(name)}</strong>
            <button class="tooltip-close-btn" onclick="document.getElementById('device-tooltip').remove()">×</button>
        </div>
        <div class="tooltip-body">
            <div class="tooltip-row">
                <span class="tooltip-label">Floor:</span>
                <span class="tooltip-value">${escapeHtml(floorName)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Area:</span>
                <span class="tooltip-value">${escapeHtml(areaName)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Type:</span>
                <span class="tooltip-value">${escapeHtml(type)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Brand:</span>
                <span class="tooltip-value">${escapeHtml(brand)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Status:</span>
                <span class="tooltip-value status-${status}">${escapeHtml(status)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Connectivity:</span>
                <span class="tooltip-value">${escapeHtml(connectivity)}</span>
            </div>
        </div>
        <div class="tooltip-footer">
            <button class="tooltip-edit-btn" onclick="window.location.href='device-edit.html?id=${device.id}'">
                Edit Device
            </button>
            <span class="tooltip-hint">Double-click to edit</span>
        </div>
    `;
    
    const tooltipRoot = document.fullscreenElement || document.getElementById('map-section') || document.body;
    tooltipRoot.appendChild(tooltip);
    
    // Position tooltip
    if (window.innerWidth <= 640) {
        tooltip.classList.add('is-centered');
        tooltip.style.left = '50%';
        tooltip.style.top = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    } else {
        tooltip.classList.remove('is-centered');
        tooltip.style.transform = '';
        tooltip.style.left = (renderedPosition.x + 20) + 'px';
        tooltip.style.top = (renderedPosition.y + 20) + 'px';
    }
}

function hideDeviceTooltip() {
    const tooltip = document.getElementById('device-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

// Render network
function renderNetwork() {
    if (!cy) {
        console.error('Cytoscape not initialized');
        return;
    }
    
    hideDeviceTooltip();
    
    // Get display settings
    const showEthernet = document.getElementById('show-ethernet-connections').checked;
    const showUsb = document.getElementById('show-usb-connections').checked;
    const showPower = document.getElementById('show-power-connections').checked;
    
    // Use filtered devices from DeviceFilters module
    const filteredDevices = (deviceFilters ? deviceFilters.getFilteredDevices() : devices)
        .filter(device => device.status !== 'wishlist');

    const mapCountLabel = document.getElementById('map-devices-count');
    if (mapCountLabel) {
        mapCountLabel.textContent = `${filteredDevices.length} device${filteredDevices.length !== 1 ? 's' : ''}`;
    }
    
    console.log('Rendering map with devices:', filteredDevices.length);
    
    // Check if there are devices to show
    if (filteredDevices.length === 0) {
        cy.elements().remove();
        showEmptyMapMessage();
        return;
    }
    
    // Get unique floors and areas from filtered devices
    const deviceAreaIds = [...new Set(filteredDevices.map(d => d.area).filter(Boolean))];
    const filteredAreas = areas.filter(a => deviceAreaIds.includes(a.id));
    const floorIds = [...new Set(filteredAreas.map(a => a.floor).filter(Boolean))];
    const filteredFloors = floors.filter(f => floorIds.includes(f.id));
    
    console.log('Map data:', {
        devices: filteredDevices.length,
        areas: filteredAreas.length,
        floors: filteredFloors.length,
        totalDevices: devices.length,
        totalAreas: areas.length,
        totalFloors: floors.length
    });
    
    // Load saved positions
    const savedPositions = loadPositions();
    
    // Build elements array
    const elements = [];
    
    // Sort floors by level (highest first)
    const sortedFloors = [...filteredFloors].sort((a, b) => (b.level || 0) - (a.level || 0));
    
    let yOffset = 0;
    const floorSpacing = 300;
    const areaSpacing = 150;
    const deviceSpacingX = 180;
    const deviceSpacingY = 100;
    
    // Add floors, areas, and devices
    sortedFloors.forEach((floor, floorIndex) => {
        const areasInFloor = filteredAreas.filter(a => a.floor === floor.id);
        
        if (areasInFloor.length === 0) return;
        
        // Add floor node
        elements.push({
            group: 'nodes',
            data: {
                id: `floor-${floor.id}`,
                label: floor.name,
                type: 'floor',
                level: floor.level || 0
            }
        });
        
        let xOffset = 0;
        
        areasInFloor.forEach((area, areaIndex) => {
            const devicesInArea = filteredDevices.filter(d => d.area === area.id);
            
            // Add area node with floor as parent
            elements.push({
                group: 'nodes',
                data: {
                    id: `area-${area.id}`,
                    label: area.name,
                    type: 'area',
                    parent: `floor-${floor.id}`
                }
            });
            
            // Sort devices: connected first, then unconnected
            const devicesWithConnections = devicesInArea.filter(d => d.ports && d.ports.length > 0);
            const devicesWithoutConnections = devicesInArea.filter(d => !d.ports || d.ports.length === 0);
            
            // Try to group connected devices together
            const sortedConnectedDevices = sortDevicesByConnections(devicesWithConnections);
            const sortedDevices = [...sortedConnectedDevices, ...devicesWithoutConnections];
            
            // Add devices with area as parent
            const devicesPerRow = 3;
            sortedDevices.forEach((device, deviceIndex) => {
                const deviceLabel = device.name || device.model || 'Unnamed Device';
                const storageLabel = formatStorageLabel(device);
                
                const row = Math.floor(deviceIndex / devicesPerRow);
                const col = deviceIndex % devicesPerRow;
                
                const deviceData = {
                    id: device.id,
                    label: deviceLabel,
                    type: 'device',
                    status: device.status,
                    parent: `area-${area.id}`
                };
                if (storageLabel) {
                    deviceData.hasStorage = 'true';
                    deviceData.storageIcon = buildStorageIconDataUri(storageLabel);
                }

                elements.push({
                    group: 'nodes',
                    data: deviceData,
                    position: savedPositions[device.id] || {
                        x: xOffset + col * deviceSpacingX,
                        y: yOffset + row * deviceSpacingY
                    }
                });
            });
            
            xOffset += Math.max(550, Math.ceil(Math.sqrt(devicesInArea.length)) * deviceSpacingX + 150);
        });
        
        // Calculate floor height based on number of devices in areas
        const maxDevicesInAnyArea = Math.max(...areasInFloor.map(a => 
            filteredDevices.filter(d => d.area === a.id).length
        ), 1);
        const rowsNeeded = Math.ceil(maxDevicesInAnyArea / 3);
        const floorHeight = Math.max(500, rowsNeeded * deviceSpacingY + 200);
        
        yOffset += floorHeight + floorSpacing;
    });
    
    // Add edges for connections
    const processedConnections = new Set();
    
    filteredDevices.forEach(device => {
        if (!device.ports || !Array.isArray(device.ports)) return;
        
        device.ports.forEach(port => {
            if (!port.connectedTo) return;
            
            // Check if connected device is in filtered list
            if (!filteredDevices.find(d => d.id === port.connectedTo)) return;
            
            // Create unique connection ID to avoid duplicates
            const connectionId = [device.id, port.connectedTo].sort().join('-');
            if (processedConnections.has(connectionId)) return;
            processedConnections.add(connectionId);
            
            // Determine connection type
            let connectionType;
            let show;
            
            if (port.type.startsWith('ethernet')) {
                connectionType = 'ethernet';
                show = showEthernet;
            } else if (port.type.startsWith('usb')) {
                connectionType = 'usb';
                show = showUsb;
            } else if (port.type.startsWith('power')) {
                connectionType = 'power';
                show = showPower;
            }
            
            if (show) {
                let label = '';
                if (connectionType === 'ethernet') {
                    const meta = getEthernetConnectionMeta(device, port, filteredDevices);
                    label = formatEthernetLabel(meta);
                } else if (connectionType === 'usb') {
                    label = 'USB';
                } else if (connectionType === 'power') {
                    label = getPowerConnectionLabel(device, port, filteredDevices);
                }

                // Determine arrow direction based on port type
                // Input ports: arrow points TO this device (receives data/power)
                // Output ports: arrow points FROM this device (sends data/power)
                const isInputPort = port.type.includes('input');
                
                elements.push({
                    group: 'edges',
                    data: {
                        id: `${device.id}-${port.connectedTo}-${port.type}`,
                        source: isInputPort ? port.connectedTo : device.id,
                        target: isInputPort ? device.id : port.connectedTo,
                        connectionType: connectionType,
                        label: label
                    }
                });
            }
        });
    });
    
    // Update cytoscape
    hideEmptyMapMessage();
    cy.elements().remove();
    cy.add(elements);
    
    // Run layout
    cy.layout({
        name: 'preset',
        fit: true,
        padding: 80
    }).run();

    setLayoutEditable(isLayoutEditable);
}

function getEthernetConnectionMeta(device, port, devicesList) {
    const meta = {
        cableType: port.cableType || '',
        speed: port.speed || ''
    };
    if (meta.cableType && meta.speed) {
        return meta;
    }
    const connectedDevice = devicesList.find(d => d.id === port.connectedTo);
    if (!connectedDevice || !connectedDevice.ports) {
        return meta;
    }
    const reversePort = connectedDevice.ports.find(p => p.connectedTo === device.id && p.type && p.type.startsWith('ethernet'));
    if (!reversePort) {
        return meta;
    }
    if (!meta.cableType && reversePort.cableType) {
        meta.cableType = reversePort.cableType;
    }
    if (!meta.speed && reversePort.speed) {
        meta.speed = reversePort.speed;
    }
    return meta;
}

function formatCableTypeLabel(cableType) {
    return cableType.replace(/^cat/i, 'Cat');
}

function formatEthernetLabel(meta) {
    if (!meta) {
        return 'Ethernet';
    }
    const cableLabel = meta.cableType ? formatCableTypeLabel(meta.cableType) : '';
    const speedLabel = meta.speed || '';
    if (cableLabel && speedLabel) {
        return `${cableLabel} (${speedLabel})`;
    }
    if (cableLabel) {
        return cableLabel;
    }
    if (speedLabel) {
        return `Ethernet (${speedLabel})`;
    }
    return 'Ethernet';
}

function formatStorageLabel(device) {
    if (!device) {
        return '';
    }
    const rawSize = device.storageSize;
    if (rawSize === undefined || rawSize === null) {
        return '';
    }
    const size = String(rawSize).trim();
    if (!size) {
        return '';
    }
    const unit = device.storageUnit ? String(device.storageUnit).trim() : '';
    return unit ? `${size} ${unit}` : size;
}

function buildStorageIconDataUri(label) {
    const safeLabel = escapeSvgText(label);
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="24" viewBox="0 0 56 24">',
        '<rect x="1" y="3" width="54" height="18" rx="4" ry="4" fill="none" stroke="#94a3b8" stroke-width="1.2"/>',
        '<rect x="4" y="8" width="48" height="2" fill="#94a3b8" opacity="0.6"/>',
        `<text x="28" y="18" text-anchor="middle" font-size="9" font-family="Arial, sans-serif" fill="#94a3b8">${safeLabel}</text>`,
        '</svg>'
    ].join('');
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getPowerConnectionLabel(device, port, devicesList) {
    const consumer = getPowerConsumerDevice(device, port, devicesList);
    if (!consumer) {
        return 'Power';
    }
    const mode = getPowerLabelMode();
    const value = getPowerLabelValue(consumer, mode);
    return value === '-' ? 'Power' : value;
}

function getPowerConsumerDevice(device, port, devicesList) {
    if (port.type && port.type.includes('power-input')) {
        return device;
    }
    if (port.type && port.type.includes('power-output')) {
        const connectedDevice = devicesList.find(d => d.id === port.connectedTo);
        if (connectedDevice && connectedDevice.ports) {
            const reversePort = connectedDevice.ports.find(p => p.connectedTo === device.id && p.type && p.type.includes('power-input'));
            if (reversePort) {
                return connectedDevice;
            }
        }
        if (connectedDevice) {
            return connectedDevice;
        }
    }
    return device;
}

function formatPowerValue(value) {
    if (value === undefined || value === null) {
        return '-';
    }
    const text = String(value).trim();
    if (!text) {
        return '-';
    }
    const normalized = text.replace(/\s*w$/i, '').trim();
    if (!normalized) {
        return '-';
    }
    return `${normalized} W`;
}

function getPowerLabelMode() {
    const select = document.getElementById('power-label-mode');
    return select ? select.value : 'mean';
}

function getPowerLabelValue(device, mode) {
    if (mode === 'idle') {
        return formatPowerValue(device.idleConsumption);
    }
    if (mode === 'max') {
        return formatPowerValue(device.maxConsumption);
    }
    return formatPowerValue(device.meanConsumption);
}

function showPowerConnectionDialog(device) {
    hidePowerConnectionDialog();
    hideDeviceTooltip();

    const idle = formatPowerValue(device.idleConsumption);
    const mean = formatPowerValue(device.meanConsumption);
    const max = formatPowerValue(device.maxConsumption);

    const overlay = document.createElement('div');
    overlay.id = 'power-connection-dialog';
    overlay.className = 'connection-dialog-overlay';
    overlay.innerHTML = `
        <div class="connection-dialog" role="dialog" aria-modal="true">
            <div class="connection-dialog-header">
                <span class="connection-dialog-title">Power Details</span>
                <button type="button" class="connection-dialog-close" aria-label="Close">×</button>
            </div>
            <div class="connection-dialog-body">
                <div class="connection-dialog-row">
                    <span>Idle Consumption (W)</span>
                    <strong>${idle}</strong>
                </div>
                <div class="connection-dialog-row">
                    <span>Mean Consumption (W)</span>
                    <strong>${mean}</strong>
                </div>
                <div class="connection-dialog-row">
                    <span>Max Consumption (W)</span>
                    <strong>${max}</strong>
                </div>
            </div>
        </div>
    `;

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            hidePowerConnectionDialog();
        }
    });

    const closeBtn = overlay.querySelector('.connection-dialog-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', hidePowerConnectionDialog);
    }

    const dialogRoot = document.fullscreenElement || document.getElementById('map-section') || document.body;
    dialogRoot.appendChild(overlay);
}

function hidePowerConnectionDialog() {
    const dialog = document.getElementById('power-connection-dialog');
    if (dialog) {
        dialog.remove();
    }
}

function handlePowerDialogEscape(event) {
    if (event.key !== 'Escape') {
        return;
    }
    hidePowerConnectionDialog();
}

// Fit network to screen
function fitNetwork() {
    if (cy) {
        cy.fit(null, 80);
    }
}

// Reset layout
async function resetLayout() {
    if (!isLayoutEditable) {
        showAlert('Enable edit mode to reset the layout.');
        return;
    }
    const confirmed = await showConfirm('This will reset all device positions. Continue?', {
        title: 'Reset layout',
        confirmText: 'Reset'
    });
    if (!confirmed) {
        return;
    }
    localStorage.removeItem('smart-home-network-positions');
    hasUnsavedLayoutChanges = true;
    renderNetwork();
    
    // Show feedback
    const btn = document.getElementById('reset-layout-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Reset!';
    btn.classList.add('btn-success');
    
    setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('btn-success');
    }, 2000);
}

// Save positions
function savePositions() {
    if (!isLayoutEditable) {
        showAlert('Enable edit mode to save positions.');
        return;
    }
    if (!cy) return;
    
    const positions = {};
    cy.nodes('[type="device"]').forEach(node => {
        positions[node.id()] = node.position();
    });
    
    localStorage.setItem('smart-home-network-positions', JSON.stringify(positions));
    hasUnsavedLayoutChanges = false;
    cachedPositions = null;
    updateLayoutButtons();
    
    // Show feedback
    const btn = document.getElementById('save-positions-btn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = 'Saved!';
    btn.classList.add('btn-success');
    
    setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove('btn-success');
    }, 2000);

    setLayoutEditable(false);
}

function cancelLayoutChanges() {
    if (!isLayoutEditable) {
        return;
    }
    if (cachedPositions) {
        localStorage.setItem('smart-home-network-positions', JSON.stringify(cachedPositions));
    } else {
        localStorage.removeItem('smart-home-network-positions');
    }
    hasUnsavedLayoutChanges = false;
    cachedPositions = null;
    renderNetwork();
    setLayoutEditable(false);
}

// Load positions
function loadPositions() {
    const saved = localStorage.getItem('smart-home-network-positions');
    return saved ? JSON.parse(saved) : {};
}

// Sort devices by connections to group connected devices together
function sortDevicesByConnections(devicesWithConnections) {
    if (devicesWithConnections.length === 0) return [];
    
    const sorted = [];
    const visited = new Set();
    
    // Build connection map
    const connectionMap = new Map();
    devicesWithConnections.forEach(device => {
        const connections = new Set();
        if (device.ports) {
            device.ports.forEach(port => {
                if (port.connectedTo) {
                    connections.add(port.connectedTo);
                }
            });
        }
        connectionMap.set(device.id, connections);
    });
    
    // Start with device that has most connections
    let currentDevice = devicesWithConnections.reduce((max, device) => {
        const currentConnections = connectionMap.get(device.id).size;
        const maxConnections = connectionMap.get(max.id).size;
        return currentConnections > maxConnections ? device : max;
    });
    
    // Depth-first traversal to group connected devices
    function addDeviceAndConnected(device) {
        if (visited.has(device.id)) return;
        
        visited.add(device.id);
        sorted.push(device);
        
        // Add connected devices that are in the same area
        const connections = connectionMap.get(device.id);
        if (connections) {
            connections.forEach(connectedId => {
                const connectedDevice = devicesWithConnections.find(d => d.id === connectedId);
                if (connectedDevice && !visited.has(connectedId)) {
                    addDeviceAndConnected(connectedDevice);
                }
            });
        }
    }
    
    // Add first device and its connections
    addDeviceAndConnected(currentDevice);
    
    // Add remaining devices
    devicesWithConnections.forEach(device => {
        if (!visited.has(device.id)) {
            addDeviceAndConnected(device);
        }
    });
    
    return sorted;
}

// Show empty map message
function showEmptyMapMessage() {
    const container = document.getElementById('network-map');
    const existingMessage = container.querySelector('.empty-map-message');
    
    if (!existingMessage) {
        const message = document.createElement('div');
        message.className = 'empty-map-message';
        const emptyStateText = devices.length === 0
            ? 'Add your first device to get started'
            : 'Try adjusting your filters';
        message.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔌</div>
                <div class="empty-state-text">No devices found</div>
                <div class="empty-state-subtext">${emptyStateText}</div>
            </div>
        `;
        container.appendChild(message);
    }
}

// Hide empty map message
function hideEmptyMapMessage() {
    const container = document.getElementById('network-map');
    const message = container.querySelector('.empty-map-message');
    if (message) {
        message.remove();
    }
}
