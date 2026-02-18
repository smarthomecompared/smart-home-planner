// Device Diagram JavaScript with Cytoscape.js

window.DeviceDiagram = (() => {
    const DIAGRAM_BACKGROUND_UI_KEY = 'diagramBackground';
    const DIAGRAM_BACKGROUND_OPACITY_UI_KEY = 'diagramBackgroundOpacity';
    const DIAGRAM_BACKGROUND_DEVICE_ID = 'diagram-background';
    const DEVICE_FILES_UPLOAD_URL = typeof window.buildAppUrl === 'function'
        ? window.buildAppUrl('api/device-files/upload')
        : '/api/device-files/upload';
    const DEVICE_FILES_DELETE_URL = typeof window.buildAppUrl === 'function'
        ? window.buildAppUrl('api/device-files')
        : '/api/device-files';
    const DEVICE_FILES_CONTENT_URL = typeof window.buildAppUrl === 'function'
        ? window.buildAppUrl('api/device-files/content')
        : '/api/device-files/content';

    let devices = [];
    let areas = [];
    let floors = [];
    let networks = [];
    let settings = {};
    let filteredDevices = null;
    let cy = null;
    let deviceFilters = null;
    let isLayoutEditable = false;
    let hasUnsavedLayoutChanges = false;
    let isPanningFromNode = false;
    let lastPanPosition = null;
    let cachedPositions = null;
    let isInitialized = false;
    let diagramBackgroundFile = null;
    let diagramBackgroundOpacity = 55;
    let fullscreenMapAspectRatio = null;
    let diagramBackgroundImageUrl = '';
    let diagramBackgroundImagePath = '';
    let diagramBackgroundImageAspectRatio = null;
    let diagramBackgroundViewportSnapshot = null;
    let diagramBackgroundViewportAnchor = null;
    const BACKGROUND_NORMALIZED_POSITION_SPACE = 'background-normalized';

    function init(options = {}) {
        if (isInitialized) return;
        const mapContainer = document.getElementById('network-map');
        if (!mapContainer) return;
        if (typeof cytoscape === 'undefined') {
            console.error('Cytoscape library not loaded.');
            return;
        }

        devices = Array.isArray(options.devices) ? options.devices : [];
        areas = Array.isArray(options.areas) ? options.areas : [];
        floors = Array.isArray(options.floors) ? options.floors : [];
        networks = Array.isArray(options.networks) ? options.networks : [];
        settings = options.settings || {};
        filteredDevices = Array.isArray(options.filteredDevices) ? options.filteredDevices : null;

        if (options.enableFilters && window.DeviceFilters) {
            deviceFilters = new DeviceFilters();
            deviceFilters.init(devices, areas, floors, networks, settings);
            deviceFilters.onFilterChange = () => {
                if (filteredDevices === null) {
                    renderNetwork();
                }
            };
        }

        initializeEventListeners();
        initializeCytoscape();
        void loadDiagramBackgroundPreference();
        renderNetwork();
        isInitialized = true;
    }

    async function initWithStoredData(options = {}) {
        const data = await loadData();
        init({
            ...options,
            devices: data.devices || [],
            areas: data.areas || [],
            floors: data.floors || [],
            networks: data.networks || [],
            settings: await loadSettings()
        });
    }

    function updateData(next = {}) {
        if (Array.isArray(next.devices)) {
            devices = next.devices;
        }
        if (Array.isArray(next.areas)) {
            areas = next.areas;
        }
        if (Array.isArray(next.floors)) {
            floors = next.floors;
        }
        if (Array.isArray(next.networks)) {
            networks = next.networks;
        }
        if (next.settings) {
            settings = next.settings;
        }

        if (deviceFilters) {
            deviceFilters.updateData(devices, areas, floors, networks, settings);
            deviceFilters.applyFilters();
        }

        renderNetwork();
    }

    function setFilteredDevices(next) {
        filteredDevices = Array.isArray(next) ? next : [];
        renderNetwork();
    }

    function setVisible(isVisible) {
        if (!cy) return;
        if (!isVisible) return;
        resizeCytoscape();
    }

    function normalizeDiagramBackgroundPayload(value) {
        if (!value || typeof value !== 'object') return null;
        const path = String(value.path || '').trim().replace(/\\/g, '/');
        if (!path || !path.startsWith('device-files/')) return null;
        return {
            path,
            name: String(value.name || '').trim(),
            mimeType: String(value.mimeType || '').trim()
        };
    }

    function normalizeDiagramBackgroundOpacity(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 55;
        return Math.min(100, Math.max(0, Math.round(parsed)));
    }

    function getDiagramBackgroundDisplayName(file) {
        if (!file) return 'No background image';
        const name = String(file.name || '').trim();
        if (name) return name;
        const parts = String(file.path || '').split('/');
        return parts.length ? parts[parts.length - 1] : 'Background image';
    }

    function updateDiagramBackgroundControls() {
        const nameEl = document.getElementById('diagram-background-name');
        const replaceBtn = document.getElementById('diagram-background-replace-btn');
        const removeBtn = document.getElementById('diagram-background-remove-btn');
        const uploadBtn = document.getElementById('diagram-background-upload-btn');
        const opacityInput = document.getElementById('diagram-background-opacity');
        const opacityValue = document.getElementById('diagram-background-opacity-value');
        const hasBackground = Boolean(diagramBackgroundFile && diagramBackgroundFile.path);

        if (nameEl) {
            nameEl.textContent = getDiagramBackgroundDisplayName(diagramBackgroundFile);
        }
        if (uploadBtn) {
            uploadBtn.hidden = hasBackground;
        }
        if (replaceBtn) {
            replaceBtn.hidden = !hasBackground;
        }
        if (removeBtn) {
            removeBtn.hidden = !hasBackground;
        }
        if (opacityInput) {
            opacityInput.value = String(diagramBackgroundOpacity);
        }
        if (opacityValue) {
            opacityValue.textContent = `${diagramBackgroundOpacity}%`;
        }
    }

    function getDiagramBackgroundFrame() {
        const mapContainer = document.getElementById('network-map');
        if (!mapContainer) return null;
        const width = mapContainer.clientWidth;
        const height = mapContainer.clientHeight;
        if (!width || !height) return null;

        if (!diagramBackgroundFile || !diagramBackgroundFile.path) {
            return {
                x: 0,
                y: 0,
                width,
                height
            };
        }

        const ratio = Number(diagramBackgroundImageAspectRatio) > 0
            ? diagramBackgroundImageAspectRatio
            : (width / Math.max(height, 1));
        if (!Number.isFinite(ratio) || ratio <= 0) {
            return {
                x: 0,
                y: 0,
                width,
                height
            };
        }

        const containerRatio = width / Math.max(height, 1);
        if (containerRatio > ratio) {
            const frameWidth = height * ratio;
            return {
                x: (width - frameWidth) / 2,
                y: 0,
                width: frameWidth,
                height
            };
        }

        const frameHeight = width / ratio;
        return {
            x: 0,
            y: (height - frameHeight) / 2,
            width,
            height: frameHeight
        };
    }

    function hasDiagramBackground() {
        return Boolean(diagramBackgroundFile && diagramBackgroundFile.path);
    }

    function resetDiagramBackgroundViewportAnchor() {
        if (!cy || !hasDiagramBackground()) {
            diagramBackgroundViewportAnchor = null;
            return;
        }
        const pan = cy.pan();
        const zoom = cy.zoom();
        if (!Number.isFinite(zoom) || zoom <= 0) {
            diagramBackgroundViewportAnchor = null;
            return;
        }
        diagramBackgroundViewportAnchor = {
            pan: {
                x: pan.x,
                y: pan.y
            },
            zoom
        };
    }

    function applyDiagramBackgroundViewportTransform() {
        const backgroundLayer = document.getElementById('network-map-background');
        if (!backgroundLayer) return;
        if (!cy || !hasDiagramBackground()) {
            backgroundLayer.style.transformOrigin = '';
            return;
        }
        if (!diagramBackgroundViewportAnchor) {
            resetDiagramBackgroundViewportAnchor();
        }
        const anchor = diagramBackgroundViewportAnchor;
        if (!anchor || !Number.isFinite(anchor.zoom) || anchor.zoom <= 0) {
            return;
        }
        const pan = cy.pan();
        const zoom = cy.zoom();
        if (!Number.isFinite(zoom) || zoom <= 0) {
            return;
        }
        const scale = zoom / anchor.zoom;
        const translateX = pan.x - anchor.pan.x * scale;
        const translateY = pan.y - anchor.pan.y * scale;
        backgroundLayer.style.transformOrigin = '0 0';
        backgroundLayer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }

    function captureDiagramBackgroundViewportSnapshot() {
        if (!cy) {
            diagramBackgroundViewportSnapshot = null;
            return;
        }
        const frame = getDiagramBackgroundFrame();
        if (!frame) return;
        const pan = cy.pan();
        diagramBackgroundViewportSnapshot = {
            frame: {
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height
            },
            pan: {
                x: pan.x,
                y: pan.y
            },
            zoom: cy.zoom()
        };
    }

    function clampNumber(value, min, max) {
        if (!Number.isFinite(value)) return min;
        return Math.min(max, Math.max(min, value));
    }

    function parseSavedAbsolutePosition(value) {
        if (!value || typeof value !== 'object') return null;
        if (String(value.coordinateSpace || '') === BACKGROUND_NORMALIZED_POSITION_SPACE) {
            return null;
        }
        const x = Number(value.x);
        const y = Number(value.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    function parseSavedNormalizedPosition(value) {
        if (!value || typeof value !== 'object') return null;
        if (String(value.coordinateSpace || '') !== BACKGROUND_NORMALIZED_POSITION_SPACE) {
            return null;
        }
        const x = Number(value.x);
        const y = Number(value.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
            x: clampNumber(x, 0, 1),
            y: clampNumber(y, 0, 1)
        };
    }

    function buildCurrentBackgroundNormalizedPositions() {
        if (!cy || !diagramBackgroundFile || !diagramBackgroundFile.path) return null;
        const frame = getDiagramBackgroundFrame();
        if (!frame || frame.width <= 0 || frame.height <= 0) return null;

        const positions = new Map();
        cy.nodes('[type="device"]').forEach((node) => {
            const rendered = node.renderedPosition();
            const normalizedX = clampNumber((rendered.x - frame.x) / frame.width, 0, 1);
            const normalizedY = clampNumber((rendered.y - frame.y) / frame.height, 0, 1);
            positions.set(node.id(), {
                x: normalizedX,
                y: normalizedY
            });
        });
        return positions;
    }

    function applyBackgroundNormalizedPositions(positionsByDeviceId) {
        if (!cy || !positionsByDeviceId || positionsByDeviceId.size === 0) return false;
        if (!diagramBackgroundFile || !diagramBackgroundFile.path) return false;

        const frame = getDiagramBackgroundFrame();
        if (!frame || frame.width <= 0 || frame.height <= 0) return false;

        const zoom = cy.zoom();
        const pan = cy.pan();
        if (!Number.isFinite(zoom) || zoom <= 0) return false;

        cy.batch(() => {
            positionsByDeviceId.forEach((normalizedPosition, deviceId) => {
                const node = cy.getElementById(deviceId);
                if (!node || node.empty()) return;
                const renderedX = frame.x + normalizedPosition.x * frame.width;
                const renderedY = frame.y + normalizedPosition.y * frame.height;
                node.position({
                    x: (renderedX - pan.x) / zoom,
                    y: (renderedY - pan.y) / zoom
                });
            });
        });
        return true;
    }

    function serializeDevicePosition(node) {
        if (!node) return null;
        const hasBackground = Boolean(diagramBackgroundFile && diagramBackgroundFile.path);
        if (!hasBackground) {
            return node.position();
        }

        const frame = getDiagramBackgroundFrame();
        if (!frame || frame.width <= 0 || frame.height <= 0) {
            return node.position();
        }

        const rendered = node.renderedPosition();
        return {
            x: clampNumber((rendered.x - frame.x) / frame.width, 0, 1),
            y: clampNumber((rendered.y - frame.y) / frame.height, 0, 1),
            coordinateSpace: BACKGROUND_NORMALIZED_POSITION_SPACE
        };
    }

    async function migratePositionsToBackgroundNormalized(existingPositions) {
        if (!diagramBackgroundFile || !diagramBackgroundFile.path) return;
        const normalizedPositions = buildCurrentBackgroundNormalizedPositions();
        if (!normalizedPositions || normalizedPositions.size === 0) return;

        const next = existingPositions && typeof existingPositions === 'object'
            ? { ...existingPositions }
            : {};

        normalizedPositions.forEach((position, deviceId) => {
            next[deviceId] = {
                x: position.x,
                y: position.y,
                coordinateSpace: BACKGROUND_NORMALIZED_POSITION_SPACE
            };
        });

        try {
            await saveMapPositions(next);
        } catch (error) {
            console.warn('Unable to migrate map positions to normalized background coordinates:', error);
        }
    }

    function loadDiagramBackgroundAspectRatio(imageUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const width = Number(image.naturalWidth);
                const height = Number(image.naturalHeight);
                if (!width || !height) {
                    reject(new Error('Invalid background image size.'));
                    return;
                }
                resolve(width / height);
            };
            image.onerror = () => {
                reject(new Error('Unable to load background image.'));
            };
            image.src = imageUrl;
        });
    }

    async function refreshDiagramBackgroundAspectRatio(imageUrl) {
        if (!imageUrl) {
            diagramBackgroundImageAspectRatio = null;
            diagramBackgroundViewportSnapshot = null;
            return;
        }
        try {
            const ratio = await loadDiagramBackgroundAspectRatio(imageUrl);
            if (imageUrl !== diagramBackgroundImageUrl) {
                return;
            }
            diagramBackgroundImageAspectRatio = ratio;
        } catch (_error) {
            if (imageUrl !== diagramBackgroundImageUrl) {
                return;
            }
            diagramBackgroundImageAspectRatio = null;
        }
        captureDiagramBackgroundViewportSnapshot();
    }

    function applyDiagramBackground(options = {}) {
        const refreshImage = Boolean(options && options.refreshImage);
        const mapContainer = document.getElementById('network-map');
        const backgroundLayer = document.getElementById('network-map-background');
        if (!mapContainer || !backgroundLayer) return;

        if (!diagramBackgroundFile || !diagramBackgroundFile.path) {
            mapContainer.classList.remove('has-background');
            backgroundLayer.classList.remove('has-background');
            backgroundLayer.style.backgroundImage = '';
            backgroundLayer.style.opacity = '0';
            diagramBackgroundImageUrl = '';
            diagramBackgroundImagePath = '';
            diagramBackgroundImageAspectRatio = null;
            diagramBackgroundViewportSnapshot = null;
            diagramBackgroundViewportAnchor = null;
            backgroundLayer.style.transformOrigin = '';
            backgroundLayer.style.transform = '';
            return;
        }

        const backgroundPath = String(diagramBackgroundFile.path);
        const shouldRefreshImage = refreshImage || !diagramBackgroundImageUrl || backgroundPath !== diagramBackgroundImagePath;
        if (shouldRefreshImage) {
            const cacheToken = Date.now();
            diagramBackgroundImageUrl = `${DEVICE_FILES_CONTENT_URL}?path=${encodeURIComponent(backgroundPath)}&t=${cacheToken}`;
            diagramBackgroundImagePath = backgroundPath;
            backgroundLayer.style.backgroundImage = `url("${diagramBackgroundImageUrl}")`;
            void refreshDiagramBackgroundAspectRatio(diagramBackgroundImageUrl);
        }
        mapContainer.classList.add('has-background');
        backgroundLayer.classList.add('has-background');
        backgroundLayer.style.opacity = String(diagramBackgroundOpacity / 100);
        if (refreshImage || !diagramBackgroundViewportAnchor) {
            resetDiagramBackgroundViewportAnchor();
        }
        applyDiagramBackgroundViewportTransform();
    }

    async function persistDiagramBackgroundTuning() {
        await setUiPreference(DIAGRAM_BACKGROUND_OPACITY_UI_KEY, diagramBackgroundOpacity);
    }

    async function setDiagramBackgroundState(file, persist, rerender = true) {
        const previousPath = diagramBackgroundFile && diagramBackgroundFile.path
            ? String(diagramBackgroundFile.path)
            : '';
        diagramBackgroundFile = normalizeDiagramBackgroundPayload(file);
        const nextPath = diagramBackgroundFile && diagramBackgroundFile.path
            ? String(diagramBackgroundFile.path)
            : '';
        const shouldRefreshImage = Boolean(nextPath) && (nextPath !== previousPath || persist);
        updateDiagramBackgroundControls();
        applyDiagramBackground({ refreshImage: shouldRefreshImage });

        if (rerender && cy) {
            await renderNetwork();
        }

        if (!persist) return;
        await setUiPreference(DIAGRAM_BACKGROUND_UI_KEY, diagramBackgroundFile);
    }

    async function loadDiagramBackgroundPreference() {
        try {
            const [storedFile, storedOpacity] = await Promise.all([
                getUiPreference(DIAGRAM_BACKGROUND_UI_KEY),
                getUiPreference(DIAGRAM_BACKGROUND_OPACITY_UI_KEY)
            ]);
            diagramBackgroundOpacity = normalizeDiagramBackgroundOpacity(storedOpacity);
            await setDiagramBackgroundState(storedFile, false, false);
            updateDiagramBackgroundControls();
        } catch (error) {
            console.error('Failed to load diagram background preference:', error);
            diagramBackgroundOpacity = 55;
            await setDiagramBackgroundState(null, false, false);
            updateDiagramBackgroundControls();
        }
    }

    function rememberMapAspectRatio() {
        const mapContainer = document.getElementById('network-map');
        if (!mapContainer) return;
        const width = mapContainer.clientWidth;
        const height = mapContainer.clientHeight;
        if (!width || !height) return;
        fullscreenMapAspectRatio = width / height;
    }

    function clearFullscreenMapFrameStyles() {
        const mapContainer = document.getElementById('network-map');
        const backgroundLayer = document.getElementById('network-map-background');
        if (mapContainer) {
            mapContainer.style.width = '';
            mapContainer.style.height = '';
            mapContainer.style.left = '';
            mapContainer.style.top = '';
            mapContainer.style.transform = '';
        }
        if (backgroundLayer) {
            backgroundLayer.style.width = '';
            backgroundLayer.style.height = '';
            backgroundLayer.style.left = '';
            backgroundLayer.style.top = '';
        }
    }

    function updateFullscreenMapFrame() {
        if (!document.body.classList.contains('map-fullscreen')) return;
        const mapContainer = document.getElementById('network-map');
        const backgroundLayer = document.getElementById('network-map-background');
        if (!mapContainer || !backgroundLayer) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        if (!viewportWidth || !viewportHeight) return;

        mapContainer.style.width = `${viewportWidth}px`;
        mapContainer.style.height = `${viewportHeight}px`;
        mapContainer.style.left = '0';
        mapContainer.style.top = '0';
        mapContainer.style.transform = 'none';

        backgroundLayer.style.width = `${viewportWidth}px`;
        backgroundLayer.style.height = `${viewportHeight}px`;
        backgroundLayer.style.left = '0';
        backgroundLayer.style.top = '0';
    }

    async function deleteDiagramBackgroundFile(path) {
        const normalized = String(path || '').trim();
        if (!normalized) return;
        const response = await fetch(`${DEVICE_FILES_DELETE_URL}?path=${encodeURIComponent(normalized)}`, {
            method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
            let message = `Unable to delete previous background image (${response.status})`;
            try {
                const payload = await response.json();
                if (payload && payload.error) {
                    message = payload.error;
                }
            } catch (_error) {
                // Ignore JSON parsing errors and use generic message.
            }
            throw new Error(message);
        }
    }

    async function uploadDiagramBackground(file) {
        const response = await fetch(`${DEVICE_FILES_UPLOAD_URL}?deviceId=${encodeURIComponent(DIAGRAM_BACKGROUND_DEVICE_ID)}`, {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name || 'diagram-background')
            },
            body: file
        });
        if (!response.ok) {
            let message = `Unable to upload image (${response.status})`;
            try {
                const payload = await response.json();
                if (payload && payload.error) {
                    message = payload.error;
                }
            } catch (_error) {
                // Ignore JSON parsing errors and use generic message.
            }
            throw new Error(message);
        }
        const payload = await response.json();
        return normalizeDiagramBackgroundPayload(payload);
    }

    async function handleDiagramBackgroundInputChange(event) {
        const input = event && event.target;
        const file = input && input.files ? input.files[0] : null;
        if (!file) return;

        try {
            if (!String(file.type || '').toLowerCase().startsWith('image/')) {
                throw new Error('Please choose a valid image file.');
            }

            const previousPath = diagramBackgroundFile && diagramBackgroundFile.path
                ? String(diagramBackgroundFile.path)
                : '';
            const uploaded = await uploadDiagramBackground(file);
            if (!uploaded || !uploaded.path) {
                throw new Error('Upload succeeded but no file metadata was returned.');
            }
            await setDiagramBackgroundState(uploaded, true);

            if (previousPath && previousPath !== uploaded.path) {
                try {
                    await deleteDiagramBackgroundFile(previousPath);
                } catch (deleteError) {
                    console.warn('Unable to remove previous diagram background:', deleteError);
                }
            }
            showToast('Diagram background updated.', 'success');
        } catch (error) {
            showAlert(error.message || 'Unable to upload diagram background image.');
        } finally {
            if (input) {
                input.value = '';
            }
        }
    }

    async function removeDiagramBackground() {
        if (!diagramBackgroundFile || !diagramBackgroundFile.path) return;
        const confirmed = await showConfirm('This will remove the diagram background image. Continue?', {
            title: 'Remove background image',
            confirmText: 'Remove'
        });
        if (!confirmed) return;

        try {
            await deleteDiagramBackgroundFile(diagramBackgroundFile.path);
            await setDiagramBackgroundState(null, true);
            showToast('Diagram background removed.', 'success');
        } catch (error) {
            showAlert(error.message || 'Unable to remove diagram background image.');
        }
    }

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
    const areaModeSelect = document.getElementById('device-area-mode');
    if (areaModeSelect) {
        areaModeSelect.addEventListener('change', renderNetwork);
    }
    const configToggle = document.querySelector('.map-display-toggle');
    const configPanel = document.getElementById('map-config');
    const configHeader = configPanel ? configPanel.querySelector('.map-display-header') : null;
    const toggleConfigPanel = () => {
        if (!configPanel) return;
        const isCollapsed = configPanel.classList.toggle('is-collapsed');
        if (configToggle) {
            configToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        }
    };
    if (configToggle) {
        configToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleConfigPanel();
        });
    }
    if (configHeader) {
        configHeader.addEventListener('click', (event) => {
            const target = event.target;
            if (!target) return;
            if (target.closest('button, a, input, select, textarea, label')) return;
            toggleConfigPanel();
        });
    }
    const fitBtn = document.getElementById('fit-network-btn');
    if (fitBtn) {
        fitBtn.addEventListener('click', fitNetwork);
    }
    const editLayoutBtn = document.getElementById('toggle-edit-layout-btn');
    if (editLayoutBtn) {
        editLayoutBtn.addEventListener('click', toggleLayoutEdit);
    }
    const resetBtn = document.getElementById('reset-layout-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetLayout);
    }
    const cancelLayoutBtn = document.getElementById('cancel-layout-btn');
    if (cancelLayoutBtn) {
        cancelLayoutBtn.addEventListener('click', cancelLayoutChanges);
    }
    const saveBtn = document.getElementById('save-positions-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', savePositions);
    }
    const fullscreenBtn = document.getElementById('fullscreen-map-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleMapFullscreen);
    }
    const backgroundInput = document.getElementById('diagram-background-input');
    if (backgroundInput) {
        backgroundInput.addEventListener('change', handleDiagramBackgroundInputChange);
    }
    const backgroundUploadBtn = document.getElementById('diagram-background-upload-btn');
    if (backgroundUploadBtn && backgroundInput) {
        backgroundUploadBtn.addEventListener('click', () => {
            backgroundInput.click();
        });
    }
    const backgroundReplaceBtn = document.getElementById('diagram-background-replace-btn');
    if (backgroundReplaceBtn && backgroundInput) {
        backgroundReplaceBtn.addEventListener('click', () => {
            backgroundInput.click();
        });
    }
    const backgroundRemoveBtn = document.getElementById('diagram-background-remove-btn');
    if (backgroundRemoveBtn) {
        backgroundRemoveBtn.addEventListener('click', () => {
            void removeDiagramBackground();
        });
    }
    const backgroundOpacityInput = document.getElementById('diagram-background-opacity');
    if (backgroundOpacityInput) {
        backgroundOpacityInput.addEventListener('input', () => {
            diagramBackgroundOpacity = normalizeDiagramBackgroundOpacity(backgroundOpacityInput.value);
            updateDiagramBackgroundControls();
            applyDiagramBackground();
        });
        backgroundOpacityInput.addEventListener('change', () => {
            diagramBackgroundOpacity = normalizeDiagramBackgroundOpacity(backgroundOpacityInput.value);
            void persistDiagramBackgroundTuning();
        });
    }
    window.addEventListener('resize', () => {
        if (document.body.classList.contains('map-fullscreen')) {
            updateFullscreenMapFrame();
        } else {
            rememberMapAspectRatio();
        }
        resizeCytoscape();
    });
    rememberMapAspectRatio();
    updateDiagramBackgroundControls();
    updateLayoutButtons();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', () => {
        setMapFullscreen(false);
    });
    document.addEventListener('keydown', handleFullscreenEscape);
    document.addEventListener('keydown', handlePowerDialogEscape);
}

