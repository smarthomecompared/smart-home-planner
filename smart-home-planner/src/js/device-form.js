// Device Form JavaScript (shared for add and edit)

let allDevices = [];
let devices = [];
let allAreas = [];
let areas = [];
let editingDeviceId = null;
let settings = {};
let networks = [];
let lastBrandValue = '';
let lastTypeValue = '';
let lastBatteryTypeValue = '';
let lastConnectivityValue = '';
let autoSyncAreasEnabled = false;
let activeDeviceId = '';
let deviceFiles = [];
let deviceFilePreviewModal = null;
let deviceFileRenameModal = null;
const HA_DEVICE_NAME_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-name') : '/api/ha/device-name';
const HA_DEVICE_AREA_SYNC_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/ha/device-area') : '/api/ha/device-area';
const DEVICE_FILES_UPLOAD_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files/upload') : '/api/device-files/upload';
const DEVICE_FILES_CONTENT_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files/content') : '/api/device-files/content';
const DEVICE_FILES_DELETE_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files') : '/api/device-files';
const DEVICE_FILES_RENAME_API_URL =
    typeof window.buildAppUrl === 'function' ? window.buildAppUrl('api/device-files/rename') : '/api/device-files/rename';
const MAX_DEVICE_FILE_BYTES = 20 * 1024 * 1024;

function isHomeAssistantLinked(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function showFormMessage(message, type = 'success') {
    if (typeof showToast === 'function') {
        showToast(message, type === 'error' ? 'error' : 'success');
    }
}

function generateDeviceId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeFileParam(value) {
    return encodeURIComponent(String(value || ''));
}

function getDeviceFileContentUrl(path, download = false) {
    const safePath = String(path || '').trim();
    if (!safePath) return '#';
    const downloadSuffix = download ? '&download=1' : '';
    return `${DEVICE_FILES_CONTENT_API_URL}?path=${escapeFileParam(safePath)}${downloadSuffix}`;
}

function formatFileSize(size) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function isImageMimeType(value) {
    return String(value || '').trim().toLowerCase().startsWith('image/');
}

function normalizeDeviceFiles(files) {
    const result = [];
    const seenPaths = new Set();
    (Array.isArray(files) ? files : []).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const path = String(item.path || '').trim();
        if (!path || seenPaths.has(path)) return;
        seenPaths.add(path);
        const name = String(item.name || path.split('/').pop() || 'file').trim() || 'file';
        const mimeType = String(item.mimeType || '').trim();
        const sizeRaw = Number(item.size);
        result.push({
            id: String(item.id || `file-${Math.random().toString(36).slice(2, 10)}`).trim(),
            name: name,
            path: path,
            mimeType: mimeType,
            size: Number.isFinite(sizeRaw) ? sizeRaw : 0,
            uploadedAt: String(item.uploadedAt || '').trim(),
            isImage: item.isImage === true || isImageMimeType(mimeType)
        });
    });
    return result;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadData();
    allDevices = data.devices;
    allAreas = data.areas;
    settings = await loadSettings();
    networks = data.networks || [];
    devices = allDevices;
    
    // Check if we're editing (device-edit.html)
    const urlParams = new URLSearchParams(window.location.search);
    editingDeviceId = urlParams.get('id');
    activeDeviceId = editingDeviceId || generateDeviceId();
    
    initializeEventListeners();
    initializeDeviceFilesSupport();
    populateBrands();
    populateTypes();
    populateConnectivity();
    populateNetworks();
    populateBatteryTypes();
    setAreas();
    handleBrandChange();
    handleConnectivityChange();
    handleStatusChange();
    
    if (editingDeviceId) {
        loadDeviceForEdit(editingDeviceId);
    } else {
        await loadDuplicateDeviceFromStorage();
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
    const areaSelect = document.getElementById('device-area');
    const controlledAreaSelect = document.getElementById('device-controlled-area');
    if (areaSelect) {
        areaSelect.addEventListener('change', () => handleAreaAutoSync(areaSelect, controlledAreaSelect));
    }
    if (controlledAreaSelect) {
        controlledAreaSelect.addEventListener('change', () => handleAreaAutoSync(controlledAreaSelect, areaSelect));
    }
    const deleteButton = document.getElementById('delete-device-btn');
    if (deleteButton) {
        deleteButton.addEventListener('click', handleDeleteDevice);
    }
    const applyButton = document.getElementById('apply-device-btn');
    if (applyButton) {
        applyButton.addEventListener('click', handleApplyDevice);
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
            closeDeviceFilePreviewModal();
            closeDeviceFileRenameModal();
            closeBrandModal();
            closeTypeModal();
            closeBatteryTypeModal();
            closeConnectivityModal();
        }
    });
}

