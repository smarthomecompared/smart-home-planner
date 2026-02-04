// Settings Page JavaScript

let selectedFile = null;
let settings = {};
let homes = [];
let selectedHomeId = '';
let homeModalMode = 'add';
let homeModalTargetId = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    settings = loadSettings();
    initializeEventListeners();
    renderVersionInfo();
    renderRepoLink();
    renderHomesManagement();
    renderOptionsManagement();
    initializeDemoMode();
});

// Event Listeners
function initializeEventListeners() {
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', handleFileSelect);
    document.getElementById('import-confirm-btn').addEventListener('click', importData);
    document.getElementById('home-add-btn').addEventListener('click', () => openHomeModal('add'));
    document.getElementById('home-modal-cancel').addEventListener('click', closeHomeModal);
    document.getElementById('home-modal-save').addEventListener('click', handleHomeModalSave);
    document.getElementById('home-modal-overlay').addEventListener('click', closeHomeModal);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeHomeModal();
        }
    });
}

function initializeDemoMode() {
    const toggle = document.getElementById('demo-mode-toggle');
    if (!toggle) return;
    toggle.checked = window.isDemoModeEnabled ? window.isDemoModeEnabled() : false;
    toggle.addEventListener('change', async (event) => {
        const shouldEnable = event.target.checked;
        if (shouldEnable) {
            const confirmed = await showConfirm('Enable demo mode? This will load sample data until you turn it off.', {
                title: 'Enable demo mode',
                confirmText: 'Enable'
            });
            if (!confirmed) {
                event.target.checked = false;
                return;
            }
            const success = await enableDemoMode();
            if (!success) {
                event.target.checked = false;
            }
        } else {
            const confirmed = await showConfirm('Disable demo mode and restore your previous data?', {
                title: 'Disable demo mode',
                confirmText: 'Disable'
            });
            if (!confirmed) {
                event.target.checked = true;
                return;
            }
            await disableDemoMode();
        }
    });
}

