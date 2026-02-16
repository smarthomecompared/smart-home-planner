// Settings Page JavaScript

let selectedFile = null;
let settings = {};
let networks = [];
let networkModalMode = 'add';
let networkModalTargetId = '';
let activeSettingsPanel = 'general';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    initializeGithubSocialLink();
    initializeSettingsSubmenu('general');
    initializeEventListeners();
    renderHaIntegrationSettings();
    await renderExcludedDevicesManagement();
    await renderNetworksManagement();
    renderOptionsManagement();
});

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
    document.querySelectorAll('input[name="ha-area-sync-target"]').forEach((radio) => {
        radio.addEventListener('change', saveHaIntegrationSettings);
    });
    document.getElementById('network-add-btn').addEventListener('click', () => openNetworkModal('add'));
    document.getElementById('network-modal-cancel').addEventListener('click', closeNetworkModal);
    document.getElementById('network-modal-save').addEventListener('click', handleNetworkModalSave);
    document.getElementById('network-modal-overlay').addEventListener('click', closeNetworkModal);
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
            closeNetworkModal();
        }
    });
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

function buildRestoredDeviceFromHa(haDevice) {
    const id = normalizeExcludedDeviceId(haDevice?.id);
    const areaId = normalizeExcludedDeviceId(haDevice?.area_id);
    return {
        id: id,
        name: pickHaDeviceName(haDevice) || id,
        brand: normalizeHaBrandName(haDevice?.manufacturer),
        model: String(haDevice?.model || '').trim(),
        homeAssistant: true,
        status: 'working',
        area: areaId,
        controlledArea: areaId
    };
}

async function renderExcludedDevicesManagement() {
    const listEl = document.getElementById('excluded-devices-list');
    const emptyEl = document.getElementById('excluded-devices-empty');
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = '';

    let excludedIds = [];
    let haDevices = [];

    try {
        const storage = await loadStorage();
        excludedIds = getExcludedDeviceIds(storage);
        haDevices = await loadHaRegistry(getHaDevicesApiUrl());
    } catch (error) {
        console.error('Failed to load excluded devices:', error);
        emptyEl.textContent = 'Failed to load excluded devices.';
        emptyEl.classList.remove('is-hidden');
        return;
    }

    if (!excludedIds.length) {
        emptyEl.textContent = 'No excluded devices.';
        emptyEl.classList.remove('is-hidden');
        return;
    }

    const haById = new Map(
        haDevices
            .filter(device => device && typeof device === 'object')
            .map(device => [normalizeExcludedDeviceId(device.id), device])
            .filter(([id]) => Boolean(id))
    );

    excludedIds.forEach((deviceId) => {
        const haDevice = haById.get(deviceId);
        const item = document.createElement('div');
        item.className = 'excluded-device-item';

        const info = document.createElement('div');
        info.className = 'excluded-device-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'excluded-device-name';
        nameEl.textContent = haDevice ? (pickHaDeviceName(haDevice) || deviceId) : 'Device not found in Home Assistant';

        const metaEl = document.createElement('div');
        metaEl.className = 'excluded-device-meta';
        metaEl.textContent = `ID: ${deviceId}`;

        const statusEl = document.createElement('div');
        statusEl.className = `excluded-device-status ${haDevice ? 'is-available' : 'is-missing'}`;
        statusEl.textContent = haDevice ? 'Available in Home Assistant' : 'Missing from Home Assistant';

        info.appendChild(nameEl);
        info.appendChild(metaEl);
        info.appendChild(statusEl);

        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn btn-primary btn-sm';
        restoreBtn.textContent = 'Restore';
        restoreBtn.disabled = !haDevice;
        restoreBtn.addEventListener('click', async () => {
            restoreBtn.disabled = true;
            try {
                await restoreExcludedDevice(deviceId);
            } finally {
                restoreBtn.disabled = false;
            }
        });

        item.appendChild(info);
        item.appendChild(restoreBtn);
        listEl.appendChild(item);
    });

    emptyEl.classList.add('is-hidden');
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
            showMessage('Device not found in Home Assistant registry.', 'error');
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
        a.download = `samart-home-planner-${datePart}-${timePart}.tar`;
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


// Options Management
function renderOptionsManagement() {
    const container = document.getElementById('options-management');
    
    const optionsConfig = [
        { key: 'brands', label: 'Brands', placeholder: 'e.g., Samsung, LG' },
        { key: 'types', label: 'Device Types', placeholder: 'e.g., cameras, sensors' },
        { key: 'connectivity', label: 'Connectivity Options', placeholder: 'e.g., wifi, zigbee' },
        { key: 'batteryTypes', label: 'Battery Types', placeholder: 'e.g., USB, AA' }
    ];
    
    container.innerHTML = optionsConfig.map(config => {
        const values = (settings[config.key] || [])
            .map(value => String(value))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        return `
            <div class="option-group">
                <h4>${config.label}</h4>
                <p class="option-description">One item per line. Values are case-sensitive.</p>
                <textarea id="option-${config.key}" class="option-textarea" rows="8" placeholder="${config.placeholder}">${values.join('\n')}</textarea>
            </div>
        `;
    }).join('');
    
    // Add save button
    container.innerHTML += `
        <div class="option-actions">
            <button class="btn btn-primary" id="save-options-btn">Save Options</button>
            <button class="btn btn-secondary" id="reset-options-btn">Reset to Defaults</button>
        </div>
    `;
    
    // Add event listeners
    document.getElementById('save-options-btn').addEventListener('click', saveOptions);
    document.getElementById('reset-options-btn').addEventListener('click', resetOptions);
}

async function saveOptions() {
    const optionsConfig = ['brands', 'types', 'connectivity', 'batteryTypes'];
    const newSettings = {
        haAreaSyncTarget: settings.haAreaSyncTarget === 'installed' ? 'installed' : 'controlled'
    };
    
    optionsConfig.forEach(key => {
        const textarea = document.getElementById(`option-${key}`);
        const values = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(v => v.length > 0);
        newSettings[key] = values;
    });
    
    await saveSettings(newSettings);
    settings = newSettings;
    showMessage('Options saved successfully!', 'success');
}

async function resetOptions() {
    const confirmed = await showConfirm('Are you sure you want to reset all options to their default values? This cannot be undone.', {
        title: 'Reset options',
        confirmText: 'Reset'
    });
    if (confirmed) {
        const defaultSettings = getDefaultSettings();
        
        await saveSettings(defaultSettings);
        settings = defaultSettings;
        renderHaIntegrationSettings();
        renderOptionsManagement();
        showMessage('Options reset to defaults successfully!', 'success');
    }
}