function initializeDeviceFilesSupport() {
    const input = document.getElementById('device-files-input');
    const uploadButton = document.getElementById('device-files-upload-btn');
    const dropzone = document.getElementById('device-files-dropzone');

    if (!input || !uploadButton || !dropzone) return;

    uploadButton.addEventListener('click', (event) => {
        event.preventDefault();
        input.click();
    });

    input.addEventListener('change', async () => {
        const selectedFiles = Array.from(input.files || []);
        input.value = '';
        if (!selectedFiles.length) return;
        await uploadFilesForDevice(selectedFiles);
    });

    dropzone.addEventListener('click', (event) => {
        if (event.target && event.target.closest('#device-files-upload-btn')) return;
        input.click();
    });

    dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.click();
        }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.add('is-dragover');
        });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            if (eventName === 'dragleave' && event.target !== dropzone) return;
            dropzone.classList.remove('is-dragover');
        });
    });
    dropzone.addEventListener('drop', async (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
        const droppedFiles = Array.from(event.dataTransfer?.files || []);
        if (!droppedFiles.length) return;
        await uploadFilesForDevice(droppedFiles);
    });

    renderDeviceFiles();
}

function ensureDeviceFilePreviewModal() {
    if (deviceFilePreviewModal && document.body.contains(deviceFilePreviewModal.root)) {
        return deviceFilePreviewModal;
    }

    const root = document.createElement('div');
    root.className = 'modal is-hidden device-file-preview-modal';
    root.id = 'device-file-preview-modal';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="modal-overlay" data-device-file-preview-close></div>
        <div class="modal-content device-file-preview-modal-content" role="dialog" aria-modal="true" aria-labelledby="device-file-preview-title">
            <div class="device-file-preview-header">
                <div class="device-file-preview-title" id="device-file-preview-title">Image Preview</div>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-device-file-preview-close aria-label="Close preview">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6l12 12"></path>
                        <path d="M18 6L6 18"></path>
                    </svg>
                </button>
            </div>
            <div class="device-file-preview-body">
                <img class="device-file-preview-image" id="device-file-preview-image" alt="Image preview">
            </div>
        </div>
    `;
    document.body.appendChild(root);

    root.querySelectorAll('[data-device-file-preview-close]').forEach((element) => {
        element.addEventListener('click', closeDeviceFilePreviewModal);
    });

    deviceFilePreviewModal = {
        root: root,
        image: root.querySelector('#device-file-preview-image'),
        title: root.querySelector('#device-file-preview-title')
    };
    return deviceFilePreviewModal;
}

function openDeviceFilePreviewModal(filePath, fileName = '') {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    const modal = ensureDeviceFilePreviewModal();
    if (!modal || !modal.root || !modal.image || !modal.title) return;

    modal.title.textContent = String(fileName || 'Image Preview').trim() || 'Image Preview';
    modal.image.src = getDeviceFileContentUrl(normalizedPath);
    modal.image.alt = modal.title.textContent;
    modal.root.classList.remove('is-hidden');
    modal.root.setAttribute('aria-hidden', 'false');
}

function closeDeviceFilePreviewModal() {
    const modal = deviceFilePreviewModal;
    if (!modal || !modal.root || modal.root.classList.contains('is-hidden')) return;
    modal.root.classList.add('is-hidden');
    modal.root.setAttribute('aria-hidden', 'true');
    if (modal.image) {
        modal.image.src = '';
    }
}

function ensureDeviceFileRenameModal() {
    if (deviceFileRenameModal && document.body.contains(deviceFileRenameModal.root)) {
        return deviceFileRenameModal;
    }

    const root = document.createElement('div');
    root.className = 'modal is-hidden device-file-rename-modal';
    root.id = 'device-file-rename-modal';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="modal-overlay" data-device-file-rename-close></div>
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="device-file-rename-title">
            <div class="modal-header">
                <div class="modal-title" id="device-file-rename-title">Rename File</div>
                <button class="btn btn-secondary btn-sm btn-icon" type="button" data-device-file-rename-close aria-label="Close rename file dialog" title="Close">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6l12 12"></path>
                        <path d="M18 6L6 18"></path>
                    </svg>
                </button>
            </div>
            <div class="form-group">
                <label for="device-file-rename-input">File Name</label>
                <input type="text" id="device-file-rename-input" placeholder="Enter a new file name">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" type="button" data-device-file-rename-close>Cancel</button>
                <button class="btn btn-primary" type="button" id="device-file-rename-save-btn">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(root);

    root.querySelectorAll('[data-device-file-rename-close]').forEach((element) => {
        element.addEventListener('click', closeDeviceFileRenameModal);
    });

    const saveButton = root.querySelector('#device-file-rename-save-btn');
    const input = root.querySelector('#device-file-rename-input');
    if (saveButton) {
        saveButton.addEventListener('click', submitDeviceFileRename);
    }
    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitDeviceFileRename();
            }
        });
    }

    deviceFileRenameModal = {
        root: root,
        input: input,
        saveButton: saveButton
    };
    return deviceFileRenameModal;
}

function openDeviceFileRenameModal(filePath, currentName = '') {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    const modal = ensureDeviceFileRenameModal();
    if (!modal || !modal.root || !modal.input) return;
    modal.root.dataset.filePath = normalizedPath;
    modal.input.value = String(currentName || '').trim();
    modal.root.classList.remove('is-hidden');
    modal.root.setAttribute('aria-hidden', 'false');
    modal.input.focus();
    modal.input.select();
}

function closeDeviceFileRenameModal() {
    const modal = deviceFileRenameModal;
    if (!modal || !modal.root || modal.root.classList.contains('is-hidden')) return;
    modal.root.classList.add('is-hidden');
    modal.root.setAttribute('aria-hidden', 'true');
    modal.root.dataset.filePath = '';
    if (modal.input) {
        modal.input.value = '';
    }
    if (modal.saveButton) {
        modal.saveButton.disabled = false;
    }
}

async function submitDeviceFileRename() {
    const modal = ensureDeviceFileRenameModal();
    if (!modal || !modal.root || !modal.input) return;
    const filePath = String(modal.root.dataset.filePath || '').trim();
    const nextName = String(modal.input.value || '').trim();
    if (!filePath || !nextName) {
        showAlert('Please enter a valid file name.');
        return;
    }

    if (modal.saveButton) {
        modal.saveButton.disabled = true;
    }
    try {
        await renameDeviceFile(filePath, nextName);
        closeDeviceFileRenameModal();
    } finally {
        if (modal.saveButton) {
            modal.saveButton.disabled = false;
        }
    }
}

function renderDeviceFiles() {
    const list = document.getElementById('device-files-list');
    const empty = document.getElementById('device-files-empty');
    const count = document.getElementById('device-files-count');
    if (!list || !empty || !count) return;

    const normalizedFiles = normalizeDeviceFiles(deviceFiles);
    deviceFiles = normalizedFiles;

    count.textContent = `${normalizedFiles.length} file${normalizedFiles.length === 1 ? '' : 's'}`;
    if (!normalizedFiles.length) {
        list.innerHTML = '';
        empty.classList.remove('is-hidden');
        return;
    }

    empty.classList.add('is-hidden');
    list.innerHTML = normalizedFiles.map((file) => {
        const displayName = escapeHtml(file.name || 'file');
        const fileMeta = [formatFileSize(file.size), file.mimeType || 'Unknown type'].join(' • ');
        const preview = file.isImage
            ? `<button type="button" class="device-file-preview" data-device-file-view="${escapeHtml(file.path)}" data-device-file-name="${displayName}" title="View image">
                    <img src="${escapeHtml(getDeviceFileContentUrl(file.path))}" alt="${displayName}" loading="lazy">
               </button>`
            : `<div class="device-file-preview-static">
                    <span class="device-file-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>
                            <path d="M14 2v6h6"></path>
                            <path d="M9 15h6"></path>
                            <path d="M9 19h6"></path>
                            <path d="M9 11h3"></path>
                        </svg>
                    </span>
               </div>`;
        return `
            <article class="device-file-card">
                ${preview}
                <div class="device-file-content">
                    <div class="device-file-name">${displayName}</div>
                    <div class="device-file-meta">${escapeHtml(fileMeta)}</div>
                    <div class="device-file-actions">
                        <a class="device-file-action" href="${escapeHtml(getDeviceFileContentUrl(file.path, true))}" target="_blank" rel="noopener noreferrer">Download</a>
                        <button type="button" class="device-file-action" data-device-file-rename="${escapeHtml(file.path)}" data-device-file-current-name="${displayName}">Rename</button>
                        <button type="button" class="device-file-action device-file-action-danger" data-device-file-delete="${escapeHtml(file.path)}">Remove</button>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    list.querySelectorAll('[data-device-file-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
            const targetPath = button.getAttribute('data-device-file-delete') || '';
            if (!targetPath) return;
            button.disabled = true;
            try {
                await removeDeviceFile(targetPath);
            } finally {
                button.disabled = false;
            }
        });
    });

    list.querySelectorAll('[data-device-file-view]').forEach((button) => {
        button.addEventListener('click', () => {
            const targetPath = button.getAttribute('data-device-file-view') || '';
            const targetName = button.getAttribute('data-device-file-name') || 'Image Preview';
            if (!targetPath) return;
            openDeviceFilePreviewModal(targetPath, targetName);
        });
    });

    list.querySelectorAll('[data-device-file-rename]').forEach((button) => {
        button.addEventListener('click', () => {
            const targetPath = button.getAttribute('data-device-file-rename') || '';
            const currentName = button.getAttribute('data-device-file-current-name') || '';
            if (!targetPath) return;
            openDeviceFileRenameModal(targetPath, currentName);
        });
    });
}

