// Dedicated Map page.
// Reuses the shared DeviceFilters (js/device-filters.js) and DeviceMap
// (js/map-cytoscape.js) modules: the page owns the filter drawer and pushes the
// filtered device list into the map, exactly like the Devices page used to.

let allDevices = [];
let devices = [];
let filteredDevices = [];
let areas = [];
let floors = [];
let networks = [];
let isps = [];
let labels = [];
let settings = {};
let deviceFilters = null;
let mapReady = false;

function normalizeLabelCatalog(values) {
    return (Array.isArray(values) ? values : [])
        .filter((label) => label && typeof label === 'object');
}

function updateDeviceCount(count) {
    const countLabel = document.getElementById('devices-count');
    if (!countLabel) return;
    countLabel.textContent = `${count} ${count === 1 ? 'device' : 'devices'}`;
}

function ensureMapReady() {
    if (mapReady) return;
    if (!window.DeviceMap) return;
    if (!document.getElementById('network-map')) return;
    window.DeviceMap.init({
        devices,
        areas,
        floors,
        networks,
        isps,
        settings,
        filteredDevices
    });
    mapReady = true;
}

document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadData();
    allDevices = data.devices || [];
    settings = await loadSettings();
    areas = data.areas || [];
    floors = data.floors || [];
    networks = data.networks || [];
    isps = data.isps || [];
    labels = normalizeLabelCatalog(data.labels);
    devices = allDevices;
    filteredDevices = devices;

    // Initialize filters (the drawer, chips, badge and clear are all wired
    // internally by DeviceFilters.init).
    deviceFilters = new DeviceFilters();
    deviceFilters.init(devices, areas, floors, networks, settings, labels);
    deviceFilters.onFilterChange = (filtered) => {
        filteredDevices = filtered;
        updateDeviceCount(filteredDevices.length);
        if (mapReady && window.DeviceMap) {
            window.DeviceMap.setFilteredDevices(filteredDevices);
        }
    };

    ensureMapReady();
    if (window.DeviceMap) {
        window.DeviceMap.setVisible(true);
    }

    // Apply the initial (empty) filter state so the map renders and the device
    // count reflects the full inventory.
    deviceFilters.applyFilters();
});
