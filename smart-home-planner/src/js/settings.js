// Settings Page JavaScript

let selectedFile = null;
let settings = {};
let networks = [];
let networkModalMode = 'add';
let networkModalTargetId = '';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    settings = await loadSettings();
    initializeEventListeners();
    renderRepoLink();
    renderHaIntegrationSettings();
    await renderNetworksManagement();
    renderOptionsManagement();
});

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
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeNetworkModal();
        }
    });
}

function renderHaIntegrationSettings() {
    const value = settings.haAreaSyncTarget === 'controlled' ? 'controlled' : 'installed';
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

// Export Data
async function exportData() {
    try {
        const data = await loadData();
        const settings = await loadSettings();

        const normalizedDevices = (data.devices || []).map(device => ({
            ...device,
            brand: normalizeOptionValue(device.brand),
            type: normalizeOptionValue(device.type),
            connectivity: normalizeOptionValue(device.connectivity),
            batteryType: normalizeOptionValue(device.batteryType)
        }));
        
        // Include map positions
        const mapPositions = await loadMapPositions();
        
        const exportData = {
            networks: data.networks || [],
            devices: normalizedDevices,
            settings: settings,
            mapPositions: mapPositions
        };
        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
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
        a.download = `smart-home-data-${datePart}-${timePart}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Show success message
        showMessage('Data exported successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showMessage('Error exporting data: ' + error.message, 'error');
    }
}

// Handle File Selection
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    if (!file.name.endsWith('.json')) {
        showMessage('Please select a JSON file.', 'error');
        return;
    }

    selectedFile = file;
    document.getElementById('import-file-name').textContent = file.name;
    document.getElementById('import-confirm-btn').style.display = 'inline-flex';
}

// Import Data
function importData() {
    if (!selectedFile) {
        showMessage('Please select a file first.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            
            // Validate data structure
            if (!validateDataStructure(importedData)) {
                showMessage('Invalid data format. Please check your JSON file.', 'error');
                return;
            }

            // Confirm before importing
            const confirmMessage = `This will replace all existing data with ${importedData.devices?.length || 0} devices. Are you sure?`;
            
            const confirmed = await showConfirm(confirmMessage, {
                title: 'Import data',
                confirmText: 'Import'
            });
            if (!confirmed) {
                return;
            }

            if (Array.isArray(importedData.devices)) {
                importedData.devices = importedData.devices.map(device => ({
                    ...device,
                    brand: normalizeOptionValue(device.brand),
                    type: normalizeOptionValue(device.type),
                    connectivity: normalizeOptionValue(device.connectivity),
                    batteryType: normalizeOptionValue(device.batteryType)
                }));
            }

            // Save imported data using the same method as saveData
            await saveData(importedData);
            
            // Import settings if present
            if (importedData.settings) {
                await saveSettings(importedData.settings);
            }
            
            // Import map positions if present
            if (importedData.mapPositions) {
                await saveMapPositions(importedData.mapPositions);
            } else {
                await clearMapPositions();
            }

            settings = await loadSettings();
            renderHaIntegrationSettings();
            await renderNetworksManagement();
            renderOptionsManagement();
            
            // Reset file input
            document.getElementById('import-file').value = '';
            document.getElementById('import-file-name').textContent = '';
            document.getElementById('import-confirm-btn').style.display = 'none';
            selectedFile = null;
            
            showMessage('Data imported successfully!', 'success');
        } catch (error) {
            console.error('Import error:', error);
            showMessage('Error importing data: ' + error.message, 'error');
        }
    };
    
    reader.onerror = function() {
        showMessage('Error reading file.', 'error');
    };
    
    reader.readAsText(selectedFile);
}

// Validate Data Structure
function validateDataStructure(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }

    // Check if it has the expected structure
    const hasDevices = Array.isArray(data.devices);

    return hasDevices;
}


// Show Message
function showMessage(message, type) {
    // Remove existing messages
    const existingMessage = document.querySelector('.settings-message');
    if (existingMessage) {
        existingMessage.remove();
    }

    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `settings-message settings-message-${type}`;
    messageEl.textContent = message;

    // Insert at the top of settings container
    const settingsContainer = document.querySelector('.settings-container');
    settingsContainer.insertBefore(messageEl, settingsContainer.firstChild);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (messageEl.parentNode) {
            messageEl.remove();
        }
    }, 5000);
}

function renderRepoLink() {
    const linkEl = document.getElementById('github-repo-link');
    const textEl = document.getElementById('github-repo-text');
    if (!linkEl || !textEl) return;
    if (typeof appRepoUrl !== 'string' || !appRepoUrl.trim()) {
        linkEl.closest('.settings-section')?.classList.add('is-hidden');
        return;
    }
    const url = appRepoUrl.trim();
    linkEl.href = url;
    const label = url.replace(/^https?:\/\//, '');
    textEl.textContent = label;
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
        haAreaSyncTarget: settings.haAreaSyncTarget === 'controlled' ? 'controlled' : 'installed'
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