async function uploadFilesForDevice(files) {
    const validFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!validFiles.length) return;

    const oversizedFiles = validFiles.filter((file) => Number(file.size) > MAX_DEVICE_FILE_BYTES);
    if (oversizedFiles.length) {
        showAlert(`Some files are too large. Maximum per file is ${formatFileSize(MAX_DEVICE_FILE_BYTES)}.`);
        return;
    }

    let successCount = 0;
    for (const file of validFiles) {
        try {
            const uploaded = await uploadDeviceFile(file);
            if (uploaded) {
                deviceFiles.push(uploaded);
                successCount += 1;
            }
        } catch (error) {
            console.error('Failed to upload device file:', error);
            showAlert(`Could not upload "${file.name}": ${error?.message || error}`);
        }
    }

    if (!successCount) {
        renderDeviceFiles();
        return;
    }

    renderDeviceFiles();
    await persistDeviceFilesForEditing();
    showFormMessage(`${successCount} file${successCount === 1 ? '' : 's'} uploaded successfully.`, 'success');
}

async function uploadDeviceFile(file) {
    const uploadUrl = `${DEVICE_FILES_UPLOAD_API_URL}?deviceId=${escapeFileParam(activeDeviceId)}`;
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name || 'file')
        },
        body: file
    });

    if (!response.ok) {
        let message = `Upload failed (${response.status})`;
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
    return normalizeDeviceFiles([payload])[0] || null;
}