async function toggleLayoutEdit() {
    await setLayoutEditable(!isLayoutEditable);
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

async function setLayoutEditable(editable) {
    isLayoutEditable = Boolean(editable);

    if (cy) {
        const nodes = cy.nodes('[type="device"]');
        if (isLayoutEditable) {
            if (!cachedPositions) {
                cachedPositions = await loadPositions();
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
    if (isFullscreen) {
        rememberMapAspectRatio();
    }
    document.body.classList.toggle('map-fullscreen', isFullscreen);
    const fullscreenBtn = document.getElementById('fullscreen-map-btn');
    if (fullscreenBtn) {
        const label = isFullscreen ? 'Exit full screen' : 'Full screen';
        fullscreenBtn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
        fullscreenBtn.setAttribute('aria-label', label);
        fullscreenBtn.setAttribute('title', label);
    }
    if (isFullscreen) {
        updateFullscreenMapFrame();
    } else {
        clearFullscreenMapFrameStyles();
    }
    resizeCytoscape();
}

function toggleMapFullscreen() {
    const isFullscreen = Boolean(document.fullscreenElement);
    if (isFullscreen) {
        document.exitFullscreen();
        return;
    }

    const mapSection = document.getElementById('diagram-section') || document.getElementById('map-section');
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
    const previousSnapshot = diagramBackgroundViewportSnapshot
        ? {
            frame: {
                x: diagramBackgroundViewportSnapshot.frame.x,
                y: diagramBackgroundViewportSnapshot.frame.y,
                width: diagramBackgroundViewportSnapshot.frame.width,
                height: diagramBackgroundViewportSnapshot.frame.height
            },
            pan: {
                x: diagramBackgroundViewportSnapshot.pan.x,
                y: diagramBackgroundViewportSnapshot.pan.y
            },
            zoom: diagramBackgroundViewportSnapshot.zoom
        }
        : null;

    requestAnimationFrame(() => {
        cy.resize();
        const finalizeResize = () => {
            captureDiagramBackgroundViewportSnapshot();
            resetDiagramBackgroundViewportAnchor();
            applyDiagramBackgroundViewportTransform();
        };
        if (!previousSnapshot) {
            finalizeResize();
            return;
        }

        const currentFrame = getDiagramBackgroundFrame();
        if (!currentFrame) {
            finalizeResize();
            return;
        }

        const previousFrame = previousSnapshot.frame;
        const scaleX = currentFrame.width / Math.max(previousFrame.width, 1);
        const scaleY = currentFrame.height / Math.max(previousFrame.height, 1);
        if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
            finalizeResize();
            return;
        }

        const averageScale = (scaleX + scaleY) / 2;
        let nextZoom = previousSnapshot.zoom * averageScale;
        if (!Number.isFinite(nextZoom) || nextZoom <= 0) {
            finalizeResize();
            return;
        }
        nextZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), nextZoom));
        const nextPan = {
            x: currentFrame.x + (previousSnapshot.pan.x - previousFrame.x) * scaleX,
            y: currentFrame.y + (previousSnapshot.pan.y - previousFrame.y) * scaleY
        };

        cy.viewport({
            zoom: nextZoom,
            pan: nextPan
        });
        finalizeResize();
    });
}

