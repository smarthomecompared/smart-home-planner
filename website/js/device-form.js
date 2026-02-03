// Device Form JavaScript (shared for add and edit)

let allDevices = [];
let devices = [];
let allAreas = [];
let areas = [];
let editingDeviceId = null;
let editingDeviceHomeId = null;
let settings = {};
let lastBrandValue = '';
let lastTypeValue = '';
let lastBatteryTypeValue = '';
let lastConnectivityValue = '';
let selectedHomeId = '';
let availableHomes = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const data = loadData();
    allDevices = data.devices;
    allAreas = data.areas;
    settings = loadSettings();
    selectedHomeId = data.selectedHomeId;
    availableHomes = data.homes || [];
    devices = allDevices.filter(device => device.homeId === selectedHomeId);
    
    // Check if we're editing (device-edit.html)
    const urlParams = new URLSearchParams(window.location.search);
    editingDeviceId = urlParams.get('id');
    
    initializeEventListeners();
    populateBrands();
    populateTypes();
    populateConnectivity();
    populateBatteryTypes();
    setAreasForHome(selectedHomeId);
    handleBrandChange();
    handleConnectivityChange();
    handleStatusChange();
    setupHomeSelector();
    
    if (editingDeviceId) {
        loadDeviceForEdit(editingDeviceId);
    } else {
        loadDuplicateDeviceFromSession();
    }

    handlePowerTypeChange();
});

// Event Listeners
function initializeEventListeners() {
    document.getElementById('device-form').addEventListener('submit', handleDeviceSubmit);
    document.getElementById('device-power').addEventListener('change', handlePowerTypeChange);
    document.getElementById('device-connectivity').addEventListener('change', handleConnectivitySelectChange);
    document.getElementById('device-battery-type').addEventListener('change', handleBatteryTypeChange);
    document.getElementById('device-brand').addEventListener('change', handleBrandChange);
    document.getElementById('device-type').addEventListener('change', handleTypeChange);
    document.getElementById('device-status').addEventListener('change', handleStatusChange);
    const deleteButton = document.getElementById('delete-device-btn');
    if (deleteButton) {
        deleteButton.addEventListener('click', handleDeleteDevice);
    }
    const homeSelect = document.getElementById('device-home-select');
    if (homeSelect) {
        homeSelect.addEventListener('change', handleHomeSelectChange);
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
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeBrandModal();
            closeTypeModal();
            closeBatteryTypeModal();
            closeConnectivityModal();
        }
    });
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