async function removeDeviceFile(filePath) {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return;
    const deleteUrl = `${DEVICE_FILES_DELETE_API_URL}?path=${escapeFileParam(normalizedPath)}`;

    try {
        const response = await fetch(deleteUrl, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
            let message = `Delete failed (${response.status})`;
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
    } catch (error) {
        console.error('Failed to remove file from server:', error);
        showAlert(`Could not remove file: ${error?.message || error}`);
        return;
    }

    deviceFiles = deviceFiles.filter((file) => String(file.path || '').trim() !== normalizedPath);
    renderDeviceFiles();
    await persistDeviceFilesForEditing();
    showFormMessage('File removed successfully.', 'success');
}

async function renameDeviceFile(filePath, newName) {
    const normalizedPath = String(filePath || '').trim();
    const normalizedName = String(newName || '').trim();
    if (!normalizedPath || !normalizedName) return;

    let renamedFile = null;
    try {
        const response = await fetch(DEVICE_FILES_RENAME_API_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: normalizedPath,
                name: normalizedName
            })
        });
        if (!response.ok) {
            let message = `Rename failed (${response.status})`;
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
        renamedFile = normalizeDeviceFiles([payload?.file])[0] || null;
    } catch (error) {
        console.error('Failed to rename file:', error);
        showAlert(`Could not rename file: ${error?.message || error}`);
        return;
    }

    if (!renamedFile) return;
    deviceFiles = normalizeDeviceFiles(deviceFiles.map((file) => {
        if (String(file.path || '').trim() !== normalizedPath) {
            return file;
        }
        return {
            ...file,
            ...renamedFile,
            id: file.id || renamedFile.id,
            uploadedAt: file.uploadedAt || renamedFile.uploadedAt
        };
    }));
    renderDeviceFiles();
    await persistDeviceFilesForEditing();
    showFormMessage('File renamed successfully.', 'success');
}

async function persistDeviceFilesForEditing() {
    if (!editingDeviceId) return;
    const targetDevice = allDevices.find((device) => device.id === editingDeviceId);
    if (!targetDevice) return;
    targetDevice.files = normalizeDeviceFiles(deviceFiles);
    await saveData({
        ...(await loadData()),
        devices: allDevices
    });
}