async function navigateToDeviceEdit(deviceId) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) return;

    hideDeviceTooltip();
    hidePowerConnectionDialog();

    if (document.fullscreenElement && document.exitFullscreen) {
        try {
            await document.exitFullscreen();
        } catch (error) {
            // Continue navigation even if fullscreen exit fails.
        }
    }

    if (document.body.classList.contains('map-fullscreen')) {
        setMapFullscreen(false);
    }

    window.location.href = `device-edit.html?id=${encodeURIComponent(normalizedId)}`;
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
            {
                selector: 'node[type="floor"][transparentBackground="true"]',
                style: {
                    'background-opacity': 0
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
            {
                selector: 'node[type="area"][transparentBackground="true"]',
                style: {
                    'background-opacity': 0
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
        void navigateToDeviceEdit(deviceId);
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

    cy.on('pan zoom', () => {
        applyDiagramBackgroundViewportTransform();
        captureDiagramBackgroundViewportSnapshot();
    });

    // Allow panning by dragging on nodes when not in edit mode
    cy.on('tapstart', 'node[type="device"], node[type="area"], node[type="floor"]', (event) => {
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
    const areaModeSelect = document.getElementById('device-area-mode');
    const areaMode = areaModeSelect ? areaModeSelect.value : 'installed';
    const installedAreaId = device.area;
    const controlledAreaId = device.controlledArea;
    const activeAreaId = areaMode === 'controlled' ? controlledAreaId : installedAreaId;
    const activeArea = areas.find(a => a.id === activeAreaId);
    const floor = activeArea ? floors.find(f => f.id === activeArea.floor) : null;
    
    const renderedPosition = node.renderedPosition();
    
    const tooltip = document.createElement('div');
    tooltip.id = 'device-tooltip';
    tooltip.className = 'device-tooltip';
    
    const name = device.name || device.model || 'Unnamed Device';
    const floorName = floor ? floor.name : 'No Floor';
    const installedAreaName = installedAreaId ? getAreaName(areas, installedAreaId) : 'No Area';
    const controlledAreaName = controlledAreaId ? getAreaName(areas, controlledAreaId) : 'No Area';
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
                <span class="tooltip-label">Installed area:</span>
                <span class="tooltip-value">${escapeHtml(installedAreaName)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">Controlled area:</span>
                <span class="tooltip-value">${escapeHtml(controlledAreaName)}</span>
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
            <button class="tooltip-edit-btn" data-device-id="${escapeHtml(device.id)}">
                Edit Device
            </button>
            <span class="tooltip-hint">Double-click to edit</span>
        </div>
    `;
    
    const tooltipRoot = document.fullscreenElement || document.getElementById('diagram-section') || document.getElementById('map-section') || document.body;
    tooltipRoot.appendChild(tooltip);
    const editButton = tooltip.querySelector('.tooltip-edit-btn');
    if (editButton) {
        editButton.addEventListener('click', () => {
            const targetDeviceId = editButton.getAttribute('data-device-id') || device.id;
            void navigateToDeviceEdit(targetDeviceId);
        });
    }
    
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
async function renderNetwork() {
    if (!cy) {
        console.error('Cytoscape not initialized');
        return;
    }
    
    hideDeviceTooltip();
    
    // Get display settings
    const ethernetToggle = document.getElementById('show-ethernet-connections');
    const usbToggle = document.getElementById('show-usb-connections');
    const powerToggle = document.getElementById('show-power-connections');
    const showEthernet = ethernetToggle ? ethernetToggle.checked : true;
    const showUsb = usbToggle ? usbToggle.checked : true;
    const showPower = powerToggle ? powerToggle.checked : true;
    
    const sourceDevices = Array.isArray(filteredDevices)
        ? filteredDevices
        : (deviceFilters ? deviceFilters.getFilteredDevices() : devices);
    const filteredDevicesList = sourceDevices.filter(device => device.status !== 'wishlist');

    const mapCountLabel = document.getElementById('map-devices-count');
    if (mapCountLabel) {
        mapCountLabel.textContent = `${filteredDevicesList.length} device${filteredDevicesList.length !== 1 ? 's' : ''}`;
    }
    
    console.log('Rendering map with devices:', filteredDevicesList.length);
    
    // Check if there are devices to show
    if (filteredDevicesList.length === 0) {
        cy.elements().remove();
        showEmptyMapMessage();
        captureDiagramBackgroundViewportSnapshot();
        return;
    }
    
    // Get unique floors and areas from filtered devices
    const areaModeSelect = document.getElementById('device-area-mode');
    const areaMode = areaModeSelect ? areaModeSelect.value : 'installed';
    const areaKey = areaMode === 'controlled' ? 'controlledArea' : 'area';
    const validAreaIds = new Set(areas.map(area => area.id));
    const deviceAreaIds = [...new Set(filteredDevicesList
        .map(d => d[areaKey])
        .filter(areaId => areaId && validAreaIds.has(areaId)))];
    const filteredAreas = areas.filter(a => deviceAreaIds.includes(a.id));
    const floorIds = [...new Set(filteredAreas.map(a => a.floor).filter(Boolean))];
    const filteredFloors = floors.filter(f => floorIds.includes(f.id));
    const unassignedDevices = filteredDevicesList.filter(d => !d[areaKey] || !validAreaIds.has(d[areaKey]));
    const hasDiagramBackground = Boolean(diagramBackgroundFile && diagramBackgroundFile.path);
    
    console.log('Map data:', {
        devices: filteredDevicesList.length,
        areas: filteredAreas.length,
        floors: filteredFloors.length,
        totalDevices: devices.length,
        totalAreas: areas.length,
        totalFloors: floors.length
    });
    
    // Load saved positions
    const savedPositions = await loadPositions();
    const backgroundNormalizedPositions = new Map();
    let hasLegacyAbsoluteBackgroundPositions = false;
    const resolveSavedPosition = (deviceId, defaultPosition) => {
        const savedPosition = savedPositions[deviceId];
        if (hasDiagramBackground) {
            const normalized = parseSavedNormalizedPosition(savedPosition);
            if (normalized) {
                backgroundNormalizedPositions.set(deviceId, normalized);
                return defaultPosition;
            }
        }
        const absolute = parseSavedAbsolutePosition(savedPosition);
        if (absolute) {
            if (hasDiagramBackground) {
                hasLegacyAbsoluteBackgroundPositions = true;
            }
            return absolute;
        }
        return defaultPosition;
    };
    
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
                level: floor.level || 0,
                transparentBackground: hasDiagramBackground ? 'true' : 'false'
            }
        });
        
        let xOffset = 0;
        
        areasInFloor.forEach((area, areaIndex) => {
            const devicesInArea = filteredDevicesList.filter(d => d[areaKey] === area.id);
            
            // Add area node with floor as parent
            elements.push({
                group: 'nodes',
                data: {
                    id: `area-${area.id}`,
                    label: area.name,
                    type: 'area',
                    parent: `floor-${floor.id}`,
                    transparentBackground: hasDiagramBackground ? 'true' : 'false'
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
                    position: resolveSavedPosition(device.id, {
                        x: xOffset + col * deviceSpacingX,
                        y: yOffset + row * deviceSpacingY
                    })
                });
            });
            
            xOffset += Math.max(550, Math.ceil(Math.sqrt(devicesInArea.length)) * deviceSpacingX + 150);
        });
        
        // Calculate floor height based on number of devices in areas
        const maxDevicesInAnyArea = Math.max(...areasInFloor.map(a => 
            filteredDevicesList.filter(d => d[areaKey] === a.id).length
        ), 1);
        const rowsNeeded = Math.ceil(maxDevicesInAnyArea / 3);
        const floorHeight = Math.max(500, rowsNeeded * deviceSpacingY + 200);
        
        yOffset += floorHeight + floorSpacing;
    });

    if (unassignedDevices.length) {
        const floorId = 'floor-unassigned';
        const areaId = 'area-unassigned';

        elements.push({
            group: 'nodes',
            data: {
                id: floorId,
                label: 'Unassigned',
                type: 'floor',
                level: -9999,
                transparentBackground: hasDiagramBackground ? 'true' : 'false'
            }
        });

        elements.push({
            group: 'nodes',
            data: {
                id: areaId,
                label: 'No Area',
                type: 'area',
                parent: floorId,
                transparentBackground: hasDiagramBackground ? 'true' : 'false'
            }
        });

        const devicesPerRow = 3;
        unassignedDevices.forEach((device, deviceIndex) => {
            const deviceLabel = device.name || device.model || 'Unnamed Device';
            const storageLabel = formatStorageLabel(device);

            const row = Math.floor(deviceIndex / devicesPerRow);
            const col = deviceIndex % devicesPerRow;

            const deviceData = {
                id: device.id,
                label: deviceLabel,
                type: 'device',
                status: device.status,
                parent: areaId
            };
            if (storageLabel) {
                deviceData.hasStorage = 'true';
                deviceData.storageIcon = buildStorageIconDataUri(storageLabel);
            }

            elements.push({
                group: 'nodes',
                data: deviceData,
                position: resolveSavedPosition(device.id, {
                    x: col * deviceSpacingX,
                    y: yOffset + row * deviceSpacingY
                })
            });
        });

        const rowsNeeded = Math.ceil(unassignedDevices.length / devicesPerRow);
        const floorHeight = Math.max(500, rowsNeeded * deviceSpacingY + 200);
        yOffset += floorHeight + floorSpacing;
    }
    
    // Add edges for connections
    const processedConnections = new Set();
    
    filteredDevicesList.forEach(device => {
        if (!device.ports || !Array.isArray(device.ports)) return;
        
        device.ports.forEach(port => {
            if (!port.connectedTo) return;
            
            // Check if connected device is in filtered list
            if (!filteredDevicesList.find(d => d.id === port.connectedTo)) return;
            
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
                    const meta = getEthernetConnectionMeta(device, port, filteredDevicesList);
                    label = formatEthernetLabel(meta);
                } else if (connectionType === 'usb') {
                    label = 'USB';
                } else if (connectionType === 'power') {
                    label = getPowerConnectionLabel(device, port, filteredDevicesList);
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

    if (hasDiagramBackground) {
        applyBackgroundNormalizedPositions(backgroundNormalizedPositions);
    }

    await setLayoutEditable(isLayoutEditable);
    captureDiagramBackgroundViewportSnapshot();
    resetDiagramBackgroundViewportAnchor();
    applyDiagramBackgroundViewportTransform();
    if (hasLegacyAbsoluteBackgroundPositions) {
        void migratePositionsToBackgroundNormalized(savedPositions);
    }
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

    const dialogRoot = document.fullscreenElement || document.getElementById('diagram-section') || document.getElementById('map-section') || document.body;
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
        const backgroundNormalizedBeforeFit = buildCurrentBackgroundNormalizedPositions();
        cy.fit(null, 80);
        if (backgroundNormalizedBeforeFit) {
            applyBackgroundNormalizedPositions(backgroundNormalizedBeforeFit);
        }
        applyDiagramBackgroundViewportTransform();
        captureDiagramBackgroundViewportSnapshot();
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
    await clearMapPositions();
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
async function savePositions() {
    if (!isLayoutEditable) {
        showAlert('Enable edit mode to save positions.');
        return;
    }
    if (!cy) return;
    
    const existingPositions = await loadPositions();
    const positions = existingPositions && typeof existingPositions === 'object'
        ? { ...existingPositions }
        : {};
    cy.nodes('[type="device"]').forEach(node => {
        const serialized = serializeDevicePosition(node);
        if (!serialized) return;
        positions[node.id()] = serialized;
    });
    
    await saveMapPositions(positions);
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

    await setLayoutEditable(false);
}

async function cancelLayoutChanges() {
    if (!isLayoutEditable) {
        return;
    }
    if (!hasUnsavedLayoutChanges) {
        cachedPositions = null;
        await setLayoutEditable(false);
        return;
    }
    if (cachedPositions) {
        await saveMapPositions(cachedPositions);
    } else {
        await clearMapPositions();
    }
    hasUnsavedLayoutChanges = false;
    cachedPositions = null;
    renderNetwork();
    await setLayoutEditable(false);
}

// Load positions
async function loadPositions() {
    const saved = await loadMapPositions();
    if (!saved || typeof saved !== 'object') {
        return {};
    }
    return saved;
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

    return {
        init,
        initWithStoredData,
        updateData,
        setFilteredDevices,
        setVisible,
        resize: resizeCytoscape
    };
})();
