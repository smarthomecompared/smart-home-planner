// Device Diagram JavaScript with Cytoscape.js

window.DeviceDiagram = (() => {
    const DIAGRAM_BACKGROUND_UI_KEY = 'diagramBackground';
    const DIAGRAM_BACKGROUND_OPACITY_UI_KEY = 'diagramBackgroundOpacity';
    const DIAGRAM_DISPLAY_SETTINGS_UI_KEY = 'diagramDisplaySettings';
    const DIAGRAM_BACKGROUND_DEVICE_ID = 'diagram-background';
    const DIAGRAM_BACKGROUND_NODE_ID = 'diagram-background-node';
    const BACKGROUND_MODEL_MAX_DIMENSION = 1800;
    const DEVICE_BASE_METRICS = {
        width: 140,
        height: 60,
        fontSize: 12,
        textMaxWidth: 100,
        padding: 5,
        storageWidth: 56,
        storageHeight: 24,
        storageTextOffset: -6
    };
    const DEVICE_SIZE_LIMITS = {
        minWidth: 90,
        maxWidth: 420,
        minHeight: 45,
        maxHeight: 260
    };
    const DEVICE_FONT_LIMITS = {
        minFontSize: 10,
        maxFontSize: 18,
        minPadding: 3,
        maxPadding: 10
    };
    const DEVICE_ROTATION_OFFSET = 90;
    const DEVICE_ROTATION_MAX = 359;
    const DEVICE_ROTATION_SENSITIVITY = 0.6;
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
    let cachedPositionsUseBackground = false;
    let isInitialized = false;
    let diagramBackgroundFile = null;
    let diagramBackgroundOpacity = 55;
    let fullscreenMapAspectRatio = null;
    let diagramBackgroundImageUrl = '';
    let diagramBackgroundImagePath = '';
    let diagramBackgroundImageAspectRatio = null;
    let diagramBackgroundImageSize = null;
    const BACKGROUND_NORMALIZED_POSITION_SPACE = 'background-normalized';
    let tooltipDismissHandler = null;
    let tooltipDismissTimer = null;
    let resizeOverlay = null;
    let resizeOutline = null;
    let resizeHandles = null;
    let rotateHandle = null;
    let rotateLine = null;
    let activeResizeNodeId = null;
    let resizeState = null;
    let rotateState = null;
    let resizeOverlayRaf = null;
    let rotationUpdateRaf = null;
    const pendingRotationNodes = new Set();
    const cardSvgCache = new Set();
    let pendingBackgroundSeedPositions = null;
    let lastPositionsSource = 'map';

    function getDefaultDiagramDisplaySettings() {
        return {
            showEthernetConnections: true,
            showUsbConnections: true,
            showPowerConnections: true,
            showWifiConnections: false,
            showZigbeeConnections: false,
            showZwaveConnections: false,
            deviceAreaMode: 'installed',
            powerLabelMode: 'mean'
        };
    }

    function normalizeDiagramDisplaySettings(value) {
        const defaults = getDefaultDiagramDisplaySettings();
        if (!value || typeof value !== 'object') {
            return defaults;
        }
        return {
            showEthernetConnections: value.showEthernetConnections !== undefined ? Boolean(value.showEthernetConnections) : defaults.showEthernetConnections,
            showUsbConnections: value.showUsbConnections !== undefined ? Boolean(value.showUsbConnections) : defaults.showUsbConnections,
            showPowerConnections: value.showPowerConnections !== undefined ? Boolean(value.showPowerConnections) : defaults.showPowerConnections,
            showWifiConnections: value.showWifiConnections !== undefined ? Boolean(value.showWifiConnections) : defaults.showWifiConnections,
            showZigbeeConnections: value.showZigbeeConnections !== undefined ? Boolean(value.showZigbeeConnections) : defaults.showZigbeeConnections,
            showZwaveConnections: value.showZwaveConnections !== undefined ? Boolean(value.showZwaveConnections) : defaults.showZwaveConnections,
            deviceAreaMode: value.deviceAreaMode === 'controlled' ? 'controlled' : defaults.deviceAreaMode,
            powerLabelMode: ['idle', 'mean', 'max'].includes(value.powerLabelMode) ? value.powerLabelMode : defaults.powerLabelMode
        };
    }

    function getCurrentDiagramDisplaySettings() {
        return {
            showEthernetConnections: Boolean(document.getElementById('show-ethernet-connections')?.checked),
            showUsbConnections: Boolean(document.getElementById('show-usb-connections')?.checked),
            showPowerConnections: Boolean(document.getElementById('show-power-connections')?.checked),
            showWifiConnections: Boolean(document.getElementById('show-wifi-connections')?.checked),
            showZigbeeConnections: Boolean(document.getElementById('show-zigbee-connections')?.checked),
            showZwaveConnections: Boolean(document.getElementById('show-zwave-connections')?.checked),
            deviceAreaMode: document.getElementById('device-area-mode')?.value || 'installed',
            powerLabelMode: document.getElementById('power-label-mode')?.value || 'mean'
        };
    }

    function applyDiagramDisplaySettings(settingsPayload) {
        const settings = normalizeDiagramDisplaySettings(settingsPayload);
        const ethernetToggle = document.getElementById('show-ethernet-connections');
        const usbToggle = document.getElementById('show-usb-connections');
        const powerToggle = document.getElementById('show-power-connections');
        const wifiToggle = document.getElementById('show-wifi-connections');
        const zigbeeToggle = document.getElementById('show-zigbee-connections');
        const zwaveToggle = document.getElementById('show-zwave-connections');
        const areaModeSelect = document.getElementById('device-area-mode');
        const powerLabelMode = document.getElementById('power-label-mode');

        if (ethernetToggle) ethernetToggle.checked = settings.showEthernetConnections;
        if (usbToggle) usbToggle.checked = settings.showUsbConnections;
        if (powerToggle) powerToggle.checked = settings.showPowerConnections;
        if (wifiToggle) wifiToggle.checked = settings.showWifiConnections;
        if (zigbeeToggle) zigbeeToggle.checked = settings.showZigbeeConnections;
        if (zwaveToggle) zwaveToggle.checked = settings.showZwaveConnections;
        if (areaModeSelect) areaModeSelect.value = settings.deviceAreaMode;
        if (powerLabelMode) powerLabelMode.value = settings.powerLabelMode;
    }

    async function persistDiagramDisplaySettings() {
        try {
            await setUiPreference(DIAGRAM_DISPLAY_SETTINGS_UI_KEY, getCurrentDiagramDisplaySettings());
        } catch (error) {
            console.error('Failed to persist diagram display settings:', error);
        }
    }

    async function loadDiagramDisplaySettingsPreference() {
        try {
            const stored = await getUiPreference(DIAGRAM_DISPLAY_SETTINGS_UI_KEY);
            applyDiagramDisplaySettings(stored);
        } catch (error) {
            console.error('Failed to load diagram display settings:', error);
            applyDiagramDisplaySettings(null);
        }
    }

    function getViewportState() {
        if (!cy) return null;
        return {
            zoom: cy.zoom(),
            pan: { ...cy.pan() }
        };
    }

    function restoreViewportState(viewportState) {
        if (!cy || !viewportState) return;
        if (Number.isFinite(viewportState.zoom)) {
            cy.zoom(viewportState.zoom);
        }
        if (viewportState.pan && Number.isFinite(viewportState.pan.x) && Number.isFinite(viewportState.pan.y)) {
            cy.pan(viewportState.pan);
        }
    }

    function handleDiagramConnectionToggleChange() {
        void persistDiagramDisplaySettings();
        void renderNetwork({ preserveViewport: true });
    }

    function handleDiagramDisplaySelectChange() {
        void persistDiagramDisplaySettings();
        void renderNetwork();
    }

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
        void Promise.all([
            loadDiagramBackgroundPreference(),
            loadDiagramDisplaySettingsPreference()
        ]).finally(() => {
            renderNetwork();
            isInitialized = true;
        });
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

    function buildDeviceSizeData(size) {
        const normalized = normalizeDeviceSize(size);
        const width = normalized ? normalized.width : DEVICE_BASE_METRICS.width;
        const height = normalized ? normalized.height : DEVICE_BASE_METRICS.height;
        const scale = Math.min(
            width / DEVICE_BASE_METRICS.width,
            height / DEVICE_BASE_METRICS.height
        );
        const safeScale = clampNumber(scale, 0.6, 2.2);
        const fontSize = clampNumber(
            DEVICE_BASE_METRICS.fontSize * safeScale,
            DEVICE_FONT_LIMITS.minFontSize,
            DEVICE_FONT_LIMITS.maxFontSize
        );
        const padding = clampNumber(
            DEVICE_BASE_METRICS.padding * safeScale,
            DEVICE_FONT_LIMITS.minPadding,
            DEVICE_FONT_LIMITS.maxPadding
        );
        const textMaxWidth = Math.max(
            70,
            Math.min(
                width - 18,
                DEVICE_BASE_METRICS.textMaxWidth * (width / DEVICE_BASE_METRICS.width)
            )
        );

        return {
            width,
            height,
            fontSize,
            textMaxWidth,
            padding,
            storageWidth: DEVICE_BASE_METRICS.storageWidth * safeScale,
            storageHeight: DEVICE_BASE_METRICS.storageHeight * safeScale,
            storageTextOffset: DEVICE_BASE_METRICS.storageTextOffset * safeScale
        };
    }

    function applyDeviceSizeData(target, size) {
        const data = buildDeviceSizeData(size);
        target.width = data.width;
        target.height = data.height;
        target.fontSize = data.fontSize;
        target.textMaxWidth = data.textMaxWidth;
        target.padding = data.padding;
        target.storageWidth = data.storageWidth;
        target.storageHeight = data.storageHeight;
        target.storageTextOffset = data.storageTextOffset;
        return data;
    }

    function applyDeviceSizeToNode(node, width, height) {
        if (!node) return null;
        const data = buildDeviceSizeData({ width, height });
        node.data({
            width: data.width,
            height: data.height,
            fontSize: data.fontSize,
            textMaxWidth: data.textMaxWidth,
            padding: data.padding,
            storageWidth: data.storageWidth,
            storageHeight: data.storageHeight,
            storageTextOffset: data.storageTextOffset
        });
        return data;
    }

    function getDeviceNodeSize(node) {
        if (!node) return null;
        const width = Number(node.data('width')) || node.width();
        const height = Number(node.data('height')) || node.height();
        if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
        return { width, height };
    }

    function normalizeDeviceRotation(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        const normalized = ((parsed % 360) + 360) % 360;
        return Math.round(Math.min(DEVICE_ROTATION_MAX, Math.max(0, normalized)));
    }

    function getDeviceNodeRotation(node) {
        if (!node) return 0;
        const rotation = Number(node.data('rotation'));
        return normalizeDeviceRotation(rotation);
    }

    function applyDeviceRotationToNode(node, rotation) {
        if (!node) return 0;
        const normalized = normalizeDeviceRotation(rotation);
        node.data('rotation', normalized);
        scheduleDeviceCardSvgUpdate(node);
        return normalized;
    }

    function scheduleDeviceCardSvgUpdate(node) {
        if (!node || !cy) return;
        pendingRotationNodes.add(node.id());
        if (rotationUpdateRaf) return;
        rotationUpdateRaf = requestAnimationFrame(() => {
            rotationUpdateRaf = null;
            const ids = Array.from(pendingRotationNodes);
            pendingRotationNodes.clear();
            ids.forEach((nodeId) => {
                const target = cy.getElementById(nodeId);
                if (!target || target.empty()) return;
                updateDeviceCardSvg(target);
            });
        });
    }

    function updateDeviceCardSvg(node) {
        if (!node) return;
        const label = String(node.data('cardLabel') || node.data('label') || '').trim();
        const status = node.data('cardStatus') || node.data('status') || '';
        const storageLabel = node.data('cardStorageLabel') || '';
        const rotation = getDeviceNodeRotation(node);
        const lastRotation = Number(node.data('cardSvgRotation'));
        if (Number.isFinite(lastRotation) && lastRotation === rotation) {
            return;
        }
        node.data('cardSvgTargetRotation', rotation);
        const url = buildDeviceCardSvg({
            label,
            status,
            storageLabel,
            rotation
        });
        if (cardSvgCache.has(url)) {
            node.data('cardSvg', url);
            node.data('cardSvgRotation', rotation);
            return;
        }

        const img = new Image();
        img.onload = () => {
            cardSvgCache.add(url);
            if (!cy) return;
            const target = cy.getElementById(node.id());
            if (!target || target.empty()) return;
            const targetRotation = Number(target.data('cardSvgTargetRotation'));
            if (!Number.isFinite(targetRotation) || targetRotation !== rotation) return;
            target.data('cardSvg', url);
            target.data('cardSvgRotation', rotation);
        };
        img.onerror = () => {
            cardSvgCache.add(url);
            if (!cy) return;
            const target = cy.getElementById(node.id());
            if (!target || target.empty()) return;
            const targetRotation = Number(target.data('cardSvgTargetRotation'));
            if (!Number.isFinite(targetRotation) || targetRotation !== rotation) return;
            target.data('cardSvg', url);
            target.data('cardSvgRotation', rotation);
        };
        img.src = url;
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
        const helpBtn = document.getElementById('diagram-background-help-btn');
        const tuningPanel = document.getElementById('diagram-background-tuning');
        const opacityInput = document.getElementById('diagram-background-opacity');
        const opacityValue = document.getElementById('diagram-background-opacity-value');
        const hasBackground = Boolean(diagramBackgroundFile && diagramBackgroundFile.path);

        if (nameEl) {
            nameEl.textContent = getDiagramBackgroundDisplayName(diagramBackgroundFile);
        }
        if (uploadBtn) {
            uploadBtn.hidden = hasBackground;
        }
        if (helpBtn) {
            helpBtn.hidden = false;
        }
        if (replaceBtn) {
            replaceBtn.hidden = !hasBackground;
        }
        if (removeBtn) {
            removeBtn.hidden = !hasBackground;
        }
        if (tuningPanel) {
            tuningPanel.hidden = !hasBackground;
        }
        if (opacityInput) {
            opacityInput.value = String(diagramBackgroundOpacity);
        }
        if (opacityValue) {
            opacityValue.textContent = `${diagramBackgroundOpacity}%`;
        }
    }

    function hasDiagramBackground() {
        return Boolean(diagramBackgroundFile && diagramBackgroundFile.path);
    }

    function openDiagramHelpModal() {
        const modal = document.getElementById('diagram-background-help-modal');
        if (!modal) return;
        modal.classList.remove('is-hidden');
        modal.setAttribute('aria-hidden', 'false');
        const closeBtn = document.getElementById('diagram-background-help-close');
        if (closeBtn) {
            closeBtn.focus();
        }
    }

    function closeDiagramHelpModal() {
        const modal = document.getElementById('diagram-background-help-modal');
        if (!modal) return;
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
    }

    function handleDiagramHelpEscape(event) {
        if (event.key !== 'Escape') return;
        const modal = document.getElementById('diagram-background-help-modal');
        if (!modal || modal.classList.contains('is-hidden')) return;
        closeDiagramHelpModal();
    }

    function normalizeDeviceSize(size) {
        if (!size || typeof size !== 'object') return null;
        const width = Number(size.width);
        const height = Number(size.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
        return {
            width: clampNumber(width, DEVICE_SIZE_LIMITS.minWidth, DEVICE_SIZE_LIMITS.maxWidth),
            height: clampNumber(height, DEVICE_SIZE_LIMITS.minHeight, DEVICE_SIZE_LIMITS.maxHeight)
        };
    }

    function parseSavedSize(value) {
        if (!value || typeof value !== 'object') return null;
        const size = value.size && typeof value.size === 'object'
            ? value.size
            : { width: value.width, height: value.height };
        return normalizeDeviceSize(size);
    }

    function parseSavedRotation(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.rotation === undefined || value.rotation === null) return null;
        return normalizeDeviceRotation(value.rotation);
    }

    function hasSavedPositions(savedPositions) {
        if (!savedPositions || typeof savedPositions !== 'object') return false;
        return Object.keys(savedPositions).length > 0;
    }

    function collectCurrentDevicePositions() {
        if (!cy) return null;
        const positions = new Map();
        cy.nodes('[type="device"]').forEach((node) => {
            const pos = node.position();
            positions.set(node.id(), { x: pos.x, y: pos.y });
        });
        return positions;
    }

    function getBackgroundNode() {
        if (!cy) return null;
        const node = cy.getElementById(DIAGRAM_BACKGROUND_NODE_ID);
        if (!node || node.empty()) return null;
        return node;
    }

    function ensureBackgroundNode() {
        if (!cy) return null;
        let node = getBackgroundNode();
        if (node) return node;
        cy.add({
            group: 'nodes',
            data: {
                id: DIAGRAM_BACKGROUND_NODE_ID,
                type: 'diagram-background'
            },
            position: { x: 0, y: 0 },
            selectable: false,
            grabbable: false,
            locked: true
        });
        node = getBackgroundNode();
        if (node) {
            node.lock();
            node.ungrabify();
            if (typeof node.unselectify === 'function') {
                node.unselectify();
            }
        }
        return node;
    }

    function buildBackgroundModelSize() {
        if (diagramBackgroundImageSize) {
            const width = Number(diagramBackgroundImageSize.width);
            const height = Number(diagramBackgroundImageSize.height);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                const maxDim = Math.max(width, height);
                const scale = maxDim > BACKGROUND_MODEL_MAX_DIMENSION
                    ? (BACKGROUND_MODEL_MAX_DIMENSION / maxDim)
                    : 1;
                return {
                    width: width * scale,
                    height: height * scale
                };
            }
        }
        const mapContainer = document.getElementById('network-map');
        if (!mapContainer) return null;
        const containerWidth = mapContainer.clientWidth;
        const containerHeight = mapContainer.clientHeight;
        if (!Number.isFinite(containerWidth) || !Number.isFinite(containerHeight) || containerWidth <= 0 || containerHeight <= 0) {
            return null;
        }
        const ratio = Number(diagramBackgroundImageAspectRatio) > 0
            ? diagramBackgroundImageAspectRatio
            : (containerWidth / Math.max(containerHeight, 1));
        if (!Number.isFinite(ratio) || ratio <= 0) {
            return {
                width: containerWidth,
                height: containerHeight
            };
        }
        const containerRatio = containerWidth / Math.max(containerHeight, 1);
        if (containerRatio > ratio) {
            const width = containerHeight * ratio;
            return {
                width,
                height: containerHeight
            };
        }
        const height = containerWidth / ratio;
        return {
            width: containerWidth,
            height
        };
    }

    function updateBackgroundNodeGeometry() {
        const node = getBackgroundNode();
        if (!node) return null;
        const size = buildBackgroundModelSize();
        if (!size) return null;
        node.data('width', size.width);
        node.data('height', size.height);
        node.position({ x: 0, y: 0 });
        node.lock();
        node.ungrabify();
        if (typeof node.unselectify === 'function') {
            node.unselectify();
        }
        return size;
    }

    function getBackgroundModelFrame() {
        const node = getBackgroundNode();
        if (!node) return null;
        const width = Number(node.data('width')) || node.width();
        const height = Number(node.data('height')) || node.height();
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return null;
        }
        const pos = node.position();
        return {
            x: pos.x - width / 2,
            y: pos.y - height / 2,
            width,
            height
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
        return { x, y };
    }

    function resolveSavedSize(savedPositions, deviceId, useBackground) {
        if (!useBackground) return null;
        const saved = savedPositions ? savedPositions[deviceId] : null;
        return parseSavedSize(saved);
    }

    function resolveSavedRotation(savedPositions, deviceId, useBackground) {
        const saved = savedPositions ? savedPositions[deviceId] : null;
        if (!useBackground) {
            return parseSavedRotation(saved);
        }
        return parseSavedRotation(saved);
    }

    function canResizeDevices() {
        return isLayoutEditable && hasDiagramBackground();
    }

    function getActiveResizeNode() {
        if (!cy || !activeResizeNodeId) return null;
        const node = cy.getElementById(activeResizeNodeId);
        if (!node || node.empty()) return null;
        return node;
    }

    function ensureResizeOverlay() {
        if (resizeOverlay) return resizeOverlay;
        const mapContainer = document.getElementById('network-map');
        if (!mapContainer) return null;

        const overlay = document.createElement('div');
        overlay.id = 'device-resize-overlay';
        overlay.className = 'device-resize-overlay is-hidden';
        overlay.setAttribute('aria-hidden', 'true');

        const outline = document.createElement('div');
        outline.className = 'device-resize-outline';
        overlay.appendChild(outline);

        const line = document.createElement('div');
        line.className = 'device-rotate-line';
        overlay.appendChild(line);

        const rotateBtn = document.createElement('button');
        rotateBtn.type = 'button';
        rotateBtn.className = 'device-rotate-handle';
        rotateBtn.setAttribute('aria-label', 'Rotate device');
        rotateBtn.addEventListener('pointerdown', handleRotatePointerDown);
        overlay.appendChild(rotateBtn);

        const handles = {};
        ['nw', 'ne', 'sw', 'se'].forEach((handle) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'device-resize-handle';
            btn.dataset.handle = handle;
            btn.setAttribute('aria-label', 'Resize device');
            btn.addEventListener('pointerdown', handleResizePointerDown);
            overlay.appendChild(btn);
            handles[handle] = btn;
        });

        mapContainer.appendChild(overlay);
        resizeOverlay = overlay;
        resizeOutline = outline;
        resizeHandles = handles;
        rotateHandle = rotateBtn;
        rotateLine = line;
        return overlay;
    }

    function showResizeHandles(node) {
        if (!node || !canResizeDevices()) {
            hideResizeHandles();
            return;
        }
        ensureResizeOverlay();
        if (!resizeOverlay) return;
        activeResizeNodeId = node.id();
        resizeOverlay.classList.remove('is-hidden');
        resizeOverlay.setAttribute('aria-hidden', 'false');
        scheduleResizeOverlayUpdate();
    }

    function hideResizeHandles() {
        if (!resizeOverlay) {
            activeResizeNodeId = null;
            return;
        }
        if (resizeState) {
            handleResizePointerUp();
        }
        if (rotateState) {
            handleRotatePointerUp();
        }
        resizeOverlay.classList.add('is-hidden');
        resizeOverlay.setAttribute('aria-hidden', 'true');
        activeResizeNodeId = null;
    }

    function scheduleResizeOverlayUpdate() {
        if (!activeResizeNodeId) return;
        if (resizeOverlayRaf) return;
        resizeOverlayRaf = requestAnimationFrame(() => {
            resizeOverlayRaf = null;
            updateResizeOverlayPosition();
        });
    }

    function updateResizeOverlayPosition() {
        if (!resizeOverlay || !resizeOutline || !resizeHandles) return;
        const node = getActiveResizeNode();
        if (!node) {
            hideResizeHandles();
            return;
        }
        const position = node.renderedPosition();
        const width = node.renderedWidth();
        const height = node.renderedHeight();
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !width || !height) {
            hideResizeHandles();
            return;
        }
        const left = position.x - width / 2;
        const top = position.y - height / 2;
        const right = position.x + width / 2;
        const bottom = position.y + height / 2;
        const rotateOffset = 38;

        resizeOutline.style.left = `${left}px`;
        resizeOutline.style.top = `${top}px`;
        resizeOutline.style.width = `${width}px`;
        resizeOutline.style.height = `${height}px`;

        resizeHandles.nw.style.left = `${left}px`;
        resizeHandles.nw.style.top = `${top}px`;
        resizeHandles.ne.style.left = `${right}px`;
        resizeHandles.ne.style.top = `${top}px`;
        resizeHandles.sw.style.left = `${left}px`;
        resizeHandles.sw.style.top = `${bottom}px`;
        resizeHandles.se.style.left = `${right}px`;
        resizeHandles.se.style.top = `${bottom}px`;

        if (rotateHandle && rotateLine) {
            const centerX = position.x;
            const lineTop = top - rotateOffset;
            const lineHeight = rotateOffset;
            rotateLine.style.left = `${centerX}px`;
            rotateLine.style.top = `${lineTop}px`;
            rotateLine.style.height = `${lineHeight}px`;
            rotateHandle.style.left = `${centerX}px`;
            rotateHandle.style.top = `${lineTop}px`;
        }
    }

    function handleResizePointerDown(event) {
        if (!canResizeDevices()) return;
        const handle = event.currentTarget && event.currentTarget.dataset
            ? event.currentTarget.dataset.handle
            : '';
        if (!handle) return;
        const node = getActiveResizeNode();
        if (!node) return;
        const size = getDeviceNodeSize(node);
        if (!size) return;
        const position = node.position();
        const halfWidth = size.width / 2;
        const halfHeight = size.height / 2;
        resizeState = {
            nodeId: node.id(),
            handle,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: size.width,
            startHeight: size.height,
            fixedCorner: {
                x: position.x + (handle.includes('w') ? halfWidth : -halfWidth),
                y: position.y + (handle.includes('n') ? halfHeight : -halfHeight)
            }
        };
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener('pointermove', handleResizePointerMove);
        window.addEventListener('pointerup', handleResizePointerUp);
        window.addEventListener('pointercancel', handleResizePointerUp);
    }

    function handleResizePointerMove(event) {
        if (!resizeState || !cy) return;
        const node = cy.getElementById(resizeState.nodeId);
        if (!node || node.empty()) {
            handleResizePointerUp();
            return;
        }
        const zoom = cy.zoom() || 1;
        const dx = (event.clientX - resizeState.startX) / zoom;
        const dy = (event.clientY - resizeState.startY) / zoom;
        const signX = resizeState.handle.includes('e') ? 1 : -1;
        const signY = resizeState.handle.includes('s') ? 1 : -1;
        let nextWidth = resizeState.startWidth + dx * signX;
        let nextHeight = resizeState.startHeight + dy * signY;

        nextWidth = clampNumber(nextWidth, DEVICE_SIZE_LIMITS.minWidth, DEVICE_SIZE_LIMITS.maxWidth);
        nextHeight = clampNumber(nextHeight, DEVICE_SIZE_LIMITS.minHeight, DEVICE_SIZE_LIMITS.maxHeight);

        const halfWidth = nextWidth / 2;
        const halfHeight = nextHeight / 2;
        const nextCenterX = resizeState.fixedCorner.x + (resizeState.handle.includes('w') ? -halfWidth : halfWidth);
        const nextCenterY = resizeState.fixedCorner.y + (resizeState.handle.includes('n') ? -halfHeight : halfHeight);

        cy.batch(() => {
            applyDeviceSizeToNode(node, nextWidth, nextHeight);
            node.position({ x: nextCenterX, y: nextCenterY });
        });
        scheduleDeviceCardSvgUpdate(node);
        markLayoutDirty();
        scheduleResizeOverlayUpdate();
        event.preventDefault();
        event.stopPropagation();
    }

    function handleResizePointerUp() {
        if (!resizeState) return;
        resizeState = null;
        window.removeEventListener('pointermove', handleResizePointerMove);
        window.removeEventListener('pointerup', handleResizePointerUp);
        window.removeEventListener('pointercancel', handleResizePointerUp);
    }

    function handleRotatePointerDown(event) {
        if (!canResizeDevices()) return;
        const node = getActiveResizeNode();
        if (!node) return;
        const center = node.renderedPosition();
        const startAngle = Math.atan2(
            event.clientY - center.y,
            event.clientX - center.x
        );
        rotateState = {
            nodeId: node.id(),
            centerX: center.x,
            centerY: center.y,
            startAngle,
            startRotation: getDeviceNodeRotation(node)
        };
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener('pointermove', handleRotatePointerMove);
        window.addEventListener('pointerup', handleRotatePointerUp);
        window.addEventListener('pointercancel', handleRotatePointerUp);
    }

    function handleRotatePointerMove(event) {
        if (!rotateState || !cy) return;
        const node = cy.getElementById(rotateState.nodeId);
        if (!node || node.empty()) {
            handleRotatePointerUp();
            return;
        }
        const angle = Math.atan2(
            event.clientY - rotateState.centerY,
            event.clientX - rotateState.centerX
        );
        const degrees = ((angle - rotateState.startAngle) * 180) / Math.PI;
        const rotation = normalizeDeviceRotation(
            rotateState.startRotation + degrees * DEVICE_ROTATION_SENSITIVITY
        );
        applyDeviceRotationToNode(node, rotation);
        markLayoutDirty();
        scheduleResizeOverlayUpdate();
        event.preventDefault();
        event.stopPropagation();
    }

    function handleRotatePointerUp() {
        if (!rotateState) return;
        rotateState = null;
        window.removeEventListener('pointermove', handleRotatePointerMove);
        window.removeEventListener('pointerup', handleRotatePointerUp);
        window.removeEventListener('pointercancel', handleRotatePointerUp);
    }

    function buildCurrentBackgroundNormalizedPositions() {
        if (!cy || !diagramBackgroundFile || !diagramBackgroundFile.path) return null;
        const frame = getBackgroundModelFrame();
        if (!frame || frame.width <= 0 || frame.height <= 0) return null;

        const positions = new Map();
        cy.nodes('[type="device"]').forEach((node) => {
            const pos = node.position();
            const normalizedX = (pos.x - frame.x) / frame.width;
            const normalizedY = (pos.y - frame.y) / frame.height;
            positions.set(node.id(), {
                x: normalizedX,
                y: normalizedY
            });
        });
        return positions;
    }

    function buildSeedPositionsFromSavedPositions(savedPositions) {
        if (!savedPositions || typeof savedPositions !== 'object') return null;
        const positions = new Map();
        Object.keys(savedPositions).forEach((deviceId) => {
            const absolute = parseSavedAbsolutePosition(savedPositions[deviceId]);
            if (!absolute) return;
            positions.set(deviceId, absolute);
        });
        return positions.size ? positions : null;
    }

    function normalizeSeedPositionsToBackground(seedPositions, frame) {
        if (!seedPositions || !seedPositions.size || !frame) return null;
        const bounds = {
            minX: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY
        };

        seedPositions.forEach((pos) => {
            if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
            bounds.minX = Math.min(bounds.minX, pos.x);
            bounds.maxX = Math.max(bounds.maxX, pos.x);
            bounds.minY = Math.min(bounds.minY, pos.y);
            bounds.maxY = Math.max(bounds.maxY, pos.y);
        });

        if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) ||
            !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
            return null;
        }

        const layoutWidth = Math.max(1, bounds.maxX - bounds.minX);
        const layoutHeight = Math.max(1, bounds.maxY - bounds.minY);
        const layoutCenterX = bounds.minX + layoutWidth / 2;
        const layoutCenterY = bounds.minY + layoutHeight / 2;
        const frameCenterX = frame.x + frame.width / 2;
        const frameCenterY = frame.y + frame.height / 2;
        const offsetX = frameCenterX - layoutCenterX;
        const offsetY = frameCenterY - layoutCenterY;

        const normalized = new Map();
        seedPositions.forEach((pos, deviceId) => {
            if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
            const mappedX = pos.x + offsetX;
            const mappedY = pos.y + offsetY;
            normalized.set(deviceId, {
                x: (mappedX - frame.x) / frame.width,
                y: (mappedY - frame.y) / frame.height
            });
        });

        return normalized.size ? normalized : null;
    }

    function applyBackgroundNormalizedPositions(positionsByDeviceId) {
        if (!cy || !positionsByDeviceId || positionsByDeviceId.size === 0) return false;
        if (!diagramBackgroundFile || !diagramBackgroundFile.path) return false;

        const frame = getBackgroundModelFrame();
        if (!frame || frame.width <= 0 || frame.height <= 0) return false;

        cy.batch(() => {
            positionsByDeviceId.forEach((normalizedPosition, deviceId) => {
                const node = cy.getElementById(deviceId);
                if (!node || node.empty()) return;
                node.position({
                    x: frame.x + normalizedPosition.x * frame.width,
                    y: frame.y + normalizedPosition.y * frame.height
                });
            });
        });
        return true;
    }

    function serializeDevicePosition(node) {
        if (!node) return null;
        const size = getDeviceNodeSize(node);
        const rotation = getDeviceNodeRotation(node);
        const hasBackground = Boolean(diagramBackgroundFile && diagramBackgroundFile.path);
        if (!hasBackground) {
            const pos = node.position();
            return {
                x: pos.x,
                y: pos.y,
                size: size || undefined,
                rotation
            };
        }

        const frame = getBackgroundModelFrame();
        if (!frame || frame.width <= 0 || frame.height <= 0) {
            const pos = node.position();
            return {
                x: pos.x,
                y: pos.y,
                size: size || undefined
            };
        }

        const pos = node.position();
        return {
            x: (pos.x - frame.x) / frame.width,
            y: (pos.y - frame.y) / frame.height,
            coordinateSpace: BACKGROUND_NORMALIZED_POSITION_SPACE,
            size: size || undefined,
            rotation
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
            const node = cy ? cy.getElementById(deviceId) : null;
            const size = node && !node.empty() ? getDeviceNodeSize(node) : null;
            const rotation = node && !node.empty() ? getDeviceNodeRotation(node) : 0;
            next[deviceId] = {
                x: position.x,
                y: position.y,
                coordinateSpace: BACKGROUND_NORMALIZED_POSITION_SPACE,
                size: size || undefined,
                rotation
            };
        });

        try {
            await savePositionsToStore(next, true);
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
                resolve({
                    ratio: width / height,
                    width,
                    height
                });
            };
            image.onerror = () => {
                reject(new Error('Unable to load background image.'));
            };
            image.src = imageUrl;
        });
    }

    function ensureBackgroundImageUrl() {
        if (!diagramBackgroundFile || !diagramBackgroundFile.path) return '';
        const backgroundPath = String(diagramBackgroundFile.path);
        if (!diagramBackgroundImageUrl || backgroundPath !== diagramBackgroundImagePath) {
            const cacheToken = Date.now();
            diagramBackgroundImageUrl = `${DEVICE_FILES_CONTENT_URL}?path=${encodeURIComponent(backgroundPath)}&t=${cacheToken}`;
            diagramBackgroundImagePath = backgroundPath;
        }
        return diagramBackgroundImageUrl;
    }

    async function refreshDiagramBackgroundAspectRatio(imageUrl) {
        if (!imageUrl) {
            diagramBackgroundImageAspectRatio = null;
            diagramBackgroundImageSize = null;
            return;
        }
        try {
            const sizeInfo = await loadDiagramBackgroundAspectRatio(imageUrl);
            if (imageUrl !== diagramBackgroundImageUrl) {
                return;
            }
            diagramBackgroundImageAspectRatio = sizeInfo.ratio;
            diagramBackgroundImageSize = {
                width: sizeInfo.width,
                height: sizeInfo.height
            };
        } catch (_error) {
            if (imageUrl !== diagramBackgroundImageUrl) {
                return;
            }
            diagramBackgroundImageAspectRatio = null;
            diagramBackgroundImageSize = null;
        }
        updateBackgroundNodeGeometry();
    }

    async function ensureBackgroundImageReady() {
        if (!hasDiagramBackground()) return false;
        if (diagramBackgroundImageSize && diagramBackgroundImageAspectRatio) return true;
        const url = ensureBackgroundImageUrl();
        if (!url) return false;
        await refreshDiagramBackgroundAspectRatio(url);
        return Boolean(diagramBackgroundImageSize);
    }

    function applyDiagramBackground(options = {}) {
        const refreshImage = Boolean(options && options.refreshImage);
        const mapContainer = document.getElementById('network-map');
        if (!mapContainer) return;

        if (!diagramBackgroundFile || !diagramBackgroundFile.path) {
            mapContainer.classList.remove('has-background');
            diagramBackgroundImageUrl = '';
            diagramBackgroundImagePath = '';
            diagramBackgroundImageAspectRatio = null;
            diagramBackgroundImageSize = null;
            const existingNode = getBackgroundNode();
            if (existingNode) {
                cy.remove(existingNode);
            }
            return;
        }

        const backgroundPath = String(diagramBackgroundFile.path);
        const shouldRefreshImage = refreshImage || !diagramBackgroundImageUrl || backgroundPath !== diagramBackgroundImagePath;
        if (shouldRefreshImage) {
            ensureBackgroundImageUrl();
            void refreshDiagramBackgroundAspectRatio(diagramBackgroundImageUrl);
        }
        mapContainer.classList.add('has-background');
        const backgroundNode = ensureBackgroundNode();
        if (backgroundNode) {
            backgroundNode.data('image', ensureBackgroundImageUrl() || '');
            backgroundNode.data('imageOpacity', diagramBackgroundOpacity / 100);
            updateBackgroundNodeGeometry();
        }
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
        if (!previousPath && nextPath && cy && rerender) {
            const savedPositions = await loadPositions(true);
            if (!hasSavedPositions(savedPositions)) {
                pendingBackgroundSeedPositions = collectCurrentDevicePositions();
            }
        }
        const shouldRefreshImage = Boolean(nextPath) && (nextPath !== previousPath || persist);
        updateDiagramBackgroundControls();
        applyDiagramBackground({ refreshImage: shouldRefreshImage });
        if (!diagramBackgroundFile || !diagramBackgroundFile.path) {
            hideResizeHandles();
        }

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
            await setDiagramBackgroundState(storedFile, false, true);
            updateDiagramBackgroundControls();
        } catch (error) {
            console.error('Failed to load diagram background preference:', error);
            diagramBackgroundOpacity = 55;
            await setDiagramBackgroundState(null, false, true);
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
        ethernetToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const usbToggle = document.getElementById('show-usb-connections');
    if (usbToggle) {
        usbToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const powerToggle = document.getElementById('show-power-connections');
    if (powerToggle) {
        powerToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const wifiToggle = document.getElementById('show-wifi-connections');
    if (wifiToggle) {
        wifiToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const zigbeeToggle = document.getElementById('show-zigbee-connections');
    if (zigbeeToggle) {
        zigbeeToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const zwaveToggle = document.getElementById('show-zwave-connections');
    if (zwaveToggle) {
        zwaveToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const powerLabelMode = document.getElementById('power-label-mode');
    if (powerLabelMode) {
        powerLabelMode.addEventListener('change', handleDiagramDisplaySelectChange);
    }
    const areaModeSelect = document.getElementById('device-area-mode');
    if (areaModeSelect) {
        areaModeSelect.addEventListener('change', handleDiagramDisplaySelectChange);
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
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => adjustZoom(-0.15));
    }
    const zoomInBtn = document.getElementById('zoom-in-btn');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => adjustZoom(0.15));
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
    const backgroundHelpBtn = document.getElementById('diagram-background-help-btn');
    if (backgroundHelpBtn) {
        backgroundHelpBtn.addEventListener('click', openDiagramHelpModal);
    }
    const backgroundHelpCloseBtn = document.getElementById('diagram-background-help-close');
    if (backgroundHelpCloseBtn) {
        backgroundHelpCloseBtn.addEventListener('click', closeDiagramHelpModal);
    }
    const backgroundHelpOverlay = document.getElementById('diagram-background-help-overlay');
    if (backgroundHelpOverlay) {
        backgroundHelpOverlay.addEventListener('click', closeDiagramHelpModal);
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
        document.addEventListener('keydown', handleFullscreenEscape);
        document.addEventListener('keydown', handlePowerDialogEscape);
        document.addEventListener('keydown', handleDiagramHelpEscape);
    }

async function toggleLayoutEdit() {
    await setLayoutEditable(!isLayoutEditable);
}

function adjustZoom(delta) {
    if (!cy) return;
    const current = cy.zoom();
    const minZoom = cy.minZoom();
    const maxZoom = cy.maxZoom();
    const next = Math.min(maxZoom, Math.max(minZoom, current + delta));
    if (next === current) return;

    const container = document.getElementById('network-map');
    const rect = container ? container.getBoundingClientRect() : null;
    const center = rect
        ? { x: rect.width / 2, y: rect.height / 2 }
        : { x: 0, y: 0 };
    cy.zoom({
        level: next,
        renderedPosition: center
    });
    scheduleResizeOverlayUpdate();
}

function markLayoutDirty() {
    if (!isLayoutEditable) return;
    if (hasUnsavedLayoutChanges) return;
    hasUnsavedLayoutChanges = true;
    updateLayoutButtons();
}

function lockBackgroundNode() {
    if (!cy) return;
    cy.nodes('node[type="diagram-background"]').forEach((node) => {
        node.lock();
        node.ungrabify();
        if (typeof node.unselectify === 'function') {
            node.unselectify();
        }
    });
}

function updateAreaFloorSelectability() {
    if (!cy) return;
    const nodes = cy.nodes('node[type="floor"], node[type="area"]');
    nodes.forEach((node) => {
        if (typeof node.selectify !== 'function' || typeof node.unselectify !== 'function') return;
        if (isLayoutEditable) {
            node.selectify();
            node.data('noHighlight', 'false');
        } else {
            node.unselectify();
            node.unselect();
            node.data('noHighlight', 'true');
        }
    });
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

    function updateOutlineVisibility() {
        if (!cy || !hasDiagramBackground()) return;
        const hideOutline = !isLayoutEditable ? 'true' : 'false';
        cy.batch(() => {
            cy.nodes('node[type="floor"], node[type="area"]').forEach((node) => {
                node.data('hideOutline', hideOutline);
            });
        });
    }

    async function setLayoutEditable(editable) {
        isLayoutEditable = Boolean(editable);

    if (cy) {
        const nodes = cy.nodes('[type="device"]');
        const floorsAndAreas = cy.nodes('node[type="floor"], node[type="area"]');
        if (isLayoutEditable) {
            if (!cachedPositions) {
                cachedPositionsUseBackground = hasDiagramBackground();
                cachedPositions = await loadPositions(cachedPositionsUseBackground);
            }
            nodes.unlock();
            nodes.grabify();
            floorsAndAreas.unlock();
            floorsAndAreas.grabify();
        } else {
            nodes.lock();
            nodes.ungrabify();
            floorsAndAreas.lock();
            floorsAndAreas.ungrabify();
        }
        lockBackgroundNode();
        updateAreaFloorSelectability();
    }

    const editBtn = document.getElementById('toggle-edit-layout-btn');
    if (editBtn) {
        editBtn.textContent = isLayoutEditable ? 'Stop Editing' : 'Edit Layout';
        editBtn.classList.toggle('btn-success', isLayoutEditable);
        editBtn.classList.toggle('btn-secondary', !isLayoutEditable);
    }
    updateLayoutButtons();
    updateOutlineVisibility();
    if (!isLayoutEditable) {
        hideResizeHandles();
    }
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
    const isFullscreen = document.body.classList.contains('map-fullscreen');
    setMapFullscreen(!isFullscreen);
}

function handleFullscreenEscape(event) {
    if (event.key !== 'Escape') return;
    if (document.fullscreenElement) return;
    if (!document.body.classList.contains('map-fullscreen')) return;
    setMapFullscreen(false);
}

function resizeCytoscape() {
    if (!cy) return;
    const savedNormalized = buildCurrentBackgroundNormalizedPositions();
    requestAnimationFrame(() => {
        cy.resize();
        if (hasDiagramBackground()) {
            updateBackgroundNodeGeometry();
            if (savedNormalized) {
                applyBackgroundNormalizedPositions(savedNormalized);
            }
        }
        scheduleResizeOverlayUpdate();
    });
}

async function navigateToDeviceEdit(deviceId) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) return;

    hideDeviceTooltip();
    hidePowerConnectionDialog();
    hideResizeHandles();

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
            {
                selector: 'node[type="diagram-background"]',
                style: {
                    'shape': 'rectangle',
                    'width': 'data(width)',
                    'height': 'data(height)',
                    'background-color': '#0f172a',
                    'background-image': 'data(image)',
                    'background-fit': 'contain',
                    'background-repeat': 'no-repeat',
                    'background-position-x': '50%',
                    'background-position-y': '50%',
                    'background-opacity': 1,
                    'background-image-opacity': 'data(imageOpacity)',
                    'background-blacken': 0,
                    'border-width': 0,
                    'overlay-opacity': 0,
                    'underlay-opacity': 0,
                    'label': '',
                    'text-opacity': 0,
                    'z-index': 0,
                    'z-compound-depth': 'bottom'
                }
            },
            {
                selector: 'node[type="diagram-background"]:active',
                style: {
                    'background-blacken': 0,
                    'overlay-opacity': 0,
                    'underlay-opacity': 0
                }
            },
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
            {
                selector: 'node[type="floor"][hideOutline="true"]',
                style: {
                    'border-width': 0,
                    'text-background-opacity': 0,
                    'text-opacity': 0
                }
            },
            {
                selector: 'node[type="floor"][noHighlight="true"]',
                style: {
                    'overlay-opacity': 0,
                    'background-blacken': 0,
                    'underlay-opacity': 0
                }
            },
            {
                selector: 'node[type="floor"][noHighlight="true"]:active',
                style: {
                    'overlay-opacity': 0,
                    'background-blacken': 0,
                    'underlay-opacity': 0
                }
            },
            {
                selector: 'node[type="floor"]:selected',
                style: {
                    'overlay-opacity': 0,
                    'background-opacity': 0
                }
            },
            {
                selector: 'node[type="area"][hideOutline="true"]',
                style: {
                    'border-width': 0,
                    'text-background-opacity': 0,
                    'text-opacity': 0
                }
            },
            {
                selector: 'node[type="area"][noHighlight="true"]',
                style: {
                    'overlay-opacity': 0,
                    'background-blacken': 0,
                    'underlay-opacity': 0
                }
            },
            {
                selector: 'node[type="area"][noHighlight="true"]:active',
                style: {
                    'overlay-opacity': 0,
                    'background-blacken': 0,
                    'underlay-opacity': 0
                }
            },
            {
                selector: 'node[type="area"]:selected',
                style: {
                    'overlay-opacity': 0,
                    'background-opacity': 0
                }
            },
            // Device style
            {
                selector: 'node[type="device"]',
                style: {
                    'background-color': 'rgba(0, 0, 0, 0)',
                    'background-opacity': 0,
                    'background-blacken': 0,
                    'border-width': 0,
                    'overlay-opacity': 0,
                    'background-image': 'data(cardSvg)',
                    'background-fit': 'contain',
                    'background-repeat': 'no-repeat',
                    'background-position-x': '50%',
                    'background-position-y': '50%',
                    'label': '',
                    'text-opacity': 0,
                    'shape': 'rectangle',
                    'width': 'data(width)',
                    'height': 'data(height)'
                }
            },
            {
                selector: 'node[type="device"][hasStorage = "true"]',
                style: {
                    'text-margin-y': 'data(storageTextOffset)'
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
            },
            {
                selector: 'edge[connectionType="wifi"]',
                style: {
                    'width': 2,
                    'line-color': '#38bdf8',
                    'line-style': 'dashed',
                    'line-dash-pattern': [8, 6],
                    'target-arrow-shape': 'none',
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
                selector: 'edge[connectionType="zigbee"]',
                style: {
                    'width': 2,
                    'line-color': '#facc15',
                    'line-style': 'dashed',
                    'line-dash-pattern': [7, 5],
                    'target-arrow-shape': 'none',
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
                selector: 'edge[connectionType="zwave"]',
                style: {
                    'width': 2,
                    'line-color': '#22c55e',
                    'line-style': 'dashed',
                    'line-dash-pattern': [7, 5],
                    'target-arrow-shape': 'none',
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
        if (canResizeDevices()) {
            hideDeviceTooltip();
            showResizeHandles(node);
            return;
        }
        hideResizeHandles();
        showDeviceTooltip(node);
    });
    
    cy.on('dbltap', 'node[type="device"]', function(evt) {
        if (isLayoutEditable) return;
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

    cy.on('drag', 'node[type="device"]', (event) => {
        if (activeResizeNodeId && event.target.id() === activeResizeNodeId) {
            scheduleResizeOverlayUpdate();
        }
    });

    cy.on('dragfree', 'node[type="device"]', () => {
        markLayoutDirty();
        scheduleResizeOverlayUpdate();
    });



    // Allow panning by dragging on nodes when not in edit mode (devices), always for background/areas/floors
    cy.on('tapstart', 'node[type="device"]', (event) => {
        if (isLayoutEditable) return;
        isPanningFromNode = true;
        lastPanPosition = event.renderedPosition;
    });

    cy.on('tapstart', 'node[type="area"], node[type="floor"], node[type="diagram-background"]', (event) => {
        if (isLayoutEditable && event.target && event.target.data('type') !== 'diagram-background') {
            return;
        }
        isPanningFromNode = true;
        lastPanPosition = event.renderedPosition;
    });

    cy.on('tapstart', (event) => {
        if (event.target !== cy) return;
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
            hideResizeHandles();
        }
    });

    cy.on('tap', 'node[type="diagram-background"], node[type="area"], node[type="floor"]', () => {
        hideDeviceTooltip();
        hidePowerConnectionDialog();
        hideResizeHandles();
    });

    cy.on('viewport', () => {
        scheduleResizeOverlayUpdate();
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

    bindTooltipDismiss(tooltip);
    
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
    unbindTooltipDismiss();
}

function bindTooltipDismiss(tooltipEl) {
    if (!tooltipEl) return;
    if (tooltipDismissTimer) {
        clearTimeout(tooltipDismissTimer);
        tooltipDismissTimer = null;
    }
    unbindTooltipDismiss();
    tooltipDismissHandler = (event) => {
        if (!tooltipEl || tooltipEl.contains(event.target)) return;
        hideDeviceTooltip();
    };
    tooltipDismissTimer = setTimeout(() => {
        document.addEventListener('mousedown', tooltipDismissHandler);
        document.addEventListener('touchstart', tooltipDismissHandler, { passive: true });
        tooltipDismissTimer = null;
    }, 0);
}

function unbindTooltipDismiss() {
    if (!tooltipDismissHandler) return;
    document.removeEventListener('mousedown', tooltipDismissHandler);
    document.removeEventListener('touchstart', tooltipDismissHandler);
    tooltipDismissHandler = null;
    if (tooltipDismissTimer) {
        clearTimeout(tooltipDismissTimer);
        tooltipDismissTimer = null;
    }
}

// Render network
async function renderNetwork(options = {}) {
    if (!cy) {
        console.error('Cytoscape not initialized');
        return;
    }
    const preserveViewport = options && options.preserveViewport === true;
    const viewportState = preserveViewport ? getViewportState() : null;
    
    hideDeviceTooltip();
    hideResizeHandles();
    
    // Get display settings
    const ethernetToggle = document.getElementById('show-ethernet-connections');
    const usbToggle = document.getElementById('show-usb-connections');
    const powerToggle = document.getElementById('show-power-connections');
    const wifiToggle = document.getElementById('show-wifi-connections');
    const zigbeeToggle = document.getElementById('show-zigbee-connections');
    const zwaveToggle = document.getElementById('show-zwave-connections');
    const showEthernet = ethernetToggle ? ethernetToggle.checked : true;
    const showUsb = usbToggle ? usbToggle.checked : true;
    const showPower = powerToggle ? powerToggle.checked : true;
    const showWifi = wifiToggle ? wifiToggle.checked : false;
    const showZigbee = zigbeeToggle ? zigbeeToggle.checked : false;
    const showZwave = zwaveToggle ? zwaveToggle.checked : false;
    
    const sourceDevices = Array.isArray(filteredDevices)
        ? filteredDevices
        : (deviceFilters ? deviceFilters.getFilteredDevices() : devices);
    const filteredDevicesList = sourceDevices.filter(device => device.status !== 'wishlist');
    const hasBackground = hasDiagramBackground();

    const mapCountLabel = document.getElementById('map-devices-count');
    if (mapCountLabel) {
        mapCountLabel.textContent = `${filteredDevicesList.length} device${filteredDevicesList.length !== 1 ? 's' : ''}`;
    }

    console.log('Rendering map with devices:', filteredDevicesList.length);

    if (hasBackground) {
        await ensureBackgroundImageReady();
    }
    
    // Check if there are devices to show
    if (filteredDevicesList.length === 0) {
        cy.elements().remove();
        if (hasBackground) {
            const backgroundSize = buildBackgroundModelSize();
            cy.add({
                group: 'nodes',
                data: {
                    id: DIAGRAM_BACKGROUND_NODE_ID,
                    type: 'diagram-background',
                    width: backgroundSize ? backgroundSize.width : 0,
                    height: backgroundSize ? backgroundSize.height : 0,
                    image: diagramBackgroundImageUrl || '',
                    imageOpacity: diagramBackgroundOpacity / 100
                },
                position: { x: 0, y: 0 },
                selectable: false,
                grabbable: false,
                locked: true
            });
            applyDiagramBackground();
            fitNetwork();
        }
        showEmptyMapMessage();
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
    
    console.log('Map data:', {
        devices: filteredDevicesList.length,
        areas: filteredAreas.length,
        floors: filteredFloors.length,
        totalDevices: devices.length,
        totalAreas: areas.length,
        totalFloors: floors.length
    });
    
    // Load saved positions
    const savedPositions = await loadPositions(hasBackground);
    if (hasBackground && lastPositionsSource === 'map' && hasSavedPositions(savedPositions) && !pendingBackgroundSeedPositions) {
        pendingBackgroundSeedPositions = buildSeedPositionsFromSavedPositions(savedPositions);
    }
    const backgroundNormalizedPositions = new Map();
    let hasLegacyAbsoluteBackgroundPositions = false;
    const resolveSavedPosition = (deviceId, defaultPosition) => {
        const savedPosition = savedPositions[deviceId];
        if (hasBackground) {
            const normalized = parseSavedNormalizedPosition(savedPosition);
            if (normalized) {
                backgroundNormalizedPositions.set(deviceId, normalized);
                return defaultPosition;
            }
        }
        const absolute = parseSavedAbsolutePosition(savedPosition);
        if (absolute) {
            if (hasBackground) {
                hasLegacyAbsoluteBackgroundPositions = true;
            }
            return absolute;
        }
        return defaultPosition;
    };
    const resolveDeviceSize = (deviceId) => resolveSavedSize(savedPositions, deviceId, hasBackground);
    const resolveDeviceRotation = (deviceId) => resolveSavedRotation(savedPositions, deviceId, hasBackground);
    
    // Build elements array
    const elements = [];
    if (hasBackground) {
        const backgroundSize = buildBackgroundModelSize();
        elements.push({
            group: 'nodes',
            data: {
                id: DIAGRAM_BACKGROUND_NODE_ID,
                type: 'diagram-background',
                width: backgroundSize ? backgroundSize.width : 0,
                height: backgroundSize ? backgroundSize.height : 0,
                image: diagramBackgroundImageUrl || '',
                imageOpacity: diagramBackgroundOpacity / 100
            },
            position: { x: 0, y: 0 },
            selectable: false,
            grabbable: false,
            locked: true
        });
    }
    
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
                transparentBackground: hasBackground ? 'true' : 'false',
                hideOutline: hasBackground && !isLayoutEditable ? 'true' : 'false'
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
                    transparentBackground: hasBackground ? 'true' : 'false',
                    hideOutline: hasBackground && !isLayoutEditable ? 'true' : 'false'
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
                }
                applyDeviceSizeData(deviceData, resolveDeviceSize(device.id));
                deviceData.rotation = resolveDeviceRotation(device.id) ?? 0;
                deviceData.cardLabel = deviceLabel;
                deviceData.cardStatus = device.status || '';
                deviceData.cardStorageLabel = storageLabel || '';
                deviceData.cardSvgRotation = deviceData.rotation;
                deviceData.cardSvgTargetRotation = deviceData.rotation;
                deviceData.cardSvg = buildDeviceCardSvg({
                    label: deviceLabel,
                    status: device.status,
                    storageLabel,
                    rotation: deviceData.rotation
                });

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
                transparentBackground: hasBackground ? 'true' : 'false',
                hideOutline: hasBackground && !isLayoutEditable ? 'true' : 'false'
            }
        });

        elements.push({
            group: 'nodes',
            data: {
                id: areaId,
                label: 'No Area',
                type: 'area',
                parent: floorId,
                transparentBackground: hasBackground ? 'true' : 'false',
                hideOutline: hasBackground && !isLayoutEditable ? 'true' : 'false'
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
            }
            applyDeviceSizeData(deviceData, resolveDeviceSize(device.id));
            deviceData.rotation = resolveDeviceRotation(device.id) ?? 0;
            deviceData.cardLabel = deviceLabel;
            deviceData.cardStatus = device.status || '';
            deviceData.cardStorageLabel = storageLabel || '';
            deviceData.cardSvgRotation = deviceData.rotation;
            deviceData.cardSvgTargetRotation = deviceData.rotation;
            deviceData.cardSvg = buildDeviceCardSvg({
                label: deviceLabel,
                status: device.status,
                storageLabel,
                rotation: deviceData.rotation
            });

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

    if (showWifi) {
        const processedWifiConnections = new Set();
        filteredDevicesList.forEach((device) => {
            const connectedAccessPointId = String(device.wifiAccessPointId || '').trim();
            if (!connectedAccessPointId || connectedAccessPointId === String(device.id || '')) return;
            if (!isWifiConnectionDevice(device)) return;

            const connectedAccessPoint = filteredDevicesList.find(item => item.id === connectedAccessPointId);
            if (!connectedAccessPoint) return;

            const connectionId = [String(device.id || ''), connectedAccessPointId].sort().join('-wifi-');
            if (processedWifiConnections.has(connectionId)) return;
            processedWifiConnections.add(connectionId);

            elements.push({
                group: 'edges',
                data: {
                    id: `wifi-${connectionId}`,
                    source: String(device.id || ''),
                    target: connectedAccessPointId,
                    connectionType: 'wifi',
                    label: formatWifiBandLabel(device.wifiBand)
                }
            });
        });
    }

    if (showZigbee) {
        const processedZigbeeConnections = new Set();
        filteredDevicesList.forEach((device) => {
            const zigbeeParentId = String(device.zigbeeParentId || '').trim();
            if (!zigbeeParentId || zigbeeParentId === String(device.id || '')) return;
            if (!isZigbeeConnectionDevice(device)) return;

            const zigbeeParent = filteredDevicesList.find((item) => item.id === zigbeeParentId);
            if (!isZigbeeParentDiagramDevice(zigbeeParent)) return;

            const connectionId = [String(device.id || ''), zigbeeParentId].sort().join('-zigbee-');
            if (processedZigbeeConnections.has(connectionId)) return;
            processedZigbeeConnections.add(connectionId);

            elements.push({
                group: 'edges',
                data: {
                    id: `zigbee-${connectionId}`,
                    source: String(device.id || ''),
                    target: zigbeeParentId,
                    connectionType: 'zigbee',
                    label: ''
                }
            });
        });
    }

    if (showZwave) {
        const processedZwaveConnections = new Set();
        filteredDevicesList.forEach((device) => {
            const zwaveControllerId = String(device.zwaveControllerId || '').trim();
            if (!zwaveControllerId || zwaveControllerId === String(device.id || '')) return;
            if (!isZwaveConnectionDevice(device)) return;

            const zwaveCoordinator = filteredDevicesList.find((item) => item.id === zwaveControllerId);
            if (!isZwaveParentDiagramDevice(zwaveCoordinator)) return;

            const connectionId = [String(device.id || ''), zwaveControllerId].sort().join('-zwave-');
            if (processedZwaveConnections.has(connectionId)) return;
            processedZwaveConnections.add(connectionId);

            elements.push({
                group: 'edges',
                data: {
                    id: `zwave-${connectionId}`,
                    source: String(device.id || ''),
                    target: zwaveControllerId,
                    connectionType: 'zwave',
                    label: ''
                }
            });
        });
    }
    
    // Update cytoscape
    hideEmptyMapMessage();
    cy.elements().remove();
    cy.add(elements);
    
    // Run layout
    cy.layout({
        name: 'preset',
        fit: !hasBackground && !preserveViewport,
        padding: 80
    }).run();

    applyDiagramBackground();
    if (hasBackground) {
        applyBackgroundNormalizedPositions(backgroundNormalizedPositions);
        if (!preserveViewport) {
            fitNetwork();
        }
        if (pendingBackgroundSeedPositions && pendingBackgroundSeedPositions.size) {
            const frame = getBackgroundModelFrame();
            if (frame && frame.width > 0 && frame.height > 0) {
                const normalized = normalizeSeedPositionsToBackground(pendingBackgroundSeedPositions, frame);
                if (normalized) {
                    applyBackgroundNormalizedPositions(normalized);
                }
                const positions = {};
                cy.nodes('[type="device"]').forEach((node) => {
                    const serialized = serializeDevicePosition(node);
                    if (serialized) {
                        positions[node.id()] = serialized;
                    }
                });
                void savePositionsToStore(positions, true);
            }
            pendingBackgroundSeedPositions = null;
        }
    }
    if (preserveViewport) {
        restoreViewportState(viewportState);
        scheduleResizeOverlayUpdate();
    }

    await setLayoutEditable(isLayoutEditable);
    lockBackgroundNode();
    updateAreaFloorSelectability();
    if (hasLegacyAbsoluteBackgroundPositions && diagramBackgroundImageSize) {
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

function isWifiConnectionDevice(device) {
    if (!device || typeof device !== 'object') {
        return false;
    }
    const rawConnectivity = device.connectivity;
    const normalized = typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(rawConnectivity)
        : String(rawConnectivity || '').trim().toLowerCase();
    return normalized === 'wifi';
}

function isZigbeeConnectionDevice(device) {
    if (!device || typeof device !== 'object') {
        return false;
    }
    const rawConnectivity = device.connectivity;
    const normalized = typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(rawConnectivity)
        : String(rawConnectivity || '').trim().toLowerCase();
    return normalized === 'zigbee';
}

function isZwaveConnectionDevice(device) {
    if (!device || typeof device !== 'object') {
        return false;
    }
    const rawConnectivity = device.connectivity;
    const normalized = typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(rawConnectivity)
        : String(rawConnectivity || '').trim().toLowerCase();
    return normalized === 'z-wave' || normalized === 'zwave';
}

function isZigbeeParentDiagramDevice(device) {
    return Boolean(device && isZigbeeConnectionDevice(device) && (device.zigbeeController || device.zigbeeRepeater));
}

function isZwaveParentDiagramDevice(device) {
    return Boolean(device && isZwaveConnectionDevice(device) && device.zwaveController);
}

function formatWifiBandLabel(value) {
    const normalized = typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(value)
        : String(value || '').trim().toLowerCase();
    if (normalized === '2.4-ghz') return '2.4 GHz';
    if (normalized === '5-ghz') return '5 GHz';
    if (normalized === '6-ghz') return '6 GHz';
    if (!normalized) return 'Wi-Fi';
    return String(value || 'Wi-Fi');
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

function getDeviceStatusColor(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'pending') return '#f59e0b';
    if (normalized === 'not-working') return '#ef4444';
    if (normalized === 'working') return '#10b981';
    return '#3b82f6';
}

function buildSvgTextLines(text, maxWidth, fontSize, maxLines = 2) {
    const raw = String(text || '').trim();
    if (!raw) return [''];
    const approxCharWidth = fontSize * 0.55;
    const maxChars = Math.max(4, Math.floor(maxWidth / Math.max(approxCharWidth, 1)));
    const words = raw.split(/\s+/);
    const lines = [];
    let current = '';

    words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        if (next.length <= maxChars) {
            current = next;
            return;
        }
        if (current) {
            lines.push(current);
            current = word;
        } else {
            lines.push(word.slice(0, maxChars));
            current = word.slice(maxChars);
        }
    });

    if (current) {
        lines.push(current);
    }

    if (lines.length <= maxLines) {
        return lines;
    }
    const trimmed = lines.slice(0, maxLines);
    const last = trimmed[maxLines - 1];
    if (last.length > 3) {
        trimmed[maxLines - 1] = `${last.slice(0, Math.max(1, last.length - 3))}...`;
    }
    return trimmed;
}

function buildDeviceCardSvg({ label, status, storageLabel, rotation }) {
    const width = DEVICE_BASE_METRICS.width;
    const height = DEVICE_BASE_METRICS.height;
    const strokeColor = getDeviceStatusColor(status);
    const fillColor = '#1e293b';
    const rx = 12;
    const fontSize = DEVICE_BASE_METRICS.fontSize;
    const textMaxWidth = width - 24;
    const lines = buildSvgTextLines(label, textMaxWidth, fontSize, 2);
    const lineHeight = fontSize * 1.25;
    const totalHeight = lineHeight * lines.length;
    let startY = (height - totalHeight) / 2 + fontSize;
    const angle = normalizeDeviceRotation(rotation || 0);
    const radians = (angle * Math.PI) / 180;
    const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
    const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
    const scale = angle
        ? Math.min(width / rotatedWidth, height / rotatedHeight, 1)
        : 1;
    const transform = angle
        ? `transform="translate(${width / 2} ${height / 2}) rotate(${angle}) scale(${scale}) translate(${-width / 2} ${-height / 2})"`
        : '';

    if (storageLabel) {
        startY -= 6;
    }

    const textMarkup = lines.map((line, index) => {
        const y = startY + index * lineHeight;
        return `<tspan x="${width / 2}" y="${y}">${escapeSvgText(line)}</tspan>`;
    }).join('');

    let storageMarkup = '';
    if (storageLabel) {
        const badgeWidth = 56;
        const badgeHeight = 24;
        const badgeX = width - badgeWidth - 6;
        const badgeY = height - badgeHeight - 6;
        const safeLabel = escapeSvgText(storageLabel);
        storageMarkup = [
            `<rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="4" ry="4" fill="none" stroke="#94a3b8" stroke-width="1.2"/>`,
            `<rect x="${badgeX + 3}" y="${badgeY + 6}" width="${badgeWidth - 6}" height="2" fill="#94a3b8" opacity="0.6"/>`,
            `<text x="${badgeX + badgeWidth / 2}" y="${badgeY + badgeHeight - 6}" text-anchor="middle" font-size="9" font-family="Arial, sans-serif" fill="#94a3b8">${safeLabel}</text>`
        ].join('');
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<g ${transform}>`,
        `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${rx}" ry="${rx}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2"/>`,
        `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="${fontSize}" font-family="Arial, sans-serif" fill="#f1f5f9">${textMarkup}</text>`,
        storageMarkup,
        '</g>',
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
    if (!cy) return;
    const backgroundNormalizedBeforeFit = buildCurrentBackgroundNormalizedPositions();
    const backgroundNode = getBackgroundNode();
    if (backgroundNode) {
        cy.fit(backgroundNode, 80);
    } else {
        cy.fit(null, 80);
    }
    if (backgroundNormalizedBeforeFit) {
        applyBackgroundNormalizedPositions(backgroundNormalizedBeforeFit);
    }
    scheduleResizeOverlayUpdate();
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
    await clearPositionsStore(hasDiagramBackground());
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
    if (hasDiagramBackground()) {
        await ensureBackgroundImageReady();
        updateBackgroundNodeGeometry();
    }
    
    const useBackground = hasDiagramBackground();
    const existingPositions = await loadPositions(useBackground);
    const positions = existingPositions && typeof existingPositions === 'object'
        ? { ...existingPositions }
        : {};
    cy.nodes('[type="device"]').forEach(node => {
        const serialized = serializeDevicePosition(node);
        if (!serialized) return;
        positions[node.id()] = serialized;
    });
    
    await savePositionsToStore(positions, useBackground);
    hasUnsavedLayoutChanges = false;
    cachedPositions = null;
    cachedPositionsUseBackground = false;
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
        cachedPositionsUseBackground = false;
        await setLayoutEditable(false);
        return;
    }
    const useBackground = cachedPositionsUseBackground;
    if (cachedPositions) {
        await savePositionsToStore(cachedPositions, useBackground);
    } else {
        await clearPositionsStore(useBackground);
    }
    hasUnsavedLayoutChanges = false;
    cachedPositions = null;
    cachedPositionsUseBackground = false;
    renderNetwork();
    await setLayoutEditable(false);
}

// Load positions
async function loadPositions(useBackground = hasDiagramBackground()) {
    if (useBackground && typeof loadMapImagePositions === 'function') {
        const imagePositions = await loadMapImagePositions();
        if (hasSavedPositions(imagePositions)) {
            lastPositionsSource = 'image';
            return imagePositions;
        }
        const basePositions = await loadMapPositions();
        lastPositionsSource = 'map';
        if (hasSavedPositions(basePositions)) {
            return basePositions;
        }
        return {};
    }
    lastPositionsSource = 'map';
    const saved = await loadMapPositions();
    if (!saved || typeof saved !== 'object') {
        return {};
    }
    return saved;
}

async function savePositionsToStore(positions, useBackground = hasDiagramBackground()) {
    if (useBackground && typeof saveMapImagePositions === 'function') {
        await saveMapImagePositions(positions || {});
        return;
    }
    await saveMapPositions(positions || {});
}

async function clearPositionsStore(useBackground = hasDiagramBackground()) {
    if (useBackground && typeof clearMapImagePositions === 'function') {
        await clearMapImagePositions();
        return;
    }
    await clearMapPositions();
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