async function deleteAllDeviceFiles(files) {
    const normalized = normalizeDeviceFiles(files);
    for (const file of normalized) {
        const deleteUrl = `${DEVICE_FILES_DELETE_API_URL}?path=${escapeFileParam(file.path)}`;
        try {
            await fetch(deleteUrl, { method: 'DELETE' });
        } catch (error) {
            console.error(`Failed to delete file "${file.path}"`, error);
        }
    }
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

function populateNetworks() {
    const networkSelect = document.getElementById('device-network');
    if (!networkSelect) return;
    const currentValue = networkSelect.value;
    const sortedNetworks = [...(networks || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    networkSelect.innerHTML = '<option value="">Select network</option>' +
        sortedNetworks.map(network => `<option value="${network.id}">${escapeHtml(network.name)}</option>`).join('');
    if (currentValue) {
        networkSelect.value = currentValue;
    }
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
    const controlledSelect = document.getElementById('device-controlled-area');
    const installedValue = areaSelect ? areaSelect.value : '';
    const controlledValue = controlledSelect ? controlledSelect.value : '';
    const sortedAreas = [...areas].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    );
    const optionsHtml = sortedAreas
        .map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`)
        .join('');

    if (areaSelect) {
        areaSelect.innerHTML = '<option value="">Select an area</option>' + optionsHtml;
        if (installedValue) {
            areaSelect.value = installedValue;
        }
    }

    if (controlledSelect) {
        controlledSelect.innerHTML = '<option value="">Select an area</option>' + optionsHtml;
        if (controlledValue) {
            controlledSelect.value = controlledValue;
        }
    }
}

function setAreas() {
    areas = allAreas;
    populateAreas();
    updateAreaAutoSyncState();
}

function buildHaDeviceDetailsUrl(deviceId) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) return '';
    return `${window.location.origin}/config/devices/device/${encodeURIComponent(normalizedId)}`;
}

function getHaAreaSyncTarget() {
    return settings?.haAreaSyncTarget === 'installed' ? 'installed' : 'controlled';
}

function updateHaAreaSyncNotes(isHaDevice) {
    const installedNote = document.getElementById('device-area-ha-note');
    const controlledNote = document.getElementById('device-controlled-area-ha-note');
    if (!installedNote && !controlledNote) return;

    const target = getHaAreaSyncTarget();
    if (installedNote) {
        installedNote.hidden = !isHaDevice || target !== 'installed';
    }
    if (controlledNote) {
        controlledNote.hidden = !isHaDevice || target !== 'controlled';
    }
}

function updateViewOnHaButton(device) {
    const viewOnHaButton = document.getElementById('view-on-ha-btn');
    const isHaDevice = isHomeAssistantLinked(device && device.homeAssistant);
    const nameHaNote = document.getElementById('device-name-ha-note');
    if (nameHaNote) {
        nameHaNote.hidden = !isHaDevice;
    }
    updateHaAreaSyncNotes(isHaDevice);
    if (!viewOnHaButton) return;

    const deviceId = device && device.id ? String(device.id).trim() : '';
    const haUrl = isHaDevice ? buildHaDeviceDetailsUrl(deviceId) : '';
    const showButton = Boolean(haUrl);

    viewOnHaButton.hidden = !showButton;
    if (showButton) {
        viewOnHaButton.href = haUrl;
    } else {
        viewOnHaButton.removeAttribute('href');
    }
}

function updateAreaAutoSyncState() {
    const installed = document.getElementById('device-area')?.value || '';
    const controlled = document.getElementById('device-controlled-area')?.value || '';
    autoSyncAreasEnabled = !installed && !controlled;
}

function handleAreaAutoSync(sourceSelect, targetSelect) {
    if (!autoSyncAreasEnabled) return;
    if (!sourceSelect) return;
    const value = sourceSelect.value;
    if (!value) return;
    if (targetSelect && !targetSelect.value) {
        targetSelect.value = value;
        autoSyncAreasEnabled = false;
    }
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

async function syncDeviceNameToHa(deviceId, name) {
    const normalizedId = String(deviceId || '').trim();
    const normalizedName = String(name || '').trim();
    if (!normalizedId || !normalizedName) {
        return;
    }

    const response = await fetch(HA_DEVICE_NAME_SYNC_API_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: normalizedId,
            name: normalizedName
        })
    });

    if (!response.ok) {
        let errorMessage = `Failed to update Home Assistant device name (${response.status})`;
        try {
            const payload = await response.json();
            if (payload && payload.error) {
                errorMessage = payload.error;
            }
        } catch (error) {
            // Ignore JSON parsing errors and keep the default message.
        }
        throw new Error(errorMessage);
    }
}

async function syncDeviceAreaToHa(deviceId, areaId) {
    const normalizedId = String(deviceId || '').trim();
    const normalizedAreaId = String(areaId || '').trim();
    if (!normalizedId) {
        return;
    }

    const response = await fetch(HA_DEVICE_AREA_SYNC_API_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: normalizedId,
            areaId: normalizedAreaId
        })
    });

    if (!response.ok) {
        let errorMessage = `Failed to update Home Assistant device area (${response.status})`;
        try {
            const payload = await response.json();
            if (payload && payload.error) {
                errorMessage = payload.error;
            }
        } catch (error) {
            // Ignore JSON parsing errors and keep the default message.
        }
        throw new Error(errorMessage);
    }
}

async function loadDuplicateDeviceFromStorage() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('duplicate') !== 'true') {
        return;
    }
    const stored = await getUiPreference('duplicateDevice');
    if (!stored) {
        return;
    }
    let duplicateData;
    try {
        duplicateData = typeof stored === 'string' ? JSON.parse(stored) : stored;
    } catch (error) {
        await setUiPreference('duplicateDevice', null);
        return;
    }
    duplicateData.installationDate = '';
    duplicateData.lastBatteryChange = '';
    duplicateData.files = [];
    loadDeviceData(duplicateData);
    await setUiPreference('duplicateDevice', null);
}

function loadDeviceData(device) {
    if (device && device.id) {
        activeDeviceId = String(device.id);
    }
    updateViewOnHaButton(device);
    setAreas();
    const deviceIdReadonly = document.getElementById('device-id-readonly');
    if (deviceIdReadonly) {
        deviceIdReadonly.textContent = device && device.id ? String(device.id) : '-';
    }
    document.getElementById('device-name').value = device.name || '';
    document.getElementById('device-brand').value = device.brand ? normalizeOptionValue(device.brand) : '';
    document.getElementById('device-model').value = device.model || '';
    document.getElementById('device-type').value = device.type ? normalizeOptionValue(device.type) : '';
    document.getElementById('device-ip').value = device.ip || '';
    document.getElementById('device-mac').value = device.mac || '';
    document.getElementById('device-status').value = device.status || 'working';
    document.getElementById('device-power').value = device.power || '';
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
    document.getElementById('device-connectivity').value = device.connectivity ? normalizeOptionValue(device.connectivity) : '';
    const networkSelect = document.getElementById('device-network');
    if (networkSelect) {
        networkSelect.value = device.networkId || '';
    }
    document.getElementById('device-area').value = device.area || '';
    const controlledAreaInput = document.getElementById('device-controlled-area');
    if (controlledAreaInput) {
        controlledAreaInput.value = device.controlledArea || '';
    }
    updateAreaAutoSyncState();
    
    // Load checkbox values
    document.getElementById('device-thread-border-router').checked = device.threadBorderRouter || false;
    document.getElementById('device-matter-hub').checked = device.matterHub || false;
    document.getElementById('device-zigbee-controller').checked = device.zigbeeController || false;
    document.getElementById('device-zigbee-repeater').checked = device.zigbeeRepeater || false;
    document.getElementById('device-home-assistant').checked = isHomeAssistantLinked(device.homeAssistant);
    document.getElementById('device-google-home').checked = device.googleHome || false;
    document.getElementById('device-alexa').checked = device.alexa || false;
    document.getElementById('device-apple-home-kit').checked = device.appleHomeKit || false;
    document.getElementById('device-samsung-smartthings').checked = device.samsungSmartThings || false;
    document.getElementById('device-local-only').checked = device.localOnly || false;
    deviceFiles = normalizeDeviceFiles(device.files);
    renderDeviceFiles();
    
    handlePowerTypeChange();
    handleConnectivityChange();
    handleBatteryTypeChange();
    handleBrandChange();
    handleStatusChange();
    lastTypeValue = document.getElementById('device-type').value;
    lastBatteryTypeValue = document.getElementById('device-battery-type').value;
    lastConnectivityValue = document.getElementById('device-connectivity').value;
    
    // Load ports
    if (device.ports) {
        loadPorts(device.ports);
    }
}

// Form Handlers
async function handleDeviceSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const shouldStayOnPage = form?.dataset?.submitMode === 'apply';
    if (form && form.dataset) {
        form.dataset.submitMode = 'save';
    }

    let connectivity = document.getElementById('device-connectivity').value;
    if (connectivity === '__new__') {
        showAlert('Please add a new connectivity option first.');
        return;
    }
    connectivity = normalizeOptionValue(connectivity);
    const ipValue = isWifiConnectivity(connectivity) ? document.getElementById('device-ip').value : '';
    const macValue = isWifiConnectivity(connectivity) ? document.getElementById('device-mac').value : '';
    const networkValue = isWifiConnectivity(connectivity) ? (document.getElementById('device-network')?.value || '') : '';
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

    const statusValue = document.getElementById('device-status').value;
    const isPendingStatus = statusValue === 'pending';
    const deviceData = {
        name: document.getElementById('device-name').value,
        brand: brandValue,
        model: document.getElementById('device-model').value,
        type: typeValue,
        ip: ipValue,
        mac: macValue,
        status: statusValue,
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
        networkId: networkValue,
        area: isPendingStatus ? '' : document.getElementById('device-area').value,
        controlledArea: isPendingStatus ? '' : (document.getElementById('device-controlled-area')?.value || ''),
        threadBorderRouter: document.getElementById('device-thread-border-router').checked,
        matterHub: document.getElementById('device-matter-hub').checked,
        zigbeeController: document.getElementById('device-zigbee-controller').checked,
        zigbeeRepeater: document.getElementById('device-zigbee-repeater').checked,
        googleHome: document.getElementById('device-google-home').checked,
        alexa: document.getElementById('device-alexa').checked,
        appleHomeKit: document.getElementById('device-apple-home-kit').checked,
        samsungSmartThings: document.getElementById('device-samsung-smartthings').checked,
        localOnly: document.getElementById('device-local-only').checked,
        ports: getPortsData(),
        files: normalizeDeviceFiles(deviceFiles)
    };
    
    if (editingDeviceId) {
        await updateDevice(editingDeviceId, deviceData, { stayOnPage: shouldStayOnPage });
    } else {
        await createDevice(deviceData);
    }
}

function handleApplyDevice() {
    const form = document.getElementById('device-form');
    if (!form || !editingDeviceId) return;
    form.dataset.submitMode = 'apply';
    if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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
    
    if (!powerType) {
        hideGroup(batteryTypeGroup);
        hideGroup(batteryCountGroup);
        hideGroup(batteryChangeGroup);
        hideGroup(batteryDurationGroup);
        hideGroup(upsProtectedGroup);
        hideGroup(idleConsumptionGroup);
        hideGroup(meanConsumptionGroup);
        hideGroup(maxConsumptionGroup);
        hideGroup(powerPortsSection);
        document.getElementById('device-battery-type').value = '';
        document.getElementById('device-battery-count').value = '';
        document.getElementById('device-last-battery-change').value = '';
        document.getElementById('device-battery-duration').value = '';
        document.getElementById('device-idle-consumption').value = '';
        document.getElementById('device-mean-consumption').value = '';
        document.getElementById('device-max-consumption').value = '';
        document.getElementById('device-ups-protected').checked = false;
    } else if (powerType === 'battery') {
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
    const isPending = status === 'pending';
    const areaGroup = document.getElementById('device-area-group');
    const controlledAreaGroup = document.getElementById('device-controlled-area-group');
    const areaSelect = document.getElementById('device-area');
    const controlledAreaSelect = document.getElementById('device-controlled-area');
    const installationGroup = document.getElementById('device-installation-group');
    const installationInput = document.getElementById('device-installation-date');
    const batteryChangeGroup = document.getElementById('battery-change-group');
    const batteryChangeInput = document.getElementById('device-last-battery-change');
    const hideInstallationDate = isWishlist || isPending;

    if (areaGroup) {
        areaGroup.classList.remove('is-collapsed');
        areaGroup.classList.toggle('is-hidden', isWishlist || isPending);
    }
    if (controlledAreaGroup) {
        controlledAreaGroup.classList.remove('is-collapsed');
        controlledAreaGroup.classList.toggle('is-hidden', isWishlist || isPending);
    }
    if (areaSelect) {
        areaSelect.required = false;
    }
    if (isPending) {
        if (areaSelect) {
            areaSelect.value = '';
        }
        if (controlledAreaSelect) {
            controlledAreaSelect.value = '';
        }
        updateAreaAutoSyncState();
    }
    if (installationGroup) {
        installationGroup.classList.remove('is-collapsed');
        installationGroup.classList.toggle('is-hidden', hideInstallationDate);
        if (hideInstallationDate && installationInput) {
            installationInput.value = '';
        }
    }
    if (batteryChangeGroup) {
        const shouldHideBatteryChange = isWishlist || document.getElementById('device-power').value !== 'battery';
        batteryChangeGroup.classList.toggle('is-collapsed', shouldHideBatteryChange);
        if (!shouldHideBatteryChange) {
            batteryChangeGroup.classList.remove('is-hidden');
        }
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

async function saveBrandModal() {
    const input = document.getElementById('brand-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a brand name.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.brands || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.brands = [...updatedSettings.brands, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
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

async function saveTypeModal() {
    const input = document.getElementById('type-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a type name.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.types || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.types = [...updatedSettings.types, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
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

async function saveBatteryTypeModal() {
    const input = document.getElementById('battery-type-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a battery type.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.batteryTypes || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.batteryTypes = [...updatedSettings.batteryTypes, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
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

async function saveConnectivityModal() {
    const input = document.getElementById('connectivity-modal-input');
    const name = input.value.trim();
    if (!name) {
        showAlert('Please enter a connectivity option.');
        return;
    }

    const updatedSettings = await loadSettings();
    const normalized = normalizeOptionValue(name);
    const hasMatch = (updatedSettings.connectivity || []).some(item => normalizeOptionValue(item) === normalized);
    if (!hasMatch) {
        updatedSettings.connectivity = [...updatedSettings.connectivity, name]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        await saveSettings(updatedSettings);
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
    const networkGroup = document.getElementById('network-group');
    const showNetworkFields = isWifiConnectivity(connectivity);

    ipGroup.classList.toggle('is-hidden', !showNetworkFields);
    macGroup.classList.toggle('is-hidden', !showNetworkFields);
    if (networkGroup) {
        networkGroup.classList.toggle('is-hidden', !showNetworkFields);
    }

    if (!showNetworkFields) {
        document.getElementById('device-ip').value = '';
        document.getElementById('device-mac').value = '';
        const networkSelect = document.getElementById('device-network');
        if (networkSelect) {
            networkSelect.value = '';
        }
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
async function syncDevicePorts(currentDeviceId, currentDevicePorts) {
    // Reload all devices to get the latest data
    const allData = await loadData();
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
    await saveData(allData);
    
    // Update local devices array
    devices = allDevices;
}

// Make removePort available globally
window.removePort = removePort;

// CRUD Operations
async function createDevice(deviceData) {
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
    
    let nextDeviceId = String(activeDeviceId || '').trim() || generateDeviceId();
    if (allDevices.some(device => String(device.id || '') === nextDeviceId)) {
        nextDeviceId = generateDeviceId();
    }
    activeDeviceId = nextDeviceId;

    const device = {
        id: nextDeviceId,
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
        connectivity: normalizeOptionValue(deviceData.connectivity),
        networkId: deviceData.networkId || '',
        area: deviceData.area,
        controlledArea: deviceData.controlledArea || '',
        threadBorderRouter: deviceData.threadBorderRouter || false,
        matterHub: deviceData.matterHub || false,
        zigbeeController: deviceData.zigbeeController || false,
        zigbeeRepeater: deviceData.zigbeeRepeater || false,
        homeAssistant: false,
        googleHome: deviceData.googleHome || false,
        alexa: deviceData.alexa || false,
        appleHomeKit: deviceData.appleHomeKit || false,
        samsungSmartThings: deviceData.samsungSmartThings || false,
        localOnly: deviceData.localOnly || false,
        ports: deviceData.ports || [],
        files: normalizeDeviceFiles(deviceData.files),
        createdAt: new Date().toISOString()
    };
    
    allDevices.push(device);
    devices = allDevices;
    await saveData({
        ...(await loadData()),
        devices: allDevices
    });
    
    // Sync ports bidirectionally
    await syncDevicePorts(device.id, device.ports);
    
    window.location.href = 'devices.html';
}

async function updateDevice(id, deviceData, options = {}) {
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
        const previousName = String(device.name || '').trim();
        const previousArea = String(device.area || '').trim();
        const previousControlledArea = String(device.controlledArea || '').trim();
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
        device.connectivity = normalizeOptionValue(deviceData.connectivity);
        device.networkId = deviceData.networkId || '';
        device.area = deviceData.area;
        device.controlledArea = deviceData.controlledArea || '';
        device.threadBorderRouter = deviceData.threadBorderRouter || false;
        device.matterHub = deviceData.matterHub || false;
        device.zigbeeController = deviceData.zigbeeController || false;
        device.zigbeeRepeater = deviceData.zigbeeRepeater || false;
        device.googleHome = deviceData.googleHome || false;
        device.alexa = deviceData.alexa || false;
        device.appleHomeKit = deviceData.appleHomeKit || false;
        device.samsungSmartThings = deviceData.samsungSmartThings || false;
        device.localOnly = deviceData.localOnly || false;
        device.ports = deviceData.ports || [];
        device.files = normalizeDeviceFiles(deviceData.files);
        device.updatedAt = new Date().toISOString();
        
        await saveData({
            ...(await loadData()),
            devices: allDevices
        });
        
        // Sync ports bidirectionally
        await syncDevicePorts(device.id, device.ports);
        if (isHomeAssistantLinked(device.homeAssistant)) {
            const currentName = String(device.name || '').trim();
            const shouldSyncName = previousName !== currentName;
            const areaSyncTarget = getHaAreaSyncTarget();
            const previousTargetArea = areaSyncTarget === 'installed' ? previousArea : previousControlledArea;
            const nextTargetArea = areaSyncTarget === 'installed'
                ? String(device.area || '').trim()
                : String(device.controlledArea || '').trim();
            const shouldSyncArea = previousTargetArea !== nextTargetArea;

            try {
                if (shouldSyncName) {
                    await syncDeviceNameToHa(device.id, device.name);
                }
            } catch (error) {
                console.error('Failed to sync device name to Home Assistant:', error);
                await showAlert(`Device was saved locally, but Home Assistant name update failed: ${error?.message || error}`, {
                    title: 'Home Assistant Sync Failed'
                });
                return;
            }
            try {
                if (shouldSyncArea) {
                    await syncDeviceAreaToHa(device.id, nextTargetArea);
                }
            } catch (error) {
                console.error('Failed to sync device area to Home Assistant:', error);
                await showAlert(`Device was saved locally, but Home Assistant area update failed: ${error?.message || error}`, {
                    title: 'Home Assistant Sync Failed'
                });
                return;
            }
        }
        devices = allDevices;
        
        if (options.stayOnPage) {
            showFormMessage('Device saved successfully.', 'success');
            return;
        }

        if (!options.stayOnPage) {
            window.location.href = 'devices.html';
        }
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

    try {
        await addDeviceToExcludedListIfInHa(editingDeviceId);
    } catch (error) {
        console.error('Failed to add device to excluded_devices:', error);
    }

    const deviceToDelete = allDevices.find((device) => device.id === editingDeviceId);
    if (deviceToDelete) {
        await deleteAllDeviceFiles(deviceToDelete.files);
    }

    allDevices = allDevices.filter(device => device.id !== editingDeviceId);
    allDevices.forEach(device => {
        if (device.ports && Array.isArray(device.ports)) {
            device.ports = device.ports.filter(port => port.connectedTo !== editingDeviceId);
        }
    });

    await saveData({
        ...(await loadData()),
        devices: allDevices
    });

    window.location.href = 'devices.html';
}
