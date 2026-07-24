// Data consistency helpers shared across the app.
//
// Single source of truth for how one device references another. Each wireless
// relationship is stored as a bidirectional pair — a scalar back-reference on
// the child (points at its AP/parent/controller) and a linked-device array on
// the parent (lists its clients/children). Wired connections live on the ports.
// These pairs are kept in sync when a device is saved, so the delete paths must
// clear them explicitly or dangling references survive (a deleted access point
// leaves every client pointing at a device that no longer exists, and so on).

// Scalar fields on the child pointing up to a single device.
const DEVICE_SCALAR_REF_FIELDS = ['wifiAccessPointId', 'zigbeeParentId', 'zwaveControllerId'];
// Array fields on the parent listing the device ids of its children/clients.
const DEVICE_ARRAY_REF_FIELDS = ['wifiLinkedDeviceIds', 'zigbeeLinkedDeviceIds', 'zwaveLinkedDeviceIds'];

function normalizeRefId(value) {
    return String(value == null ? '' : value).trim();
}

// True when `device` holds at least one reference to `targetId` (scalar, array
// or port). `targetId` is expected already normalized.
function deviceReferencesId(device, targetId) {
    if (!device || typeof device !== 'object') return false;
    if (DEVICE_SCALAR_REF_FIELDS.some(field => normalizeRefId(device[field]) === targetId)) {
        return true;
    }
    if (DEVICE_ARRAY_REF_FIELDS.some(field =>
        Array.isArray(device[field]) && device[field].some(id => normalizeRefId(id) === targetId))) {
        return true;
    }
    if (Array.isArray(device.ports) &&
        device.ports.some(port => port && normalizeRefId(port.connectedTo) === targetId)) {
        return true;
    }
    return false;
}

// Count how many *other* devices reference `deviceId`. Used to warn before a
// delete how many devices will be unassigned / disconnected.
function countReferencesToDevice(devices, deviceId) {
    const targetId = normalizeRefId(deviceId);
    if (!targetId || !Array.isArray(devices)) return 0;
    return devices.reduce((count, device) => {
        if (!device || typeof device !== 'object') return count;
        if (normalizeRefId(device.id) === targetId) return count;
        return deviceReferencesId(device, targetId) ? count + 1 : count;
    }, 0);
}

// Clear every reference to `deviceId` across the given devices, mutating them in
// place, and return how many references were cleared. Handles the three scalar
// back-references, the three linked-device arrays and port connections. Ports
// themselves are kept — only their connection is released.
function clearReferencesToDevice(devices, deviceId) {
    const targetId = normalizeRefId(deviceId);
    let cleared = 0;
    if (!targetId || !Array.isArray(devices)) return cleared;
    devices.forEach(device => {
        if (!device || typeof device !== 'object') return;
        if (normalizeRefId(device.id) === targetId) return;
        DEVICE_SCALAR_REF_FIELDS.forEach(field => {
            if (normalizeRefId(device[field]) === targetId) {
                device[field] = '';
                cleared += 1;
            }
        });
        DEVICE_ARRAY_REF_FIELDS.forEach(field => {
            if (!Array.isArray(device[field])) return;
            const before = device[field].length;
            device[field] = device[field].filter(id => normalizeRefId(id) !== targetId);
            cleared += before - device[field].length;
        });
        if (Array.isArray(device.ports)) {
            device.ports.forEach(port => {
                if (port && normalizeRefId(port.connectedTo) === targetId) {
                    port.connectedTo = '';
                    port.connectedToPort = '';
                    cleared += 1;
                }
            });
        }
    });
    return cleared;
}

// Blocking validation for the device form: contradictions that make the data
// impossible, not merely incomplete. Returns an array of human-readable error
// strings — an empty array means the device is safe to save. `selfId` is the id
// of the device being edited (empty for a new device), used to catch references
// a device makes to itself. Kept here so the form (on save) and, later, the
// consistency card share one definition of what counts as invalid.
const SELF_REF_LABELS = {
    wifiAccessPointId: 'access point',
    zigbeeParentId: 'Zigbee parent',
    zwaveControllerId: 'Z-Wave controller'
};

function validateDeviceForSave(device, selfId) {
    const errors = [];
    if (!device || typeof device !== 'object') return errors;
    const id = normalizeRefId(selfId);

    // A device cannot be its own access point / parent / controller.
    if (id) {
        DEVICE_SCALAR_REF_FIELDS.forEach(field => {
            if (normalizeRefId(device[field]) === id) {
                errors.push(`A device cannot be its own ${SELF_REF_LABELS[field]}.`);
            }
        });
    }

    // Port-level contradictions.
    const ports = Array.isArray(device.ports) ? device.ports : [];
    let selfConnectedPort = false;
    let poeOnNonEthernet = false;
    let connectionMissingPort = false;
    ports.forEach(port => {
        if (!port || typeof port !== 'object') return;
        const target = normalizeRefId(port.connectedTo);
        // connectedTo holds a device id, so pointing at our own id means the port
        // is wired to another port on the same device.
        if (id && target === id) {
            selfConnectedPort = true;
        }
        // A port linked to a device but with no remote port picked is an
        // incomplete connection: the other end can't be resolved.
        if (target && !normalizeRefId(port.connectedToPort)) {
            connectionMissingPort = true;
        }
        // PoE is only offered on Ethernet ports; a leftover value on any other
        // kind (e.g. after switching the port to USB) is invalid.
        if (port.poeStandard && String(port.type || '').split('-')[0] !== 'ethernet') {
            poeOnNonEthernet = true;
        }
    });
    if (selfConnectedPort) {
        errors.push('A port cannot be connected to another port on the same device.');
    }
    if (connectionMissingPort) {
        errors.push('A port is connected to a device but no remote port is selected. Pick the remote port or clear the connection.');
    }
    if (poeOnNonEthernet) {
        errors.push('PoE can only be set on Ethernet ports.');
    }

    // A battery-powered device needs at least one battery.
    if (String(device.power || '') === 'battery') {
        const raw = device.batteryCount;
        if (raw != null && String(raw).trim() !== '' && !(Number(raw) >= 1)) {
            errors.push('Number of batteries must be at least 1.');
        }
    }

    // Date inputs are YYYY-MM-DD, so lexicographic comparison is chronological.
    // A device cannot be installed before it was purchased, and its warranty
    // cannot expire before then either.
    if (device.installationDate && device.purchaseDate &&
        device.installationDate < device.purchaseDate) {
        errors.push('Installation date cannot be earlier than the purchase date.');
    }
    if (device.warrantyExpiration && device.purchaseDate &&
        device.warrantyExpiration < device.purchaseDate) {
        errors.push('Warranty expiration cannot be earlier than the purchase date.');
    }

    return errors;
}

// Some pages reach these through the global object; expose them like common.js
// does for its shared helpers.
window.countReferencesToDevice = countReferencesToDevice;
window.clearReferencesToDevice = clearReferencesToDevice;
window.validateDeviceForSave = validateDeviceForSave;