function populateAreas() {
    const areaSelect = document.getElementById('device-area');
    const currentValue = areaSelect.value;
    
    areaSelect.innerHTML = '<option value="">Select an area</option>' + 
        areas.map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`).join('');
    
    if (currentValue) {
        areaSelect.value = currentValue;
    }
}

function setAreasForHome(homeId) {
    areas = allAreas.filter(area => area.homeId === homeId);
    populateAreas();
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

function loadDuplicateDeviceFromSession() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('duplicate') !== 'true') {
        return;
    }
    const stored = sessionStorage.getItem('duplicateDevice');
    if (!stored) {
        return;
    }
    let duplicateData;
    try {
        duplicateData = JSON.parse(stored);
    } catch (error) {
        sessionStorage.removeItem('duplicateDevice');
        return;
    }
    duplicateData.installationDate = '';
    duplicateData.lastBatteryChange = '';
    loadDeviceData(duplicateData);
    sessionStorage.removeItem('duplicateDevice');
}

function loadDeviceData(device) {
    editingDeviceHomeId = device.homeId || selectedHomeId;
    setAreasForHome(editingDeviceHomeId);
    document.getElementById('device-name').value = device.name || '';
    document.getElementById('device-brand').value = device.brand ? normalizeOptionValue(device.brand) : '';
    document.getElementById('device-model').value = device.model || '';
    document.getElementById('device-type').value = device.type ? normalizeOptionValue(device.type) : '';
    document.getElementById('device-ip').value = device.ip || '';
    document.getElementById('device-mac').value = device.mac || '';
    document.getElementById('device-status').value = device.status || 'working';
    document.getElementById('device-power').value = device.power || 'wired';
    document.getElementById('device-battery-type').value = device.batteryType ? normalizeOptionValue(device.batteryType) : '';
    document.getElementById('device-battery-count').value = device.batteryCount || '';
    document.getElementById('device-last-battery-change').value = device.lastBatteryChange || '';
    document.getElementById('device-battery-duration').value = device.batteryDuration || '';
    document.getElementById('device-ups-protected').checked = device.upsProtected || false;
    document.getElementById('device-idle-consumption').value = device.idleConsumption || '';
    document.getElementById('device-mean-consumption').value = device.meanConsumption || '';
    document.getElementById('device-max-consumption').value = device.maxConsumption || '';
    document.getElementById('device-installation-date').value = device.installationDate || '';
    document.getElementById('device-storage-size').value = device.storageSize || '';
    document.getElementById('device-storage-unit').value = device.storageUnit || '';
    document.getElementById('device-notes').value = device.notes || '';
    document.getElementById('device-connectivity').value = device.connectivity ? normalizeOptionValue(device.connectivity) : normalizeOptionValue('wifi');
    document.getElementById('device-area').value = device.area || '';
    populateHomeSelector(editingDeviceHomeId);
    
    // Load checkbox values
    document.getElementById('device-thread-border-router').checked = device.threadBorderRouter || false;
    document.getElementById('device-matter-hub').checked = device.matterHub || false;
    document.getElementById('device-zigbee-controller').checked = device.zigbeeController || false;
    document.getElementById('device-zigbee-repeater').checked = device.zigbeeRepeater || false;
    document.getElementById('device-home-assistant').checked = device.homeAssistant || false;
    document.getElementById('device-google-home').checked = device.googleHome || false;
    document.getElementById('device-alexa').checked = device.alexa || false;
    document.getElementById('device-apple-home-kit').checked = device.appleHomeKit || false;
    document.getElementById('device-samsung-smartthings').checked = device.samsungSmartThings || false;
    document.getElementById('device-local-only').checked = device.localOnly || false;
    
    handlePowerTypeChange();
    handleConnectivityChange();
    handleBatteryTypeChange();
    handleBrandChange();
    handleStatusChange();
    handleHomeVisibility();
    lastTypeValue = document.getElementById('device-type').value;
    lastBatteryTypeValue = document.getElementById('device-battery-type').value;
    lastConnectivityValue = document.getElementById('device-connectivity').value;
    
    // Load ports
    if (device.ports) {
        loadPorts(device.ports);
    }
}

// Form Handlers
function handleDeviceSubmit(e) {
    e.preventDefault();

    let connectivity = document.getElementById('device-connectivity').value;
    if (connectivity === '__new__') {
        showAlert('Please add a new connectivity option first.');
        return;
    }
    connectivity = normalizeOptionValue(connectivity);
    const ipValue = isWifiConnectivity(connectivity) ? document.getElementById('device-ip').value : '';
    const macValue = isWifiConnectivity(connectivity) ? document.getElementById('device-mac').value : '';
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

    const deviceHomeSelect = document.getElementById('device-home-select');
    const nextHomeId = deviceHomeSelect ? deviceHomeSelect.value : '';
    const deviceData = {
        name: document.getElementById('device-name').value,
        brand: brandValue,
        model: document.getElementById('device-model').value,
        type: typeValue,
        ip: ipValue,
        mac: macValue,
        status: document.getElementById('device-status').value,
        power: document.getElementById('device-power').value,
        batteryType: batteryTypeValue,
        batteryCount: document.getElementById('device-battery-count').value,
        lastBatteryChange: document.getElementById('device-last-battery-change').value,
        batteryDuration: document.getElementById('device-battery-duration').value,
        upsProtected: document.getElementById('device-ups-protected').checked,
        idleConsumption: document.getElementById('device-idle-consumption').value,
        meanConsumption: document.getElementById('device-mean-consumption').value,
        maxConsumption: document.getElementById('device-max-consumption').value,
        installationDate: document.getElementById('device-installation-date').value,
        storageSize: document.getElementById('device-storage-size').value,
        storageUnit: document.getElementById('device-storage-unit').value,
        notes: document.getElementById('device-notes').value,
        connectivity: connectivity,
        area: document.getElementById('device-area').value,
        threadBorderRouter: document.getElementById('device-thread-border-router').checked,
        matterHub: document.getElementById('device-matter-hub').checked,
        zigbeeController: document.getElementById('device-zigbee-controller').checked,
        zigbeeRepeater: document.getElementById('device-zigbee-repeater').checked,
        homeAssistant: document.getElementById('device-home-assistant').checked,
        googleHome: document.getElementById('device-google-home').checked,
        alexa: document.getElementById('device-alexa').checked,
        appleHomeKit: document.getElementById('device-apple-home-kit').checked,
        samsungSmartThings: document.getElementById('device-samsung-smartthings').checked,
        localOnly: document.getElementById('device-local-only').checked,
        ports: getPortsData(),
        homeId: editingDeviceId ? (nextHomeId || editingDeviceHomeId) : getSelectedHomeId()
    };
    
    if (editingDeviceId) {
        updateDevice(editingDeviceId, deviceData);
    } else {
        createDevice(deviceData);
    }
}

function handlePowerTypeChange() {
    const status = document.getElementById('device-status').value;
    const isWishlist = status === 'wishlist';
    const powerType = document.getElementById('device-power').value;
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
    
    if (powerType === 'battery') {
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
    }
}

function handleStatusChange() {
    const status = document.getElementById('device-status').value;
    const isWishlist = status === 'wishlist';
    const areaGroup = document.getElementById('device-area-group');
    const areaSelect = document.getElementById('device-area');
    const installationGroup = document.getElementById('device-installation-group');
    const installationInput = document.getElementById('device-installation-date');
    const batteryChangeGroup = document.getElementById('battery-change-group');
    const batteryChangeInput = document.getElementById('device-last-battery-change');

    if (areaGroup) {
        areaGroup.classList.remove('is-collapsed');
        areaGroup.classList.toggle('is-hidden', isWishlist);
    }
    if (areaSelect) {
        areaSelect.required = false;
    }
    if (installationGroup) {
        installationGroup.classList.remove('is-collapsed');
        installationGroup.classList.toggle('is-hidden', isWishlist);
    }
    if (batteryChangeGroup) {
        const shouldHideBatteryChange = isWishlist || document.getElementById('device-power').value !== 'battery';
        batteryChangeGroup.classList.toggle('is-collapsed', shouldHideBatteryChange);
        if (!shouldHideBatteryChange) {
            batteryChangeGroup.classList.remove('is-hidden');
        }
    }
}

function setupHomeSelector() {
    const homeSection = document.getElementById('device-home-section');
    const homeSelect = document.getElementById('device-home-select');
    if (!homeSection || !homeSelect) return;
    if (availableHomes.length <= 1) {
        homeSection.classList.add('is-hidden');
        return;
    }
    homeSection.classList.remove('is-hidden');
    populateHomeSelector(editingDeviceHomeId || selectedHomeId);
}

function populateHomeSelector(currentHomeId) {
    const homeSelect = document.getElementById('device-home-select');
    if (!homeSelect) return;
    homeSelect.innerHTML = availableHomes
        .map(home => `<option value="${home.id}">${escapeHtml(home.name)}</option>`)
        .join('');
    if (currentHomeId) {
        homeSelect.value = currentHomeId;
    }
}

function handleHomeVisibility() {
    const homeSection = document.getElementById('device-home-section');
    if (!homeSection) return;
    if (availableHomes.length <= 1) {
        homeSection.classList.add('is-hidden');
        return;
    }
    homeSection.classList.remove('is-hidden');
}

function handleHomeSelectChange(event) {
    const nextHomeId = event.target.value;
    if (!nextHomeId) return;
    editingDeviceHomeId = nextHomeId;
    setAreasForHome(nextHomeId);
    const areaSelect = document.getElementById('device-area');
    if (areaSelect) {
        areaSelect.value = '';
    }
}

function handleBatteryTypeChange() {
    const batteryTypeSelect = document.getElementById('device-battery-type');
    if (batteryTypeSelect.value === '__new__') {
        openBatteryTypeModal();
        return;
    }
    const powerType = document.getElementById('device-power').value;
    const batteryType = normalizeOptionValue(document.getElementById('device-battery-type').value || '');
    const batteryCountGroup = document.getElementById('battery-count-group');
    const hideCount = powerType !== 'battery' || batteryType === 'internal';
    batteryCountGroup.classList.toggle('is-hidden', hideCount);
    if (hideCount) {
        document.getElementById('device-battery-count').value = '';
    }
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

function saveBrandModal() {
    const input = document.getElementById('brand-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a brand name.');
        return;
    }

    const updatedSettings = loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.brands || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.brands = [...updatedSettings.brands, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        saveSettings(updatedSettings);
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
}

function saveTypeModal() {
    const input = document.getElementById('type-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a type name.');
        return;
    }

    const updatedSettings = loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.types || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.types = [...updatedSettings.types, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        saveSettings(updatedSettings);
        settings = updatedSettings;
    }

    populateTypes();
    document.getElementById('device-type').value = normalized;
    lastTypeValue = normalized;
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

function saveBatteryTypeModal() {
    const input = document.getElementById('battery-type-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a battery type.');
        return;
    }

    const updatedSettings = loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.batteryTypes || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.batteryTypes = [...updatedSettings.batteryTypes, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        saveSettings(updatedSettings);
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

function saveConnectivityModal() {
    const input = document.getElementById('connectivity-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a connectivity option.');
        return;
    }

    const updatedSettings = loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.connectivity || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.connectivity = [...updatedSettings.connectivity, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        saveSettings(updatedSettings);
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
    const ipGroup = document.getElementById('ip-address-group');
    const macGroup = document.getElementById('mac-address-group');
    const showNetworkFields = isWifiConnectivity(connectivity);

    ipGroup.classList.toggle('is-hidden', !showNetworkFields);
    macGroup.classList.toggle('is-hidden', !showNetworkFields);

    if (!showNetworkFields) {
        document.getElementById('device-ip').value = '';
        document.getElementById('device-mac').value = '';
    }
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
function syncDevicePorts(currentDeviceId, currentDevicePorts) {
    // Reload all devices to get the latest data
    const allData = loadData();
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
    saveData(allData);
    
    // Update local devices array
    devices = allDevices;
}

// Make removePort available globally
window.removePort = removePort;

// CRUD Operations
function createDevice(deviceData) {
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
    
    const device = {
        id: Date.now().toString(),
        name: name,
        brand: normalizeOptionValue(deviceData.brand),
        model: deviceData.model.trim(),
        type: normalizeOptionValue(deviceData.type),
        ip: deviceData.ip.trim() || '',
        mac: deviceData.mac.trim() || '',
        status: deviceData.status,
        power: deviceData.power,
        batteryType: normalizeOptionValue(deviceData.batteryType),
        batteryCount: deviceData.batteryCount ? parseInt(deviceData.batteryCount) : null,
        lastBatteryChange: deviceData.lastBatteryChange || '',
        batteryDuration: deviceData.batteryDuration ? parseFloat(deviceData.batteryDuration) : null,
        upsProtected: deviceData.upsProtected || false,
        idleConsumption: deviceData.idleConsumption ? parseFloat(deviceData.idleConsumption) : null,
        meanConsumption: deviceData.meanConsumption ? parseFloat(deviceData.meanConsumption) : null,
        maxConsumption: deviceData.maxConsumption ? parseFloat(deviceData.maxConsumption) : null,
        installationDate: deviceData.installationDate || '',
        storageSize: deviceData.storageSize ? parseFloat(deviceData.storageSize) : null,
        storageUnit: deviceData.storageUnit || '',
        notes: deviceData.notes ? deviceData.notes.trim() : '',
        homeId: deviceData.homeId || getSelectedHomeId(),
        connectivity: normalizeOptionValue(deviceData.connectivity),
        area: deviceData.area,
        threadBorderRouter: deviceData.threadBorderRouter || false,
        matterHub: deviceData.matterHub || false,
        zigbeeController: deviceData.zigbeeController || false,
        zigbeeRepeater: deviceData.zigbeeRepeater || false,
        homeAssistant: deviceData.homeAssistant || false,
        googleHome: deviceData.googleHome || false,
        alexa: deviceData.alexa || false,
        appleHomeKit: deviceData.appleHomeKit || false,
        samsungSmartThings: deviceData.samsungSmartThings || false,
        localOnly: deviceData.localOnly || false,
        ports: deviceData.ports || [],
        createdAt: new Date().toISOString()
    };
    
    allDevices.push(device);
    devices = allDevices.filter(item => item.homeId === selectedHomeId);
    saveData({
        ...loadData(),
        devices: allDevices
    });
    
    // Sync ports bidirectionally
    syncDevicePorts(device.id, device.ports);
    
    window.location.href = 'devices.html';
}

function updateDevice(id, deviceData) {
    // Validate unique name
    const name = deviceData.name.trim();
    if (!name) {
        showAlert('Device name is required.');
        return;
    }
    
    if (devices.some(d => d.name && d.name.toLowerCase() === name.toLowerCase() && d.id !== id)) {
        showAlert('A device with this name already exists. Please choose a different name.');
        return;
    }
    
    const device = allDevices.find(d => d.id === id);
    if (device) {
        device.name = name;
        device.brand = normalizeOptionValue(deviceData.brand);
        device.model = deviceData.model.trim();
        device.type = normalizeOptionValue(deviceData.type);
        device.ip = deviceData.ip.trim() || '';
        device.mac = deviceData.mac.trim() || '';
        device.status = deviceData.status;
        device.power = deviceData.power;
        device.batteryType = normalizeOptionValue(deviceData.batteryType);
        device.batteryCount = deviceData.batteryCount ? parseInt(deviceData.batteryCount) : null;
        device.lastBatteryChange = deviceData.lastBatteryChange || '';
        device.batteryDuration = deviceData.batteryDuration ? parseFloat(deviceData.batteryDuration) : null;
        device.upsProtected = deviceData.upsProtected || false;
        device.idleConsumption = deviceData.idleConsumption ? parseFloat(deviceData.idleConsumption) : null;
        device.meanConsumption = deviceData.meanConsumption ? parseFloat(deviceData.meanConsumption) : null;
        device.maxConsumption = deviceData.maxConsumption ? parseFloat(deviceData.maxConsumption) : null;
        device.installationDate = deviceData.installationDate || '';
        device.storageSize = deviceData.storageSize ? parseFloat(deviceData.storageSize) : null;
        device.storageUnit = deviceData.storageUnit || '';
        device.notes = deviceData.notes ? deviceData.notes.trim() : '';
        device.homeId = deviceData.homeId || device.homeId || getSelectedHomeId();
        device.connectivity = normalizeOptionValue(deviceData.connectivity);
        device.area = deviceData.area;
        device.threadBorderRouter = deviceData.threadBorderRouter || false;
        device.matterHub = deviceData.matterHub || false;
        device.zigbeeController = deviceData.zigbeeController || false;
        device.zigbeeRepeater = deviceData.zigbeeRepeater || false;
        device.homeAssistant = deviceData.homeAssistant || false;
        device.googleHome = deviceData.googleHome || false;
        device.alexa = deviceData.alexa || false;
        device.appleHomeKit = deviceData.appleHomeKit || false;
        device.samsungSmartThings = deviceData.samsungSmartThings || false;
        device.localOnly = deviceData.localOnly || false;
        device.ports = deviceData.ports || [];
        device.updatedAt = new Date().toISOString();
        
        saveData({
            ...loadData(),
            devices: allDevices
        });
        
        // Sync ports bidirectionally
        syncDevicePorts(device.id, device.ports);
        devices = allDevices.filter(item => item.homeId === selectedHomeId);
        
        window.location.href = 'devices.html';
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

    allDevices = allDevices.filter(device => device.id !== editingDeviceId);
    allDevices.forEach(device => {
        if (device.ports && Array.isArray(device.ports)) {
            device.ports = device.ports.filter(port => port.connectedTo !== editingDeviceId);
        }
    });

    saveData({
        ...loadData(),
        devices: allDevices
    });

    window.location.href = 'devices.html';
}
