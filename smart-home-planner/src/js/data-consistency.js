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
const DEVICE_SCALAR_REF_FIELDS = ['wifiAccessPointId', 'zigbeeParentId', 'zwaveControllerId', 'bluetoothProxyId'];
// Array fields on the parent listing the device ids of its children/clients.
const DEVICE_ARRAY_REF_FIELDS = ['wifiLinkedDeviceIds', 'zigbeeLinkedDeviceIds', 'zwaveLinkedDeviceIds', 'bluetoothLinkedDeviceIds'];

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
    zwaveControllerId: 'Z-Wave controller',
    bluetoothProxyId: 'Bluetooth proxy'
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

// === Soft inconsistencies (warnings) ===
// Unlike validateDeviceForSave, these never block a save: the data is possible,
// just incomplete or suspicious. The device form surfaces them inline while you
// edit, and the dashboard card sweeps every saved device with the same rules.

// Maximum link speed each cable category can carry, in Mbps. Cat6 is listed at
// 10G because home runs are short enough for 10GBASE-T; rating it at 1G would
// flag the very common "Cat6 + multi-gig" setup as wrong.
const CABLE_MAX_MBPS = {
    cat1: 1, cat2: 4, cat3: 10, cat4: 16, cat5: 100, cat5e: 1000,
    cat6: 10000, cat6a: 10000, cat7: 10000, cat8: 40000
};

function normalizeText(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

// '2.5Gbps' -> 2500, '100Mbps' -> 100. Returns 0 when unparseable.
function parseLinkSpeedToMbps(speed) {
    const match = normalizeText(speed).match(/^([\d.]+)\s*(m|g)bps$/);
    if (!match) return 0;
    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount)) return 0;
    return match[2] === 'g' ? amount * 1000 : amount;
}

function isZigbeeConnectivityValue(value) {
    return normalizeText(value).includes('zigbee');
}

function isZwaveConnectivityValue(value) {
    const text = normalizeText(value);
    return text.includes('zwave') || text.includes('z-wave');
}

function isBluetoothConnectivityValue(value) {
    // Kept in sync with isBluetoothConnectivity in device-form.js, so a custom
    // option like "Bluetooth LE" is never flagged here without the form
    // offering the proxy field to fix it.
    const text = normalizeText(value);
    return text.startsWith('bluetooth') || text === 'ble';
}

function todayIsoDate() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function findPortById(device, portId) {
    if (!device || !Array.isArray(device.ports)) return null;
    const target = normalizeRefId(portId);
    if (!target) return null;
    return device.ports.find(port => port && normalizeRefId(port.id) === target) || null;
}