// Export Data
function exportData() {
    try {
        const data = loadData();
        const settings = loadSettings();

        const normalizedDevices = (data.devices || []).map(device => ({
            ...device,
            brand: normalizeOptionValue(device.brand),
            type: normalizeOptionValue(device.type),
            connectivity: normalizeOptionValue(device.connectivity),
            batteryType: normalizeOptionValue(device.batteryType)
        }));
        
        // Include map positions
        const mapPositionsStr = localStorage.getItem('smart-home-network-positions');
        const mapPositions = mapPositionsStr ? JSON.parse(mapPositionsStr) : {};
        
        const exportData = {
            ...data,
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
            const confirmMessage = `This will replace all existing data with ${importedData.devices?.length || 0} devices, ${importedData.areas?.length || 0} areas, ${importedData.floors?.length || 0} floors, and ${importedData.homes?.length || 0} homes. Are you sure?`;
            
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
            saveData(importedData);
            
            // Import settings if present
            if (importedData.settings) {
                saveSettings(importedData.settings);
            }
            
            // Import map positions if present
            if (importedData.mapPositions) {
                localStorage.setItem('smart-home-network-positions', JSON.stringify(importedData.mapPositions));
            }

            if (window.isDemoModeEnabled && window.isDemoModeEnabled()) {
                const demoKeys = window.DEMO_STORAGE_KEYS;
                if (demoKeys) {
                    localStorage.setItem(demoKeys.ENABLED, 'false');
                    localStorage.removeItem(demoKeys.SNAPSHOT);
                }
                if (window.updateDemoBanner) {
                    window.updateDemoBanner(false);
                }
                const demoToggle = document.getElementById('demo-mode-toggle');
                if (demoToggle) {
                    demoToggle.checked = false;
                }
            }

            settings = loadSettings();
            renderHomesManagement();
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

    // Check if it has the expected structure (devices, areas, floors arrays)
    const hasDevices = Array.isArray(data.devices);
    const hasAreas = Array.isArray(data.areas);
    const hasFloors = Array.isArray(data.floors);

    return hasDevices && hasAreas && hasFloors;
}

async function enableDemoMode() {
    const demoKeys = window.DEMO_STORAGE_KEYS;
    if (!demoKeys) return false;
    if (!localStorage.getItem(demoKeys.SNAPSHOT)) {
        const snapshot = {
            ...loadData(),
            settings: loadSettings(),
            mapPositions: localStorage.getItem(demoKeys.MAP_POSITIONS)
                ? JSON.parse(localStorage.getItem(demoKeys.MAP_POSITIONS))
                : null
        };
        localStorage.setItem(demoKeys.SNAPSHOT, JSON.stringify(snapshot));
    }

    const response = await fetch('json/sample.json', { cache: 'no-store' });
    if (!response.ok) {
        showMessage('Unable to load demo data.', 'error');
        return false;
    }
    const demoData = await response.json();

    if (Array.isArray(demoData.devices)) {
        demoData.devices = demoData.devices.map(device => ({
            ...device,
            brand: normalizeOptionValue(device.brand),
            type: normalizeOptionValue(device.type),
            connectivity: normalizeOptionValue(device.connectivity),
            batteryType: normalizeOptionValue(device.batteryType)
        }));
    }

    saveData(demoData);
    if (demoData.settings) {
        saveSettings(demoData.settings);
    }
    if (demoData.mapPositions) {
        localStorage.setItem(demoKeys.MAP_POSITIONS, JSON.stringify(demoData.mapPositions));
    } else {
        localStorage.removeItem(demoKeys.MAP_POSITIONS);
    }

    localStorage.setItem(demoKeys.ENABLED, 'true');
    if (window.updateDemoBanner) {
        window.updateDemoBanner(true);
    }
    settings = loadSettings();
    renderHomesManagement();
    renderOptionsManagement();
    showMessage('Demo mode enabled.', 'success');
    return true;
}

async function disableDemoMode() {
    const demoKeys = window.DEMO_STORAGE_KEYS;
    if (!demoKeys) return;
    const snapshotRaw = localStorage.getItem(demoKeys.SNAPSHOT);
    if (!snapshotRaw) {
        localStorage.setItem(demoKeys.ENABLED, 'false');
        if (window.updateDemoBanner) {
            window.updateDemoBanner(false);
        }
        showMessage('Demo mode disabled.', 'success');
        return;
    }

    const snapshot = JSON.parse(snapshotRaw);
    saveData(snapshot);
    if (snapshot.settings) {
        saveSettings(snapshot.settings);
    }

    if (snapshot.mapPositions) {
        localStorage.setItem(demoKeys.MAP_POSITIONS, JSON.stringify(snapshot.mapPositions));
    } else {
        localStorage.removeItem(demoKeys.MAP_POSITIONS);
    }

    localStorage.setItem(demoKeys.ENABLED, 'false');
    localStorage.removeItem(demoKeys.SNAPSHOT);
    if (window.updateDemoBanner) {
        window.updateDemoBanner(false);
    }
    settings = loadSettings();
    renderHomesManagement();
    renderOptionsManagement();
    showMessage('Demo mode disabled. Your data has been restored.', 'success');
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

function renderVersionInfo() {
    const badgeEl = document.getElementById('settings-version-badge');
    const dateEl = document.getElementById('settings-version-date');
    const notesWrap = document.getElementById('settings-version-notes');
    const notesEl = document.getElementById('settings-version-note');
    if (!badgeEl || !dateEl) return;
    const version = typeof appVersion === 'string' && appVersion.trim() ? appVersion.trim() : '0.1.0';
    const releaseDate = typeof appReleaseDate === 'string' && appReleaseDate.trim() ? appReleaseDate.trim() : 'Unknown';
    const releaseNotes = Array.isArray(appReleaseNotes)
        ? appReleaseNotes.map(note => String(note).trim()).filter(Boolean)
        : (typeof appReleaseNotes === 'string' && appReleaseNotes.trim() ? [appReleaseNotes.trim()] : []);
    badgeEl.textContent = `v${version}`;
    dateEl.textContent = releaseDate;
    if (notesWrap && notesEl) {
        if (releaseNotes.length) {
            notesEl.innerHTML = releaseNotes
                .map(note => `<li>${escapeHtml(note)}</li>`)
                .join('');
            notesWrap.classList.remove('is-hidden');
        } else {
            notesWrap.classList.add('is-hidden');
        }
    }
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

function renderHomesManagement() {
    const data = loadData();
    homes = data.homes || [];
    selectedHomeId = data.selectedHomeId || '';

    const list = document.getElementById('homes-list');
    if (!list) return;

    list.innerHTML = homes.map(home => {
        const isCurrent = home.id === selectedHomeId;
        return `
            <div class="homes-item">
                <div class="homes-item-info">
                    <span>${escapeHtml(home.name)}</span>
                </div>
                <div class="homes-item-actions">
                    <button class="btn btn-secondary btn-sm btn-icon" data-home-rename="${home.id}" aria-label="Rename home" title="Rename home">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0 0-3l-2-2a2.12 2.12 0 0 0-3 0L4 16v4z"></path>
                            <path d="M13.5 6.5l4 4"></path>
                        </svg>
                    </button>
                    ${isCurrent ? '' : `<button class="btn btn-danger btn-sm btn-icon" data-home-delete="${home.id}" aria-label="Delete home" title="Delete home">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18"></path>
                            <path d="M8 6V4h8v2"></path>
                            <path d="M6 6l1 14h10l1-14"></path>
                            <path d="M10 11v6"></path>
                            <path d="M14 11v6"></path>
                        </svg>
                    </button>`}
                    ${isCurrent ? '<span class="current-home-badge">Current</span>' : `<button class="btn btn-secondary btn-sm" data-home-switch="${home.id}">Mark as current</button>`}
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('button[data-home-delete]').forEach(button => {
        button.addEventListener('click', () => {
            const homeId = button.getAttribute('data-home-delete');
            handleDeleteHome(homeId);
        });
    });

    list.querySelectorAll('button[data-home-switch]').forEach(button => {
        button.addEventListener('click', () => {
            const homeId = button.getAttribute('data-home-switch');
            handleHomeSwitch(homeId);
        });
    });

    list.querySelectorAll('button[data-home-rename]').forEach(button => {
        button.addEventListener('click', () => {
            const homeId = button.getAttribute('data-home-rename');
            openHomeModal('rename', homeId);
        });
    });
}

function openHomeModal(mode, homeId = '') {
    const modal = document.getElementById('home-modal');
    const title = document.getElementById('home-modal-title');
    const input = document.getElementById('home-modal-input');
    if (!modal || !title || !input) return;

    homeModalMode = mode;
    homeModalTargetId = homeId;
    const currentHome = homes.find(home => home.id === homeId);

    title.textContent = mode === 'rename' ? 'Rename Home' : 'Add Home';
    input.value = mode === 'rename' && currentHome ? currentHome.name : '';

    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.focus();
    input.select();
}

function closeHomeModal() {
    const modal = document.getElementById('home-modal');
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function handleHomeModalSave() {
    const input = document.getElementById('home-modal-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        showMessage('Home name cannot be empty.', 'error');
        return;
    }
    if (homes.some(home => home.name.toLowerCase() === name.toLowerCase() && home.id !== homeModalTargetId)) {
        showMessage('A home with this name already exists.', 'error');
        return;
    }

    const data = loadData();
    if (homeModalMode === 'rename') {
        const updatedHomes = (data.homes || []).map(home => (
            home.id === homeModalTargetId ? { ...home, name: name } : home
        ));
        saveData({
            ...data,
            homes: updatedHomes
        });
        showMessage('Home renamed successfully!', 'success');
    } else {
        const newHome = buildHome(name);
        const updatedHomes = [...(data.homes || []), newHome];
        saveData({
            ...data,
            homes: updatedHomes
        });
        showMessage('Home created successfully!', 'success');
    }

    closeHomeModal();
    renderHomesManagement();
}

function handleHomeSwitch(nextHomeId) {
    if (!nextHomeId || nextHomeId === selectedHomeId) {
        return;
    }
    const data = loadData();
    saveData({
        ...data,
        selectedHomeId: nextHomeId
    });
    renderHomesManagement();
    showMessage('Home switched successfully!', 'success');
}

async function handleDeleteHome(homeId) {
    if (!homeId) return;
    if (homes.length <= 1) {
        showMessage('You must keep at least one home.', 'error');
        return;
    }
    const targetHome = homes.find(home => home.id === homeId);
    const name = targetHome ? targetHome.name : 'this home';
    const confirmed = await showConfirm(`Delete "${name}"? Devices in this home will move to the selected home.`, {
        title: 'Delete home',
        confirmText: 'Delete'
    });
    if (!confirmed) {
        return;
    }

    const data = loadData();
    const remainingHomes = (data.homes || []).filter(home => home.id !== homeId);
    let nextSelectedHomeId = data.selectedHomeId;
    if (nextSelectedHomeId === homeId || !remainingHomes.some(home => home.id === nextSelectedHomeId)) {
        nextSelectedHomeId = remainingHomes[0].id;
    }

    const updatedDevices = (data.devices || []).map(device => {
        if (device.homeId === homeId) {
            return {
                ...device,
                homeId: nextSelectedHomeId
            };
        }
        return device;
    });
    const updatedAreas = (data.areas || []).map(area => {
        if (area.homeId === homeId) {
            return {
                ...area,
                homeId: nextSelectedHomeId
            };
        }
        return area;
    });
    const updatedFloors = (data.floors || []).map(floor => {
        if (floor.homeId === homeId) {
            return {
                ...floor,
                homeId: nextSelectedHomeId
            };
        }
        return floor;
    });

    saveData({
        ...data,
        homes: remainingHomes,
        selectedHomeId: nextSelectedHomeId,
        devices: updatedDevices,
        areas: updatedAreas,
        floors: updatedFloors
    });

    renderHomesManagement();
    showMessage('Home deleted successfully!', 'success');
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

function saveOptions() {
    const optionsConfig = ['brands', 'types', 'connectivity', 'batteryTypes'];
    const newSettings = {};
    
    optionsConfig.forEach(key => {
        const textarea = document.getElementById(`option-${key}`);
        const values = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(v => v.length > 0);
        newSettings[key] = values;
    });
    
    saveSettings(newSettings);
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
        
        saveSettings(defaultSettings);
        settings = defaultSettings;
        renderOptionsManagement();
        showMessage('Options reset to defaults successfully!', 'success');
    }
}