// All soft findings for a single device. `ctx` may carry { devicesById, devices,
// today } — the relational rules (PoE roles, parent capability, duplicate names)
// are skipped when it isn't provided, so the local rules work standalone.
function detectDeviceInconsistencies(device, ctx = {}) {
    const findings = [];
    if (!device || typeof device !== 'object') return findings;
    const devicesById = ctx.devicesById || null;
    const today = ctx.today || todayIsoDate();
    // `extra` may carry { dedupeKey, field, portId }. `field` names the device
    // property the finding is about — a semantic name, not a DOM id, so the form
    // can point at the right input while this module stays UI-agnostic.
    const push = (ruleId, severity, message, extra = {}) =>
        findings.push({ ruleId, severity, message, ...extra });

    const ports = Array.isArray(device.ports) ? device.ports : [];
    ports.forEach(port => {
        if (!port || typeof port !== 'object') return;

        // #1 — the cable category cannot carry the declared link speed.
        const cableMax = CABLE_MAX_MBPS[normalizeText(port.cableType)];
        const speedMbps = parseLinkSpeedToMbps(port.speed);
        if (cableMax && speedMbps && speedMbps > cableMax) {
            push('CAP_CABLE_SPEED', 'warning',
                `${String(port.cableType).replace(/^cat/i, 'Cat')} cable cannot carry ${port.speed}.`,
                { field: 'port.cableType', portId: normalizeRefId(port.id) });
        }

        // #3 — a PoE link where both ends only draw power (no PSE).
        if (devicesById && normalizeText(port.poeRole) === 'pd') {
            const remoteDevice = devicesById.get(normalizeRefId(port.connectedTo));
            const remotePort = findPortById(remoteDevice, port.connectedToPort);
            if (remotePort && normalizeText(remotePort.poeRole) === 'pd') {
                const linkKey = [
                    `${normalizeRefId(device.id)}:${normalizeRefId(port.id)}`,
                    `${normalizeRefId(remoteDevice.id)}:${normalizeRefId(remotePort.id)}`
                ].sort().join('|');
                push('POE_BOTH_PD', 'warning',
                    `PoE link with ${remoteDevice.name || 'another device'} has no power source (both ends are PD).`,
                    { dedupeKey: linkKey, field: 'port.poeRole', portId: normalizeRefId(port.id) });
            }
        }
    });

    // #4 — wireless device with no parent assigned.
    const connectivity = normalizeText(device.connectivity);
    if (isZigbeeConnectivityValue(connectivity) && !normalizeRefId(device.zigbeeParentId)) {
        push('ASSIGN_NO_ZIGBEE_PARENT', 'warning', 'Zigbee device with no parent assigned.',
            { field: 'zigbeeParentId' });
    }
    if (isZwaveConnectivityValue(connectivity) && !normalizeRefId(device.zwaveControllerId)) {
        push('ASSIGN_NO_ZWAVE_CTRL', 'warning', 'Z-Wave device with no controller assigned.',
            { field: 'zwaveControllerId' });
    }
    // A proxy is the coverage itself, so it never needs one assigned.
    if (isBluetoothConnectivityValue(connectivity) && !device.bluetoothProxy &&
        !normalizeRefId(device.bluetoothProxyId)) {
        push('ASSIGN_NO_BT_PROXY', 'warning', 'Bluetooth device with no proxy assigned.',
            { field: 'bluetoothProxyId' });
    }

    // #7 — the assigned parent cannot actually route for this protocol. Only
    // breaks after the fact (the pickers filter to capable devices), so it is an
    // error rather than a soft omission.
    if (devicesById) {
        const zigbeeParent = devicesById.get(normalizeRefId(device.zigbeeParentId));
        if (zigbeeParent && !zigbeeParent.zigbeeController && !zigbeeParent.zigbeeRepeater) {
            push('ROLE_ZIGBEE_PARENT', 'error',
                `Zigbee parent "${zigbeeParent.name || 'Unnamed'}" is neither a coordinator nor a repeater.`,
                { field: 'zigbeeParentId' });
        }
        const zwaveController = devicesById.get(normalizeRefId(device.zwaveControllerId));
        if (zwaveController && !zwaveController.zwaveController) {
            push('ROLE_ZWAVE_CTRL', 'error',
                `Z-Wave controller "${zwaveController.name || 'Unnamed'}" is not marked as a controller.`,
                { field: 'zwaveControllerId' });
        }
        const bluetoothProxy = devicesById.get(normalizeRefId(device.bluetoothProxyId));
        if (bluetoothProxy && !bluetoothProxy.bluetoothProxy) {
            push('ROLE_BT_PROXY', 'error',
                `Bluetooth proxy "${bluetoothProxy.name || 'Unnamed'}" is not marked as a proxy.`,
                { field: 'bluetoothProxyId' });
        }
    }

    // #8 — battery powered but no battery type chosen.
    if (normalizeText(device.power) === 'battery' && !normalizeText(device.batteryType)) {
        push('BATTERY_NO_TYPE', 'warning', 'Battery powered but no battery type selected.',
            { field: 'batteryType' });
    }

    // #11 — consumption figures recorded without saying how the device is powered.
    const hasConsumption = [device.idleConsumption, device.meanConsumption, device.maxConsumption]
        .some(value => value != null && String(value).trim() !== '');
    if (hasConsumption && !normalizeText(device.power)) {
        push('CONSUMPTION_NO_POWER', 'warning', 'Power consumption set but no power type selected.',
            { field: 'power' });
    }

    // #15 — dates that cannot have happened yet.
    if (device.purchaseDate && device.purchaseDate > today) {
        push('FUTURE_PURCHASE_DATE', 'warning', 'Purchase date is in the future.',
            { field: 'purchaseDate' });
    }
    if (device.lastBatteryChange && device.lastBatteryChange > today) {
        push('FUTURE_BATTERY_CHANGE', 'warning', 'Last battery change is in the future.',
            { field: 'lastBatteryChange' });
    }

    // #17 — another device already uses this name.
    if (ctx.devices && normalizeText(device.name)) {
        const selfId = normalizeRefId(device.id);
        const duplicate = ctx.devices.some(other =>
            other && normalizeRefId(other.id) !== selfId &&
            normalizeText(other.name) === normalizeText(device.name));
        if (duplicate) {
            // One finding per repeated name, not one per device sharing it.
            push('DUPLICATE_NAME', 'warning', 'Another device already uses this name.',
                { field: 'name', dedupeKey: `duplicate-name:${normalizeText(device.name)}` });
        }
    }

    return findings;
}

// Sweep every device and return flat findings for the dashboard card. Findings
// that describe a shared link are reported once, not once per end.
function detectAllInconsistencies(devices, options = {}) {
    if (!Array.isArray(devices)) return [];
    const devicesById = new Map();
    devices.forEach(device => {
        if (device && typeof device === 'object') {
            devicesById.set(normalizeRefId(device.id), device);
        }
    });
    const ctx = { devicesById, devices, today: options.today || todayIsoDate() };
    const seenDedupeKeys = new Set();
    const results = [];
    devices.forEach(device => {
        if (!device || typeof device === 'undefined') return;
        detectDeviceInconsistencies(device, ctx).forEach(finding => {
            if (finding.dedupeKey) {
                if (seenDedupeKeys.has(finding.dedupeKey)) return;
                seenDedupeKeys.add(finding.dedupeKey);
            }
            results.push({
                ...finding,
                deviceId: normalizeRefId(device.id),
                deviceName: device.name || device.model || 'Unnamed Device'
            });
        });
    });
    // Errors first, so the most structural problems lead the list.
    return results.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

// Some pages reach these through the global object; expose them like common.js
// does for its shared helpers.
window.countReferencesToDevice = countReferencesToDevice;
window.clearReferencesToDevice = clearReferencesToDevice;
window.validateDeviceForSave = validateDeviceForSave;
window.detectDeviceInconsistencies = detectDeviceInconsistencies;
window.detectAllInconsistencies = detectAllInconsistencies;
