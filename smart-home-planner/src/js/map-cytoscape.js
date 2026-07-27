// Device Diagram JavaScript with Cytoscape.js

window.DeviceMap = (() => {
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
    // Device type icons (img/devices/*.svg) are authored on a 48x48 grid
    const DEVICE_ICON_VIEWBOX = 48;
    const DEVICE_TEXT_MAX_LINES = 5;
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
    let isps = [];
    let settings = {};
    let filteredDevices = null;
    let cy = null;
    let deviceFilters = null;
    let isLayoutEditable = false;
    let hasUnsavedLayoutChanges = false;
    // Diagram analysis state (trace path / failure simulation)
    let tracedDeviceId = null;
    const simulatedFailedDeviceIds = new Set();
    // Trace flow animation: edge id -> dash-offset step sign (+1/-1) orienting
    // the marching-ants motion from the traced device toward the network root
    const traceFlowDirections = new Map();
    let traceFlowRaf = null;
    let traceFlowOffset = 0;
    let traceFlowLastStep = 0;
    let isDiagramVisible = true;
    // Network (VLAN) coloring: the currently spotlighted network id, or null.
    let highlightedNetworkId = null;

    // Icon SVG cache: url -> inner SVG string (or null if failed)
    const _deviceIconCache = {};
    // Device photo cache: "<path>|<uploadedAt>|<size>|<updatedAt>" -> data URL
    const _devicePhotoDataUrlCache = new Map();

    async function _fetchDeviceIconInner(type) {
        const url = type ? `img/devices/${encodeURIComponent(type)}.svg` : 'img/devices/generic.svg';
        if (_deviceIconCache[url] !== undefined) return _deviceIconCache[url];
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('not found');
            const text = await resp.text();
            const inner = text
                .replace(/<\?xml[^>]*\?>/g, '')
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/<svg[^>]*>/g, '')
                .replace(/<\/svg>/g, '')
                .trim();
            _deviceIconCache[url] = inner || null;
        } catch {
            if (type) {
                // fall back to generic
                const generic = await _fetchDeviceIconInner(null);
                _deviceIconCache[url] = generic;
            } else {
                _deviceIconCache[url] = null;
            }
        }
        return _deviceIconCache[url];
    }

    async function prefetchDeviceIcons(deviceTypes) {
        await Promise.all([...new Set(deviceTypes)].map(t => _fetchDeviceIconInner(t)));
    }

    function buildDiagramDeviceImageUrl(device) {
        const imagePath = String(device?.deviceImage?.path || '').trim();
        if (!imagePath) return '';
        const cacheToken = String(device?.updatedAt || '').trim();
        const tokenQuery = cacheToken ? `&t=${encodeURIComponent(cacheToken)}` : '';
        return `${DEVICE_FILES_CONTENT_URL}?path=${encodeURIComponent(imagePath)}${tokenQuery}`;
    }

    function getDevicePhotoCacheKey(device) {
        const imageRef = device?.deviceImage || {};
        const imagePath = String(imageRef.path || '').trim();
        const uploadedAt = String(imageRef.uploadedAt || '').trim();
        const size = String(imageRef.size || '').trim();
        const updatedAt = String(device?.updatedAt || '').trim();
        return `${imagePath}|${uploadedAt}|${size}|${updatedAt}`;
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Failed to convert blob to data URL'));
            reader.readAsDataURL(blob);
        });
    }

    async function getEmbeddedDiagramDeviceImageUrl(device) {
        const imagePath = String(device?.deviceImage?.path || '').trim();
        if (!imagePath) return '';
        const cacheKey = getDevicePhotoCacheKey(device);
        if (_devicePhotoDataUrlCache.has(cacheKey)) {
            return _devicePhotoDataUrlCache.get(cacheKey) || '';
        }
        const imageUrl = buildDiagramDeviceImageUrl(device);
        if (!imageUrl) return '';
        try {
            const response = await fetch(imageUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Failed to fetch image (${response.status})`);
            }
            const blob = await response.blob();
            const dataUrl = await blobToDataUrl(blob);
            if (_devicePhotoDataUrlCache.size >= 300) {
                _devicePhotoDataUrlCache.clear();
            }
            _devicePhotoDataUrlCache.set(cacheKey, dataUrl || imageUrl);
            return dataUrl || imageUrl;
        } catch (error) {
            console.warn('Failed to embed diagram device image, using direct URL fallback.', error);
            _devicePhotoDataUrlCache.set(cacheKey, imageUrl);
            return imageUrl;
        }
    }
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
            showHdmiConnections: true,
            showPowerConnections: true,
            showWifiConnections: false,
            showZigbeeConnections: false,
            showZwaveConnections: false,
            showBluetoothConnections: false,
            deviceAreaMode: 'installed',
            powerLabelMode: 'mean',
            showDeviceIcons: true,
            dimFilteredDevices: true,
            showInternet: true,
            colorByNetwork: false
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
            showHdmiConnections: value.showHdmiConnections !== undefined ? Boolean(value.showHdmiConnections) : defaults.showHdmiConnections,
            showPowerConnections: value.showPowerConnections !== undefined ? Boolean(value.showPowerConnections) : defaults.showPowerConnections,
            showWifiConnections: value.showWifiConnections !== undefined ? Boolean(value.showWifiConnections) : defaults.showWifiConnections,
            showZigbeeConnections: value.showZigbeeConnections !== undefined ? Boolean(value.showZigbeeConnections) : defaults.showZigbeeConnections,
            showZwaveConnections: value.showZwaveConnections !== undefined ? Boolean(value.showZwaveConnections) : defaults.showZwaveConnections,
            showBluetoothConnections: value.showBluetoothConnections !== undefined ? Boolean(value.showBluetoothConnections) : defaults.showBluetoothConnections,
            deviceAreaMode: value.deviceAreaMode === 'controlled' ? 'controlled' : defaults.deviceAreaMode,
            powerLabelMode: ['idle', 'mean', 'max'].includes(value.powerLabelMode) ? value.powerLabelMode : defaults.powerLabelMode,
            showDeviceIcons: value.showDeviceIcons !== undefined ? Boolean(value.showDeviceIcons) : defaults.showDeviceIcons,
            dimFilteredDevices: value.dimFilteredDevices !== undefined ? Boolean(value.dimFilteredDevices) : defaults.dimFilteredDevices,
            showInternet: value.showInternet !== undefined ? Boolean(value.showInternet) : defaults.showInternet,
            colorByNetwork: value.colorByNetwork !== undefined ? Boolean(value.colorByNetwork) : defaults.colorByNetwork
        };
    }

    function getCurrentDiagramDisplaySettings() {
        return {
            showEthernetConnections: Boolean(document.getElementById('show-ethernet-connections')?.checked),
            showUsbConnections: Boolean(document.getElementById('show-usb-connections')?.checked),
            showHdmiConnections: Boolean(document.getElementById('show-hdmi-connections')?.checked),
            showPowerConnections: Boolean(document.getElementById('show-power-connections')?.checked),
            showWifiConnections: Boolean(document.getElementById('show-wifi-connections')?.checked),
            showZigbeeConnections: Boolean(document.getElementById('show-zigbee-connections')?.checked),
            showZwaveConnections: Boolean(document.getElementById('show-zwave-connections')?.checked),
            showBluetoothConnections: Boolean(document.getElementById('show-bluetooth-connections')?.checked),
            deviceAreaMode: document.getElementById('device-area-mode')?.value || 'installed',
            powerLabelMode: document.getElementById('power-label-mode')?.value || 'mean',
            showDeviceIcons: Boolean(document.getElementById('diagram-show-icons')?.checked ?? true),
            dimFilteredDevices: Boolean(document.getElementById('diagram-dim-filtered')?.checked ?? true),
            showInternet: Boolean(document.getElementById('diagram-show-internet')?.checked ?? true),
            colorByNetwork: Boolean(document.getElementById('diagram-color-by-network')?.checked)
        };
    }

    function applyDiagramDisplaySettings(settingsPayload) {
        const settings = normalizeDiagramDisplaySettings(settingsPayload);
        const ethernetToggle = document.getElementById('show-ethernet-connections');
        const usbToggle = document.getElementById('show-usb-connections');
        const hdmiToggle = document.getElementById('show-hdmi-connections');
        const powerToggle = document.getElementById('show-power-connections');
        const wifiToggle = document.getElementById('show-wifi-connections');
        const zigbeeToggle = document.getElementById('show-zigbee-connections');
        const zwaveToggle = document.getElementById('show-zwave-connections');
        const bluetoothToggle = document.getElementById('show-bluetooth-connections');
        const areaModeSelect = document.getElementById('device-area-mode');
        const powerLabelMode = document.getElementById('power-label-mode');

        if (ethernetToggle) ethernetToggle.checked = settings.showEthernetConnections;
        if (usbToggle) usbToggle.checked = settings.showUsbConnections;
        if (hdmiToggle) hdmiToggle.checked = settings.showHdmiConnections;
        if (powerToggle) powerToggle.checked = settings.showPowerConnections;
        if (wifiToggle) wifiToggle.checked = settings.showWifiConnections;
        if (zigbeeToggle) zigbeeToggle.checked = settings.showZigbeeConnections;
        if (zwaveToggle) zwaveToggle.checked = settings.showZwaveConnections;
        if (bluetoothToggle) bluetoothToggle.checked = settings.showBluetoothConnections;
        if (areaModeSelect) areaModeSelect.value = settings.deviceAreaMode;
        if (powerLabelMode) powerLabelMode.value = settings.powerLabelMode;
        const showIconsToggle = document.getElementById('diagram-show-icons');
        if (showIconsToggle) showIconsToggle.checked = settings.showDeviceIcons;
        const dimFilteredToggle = document.getElementById('diagram-dim-filtered');
        if (dimFilteredToggle) dimFilteredToggle.checked = settings.dimFilteredDevices;
        const showInternetToggle = document.getElementById('diagram-show-internet');
        if (showInternetToggle) showInternetToggle.checked = settings.showInternet;
        const colorByNetworkToggle = document.getElementById('diagram-color-by-network');
        if (colorByNetworkToggle) colorByNetworkToggle.checked = settings.colorByNetwork;
        syncDiagramLegend();
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

    function handleDiagramDisplaySelectChange(event) {
        const targetId = String(event?.target?.id || "");
        const preserveViewport = targetId === "device-area-mode" || targetId === "power-label-mode";
        void persistDiagramDisplaySettings();
        void renderNetwork({ preserveViewport });
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
        isps = Array.isArray(options.isps) ? options.isps : [];
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
            isps: data.isps || [],
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
        if (Array.isArray(next.isps)) {
            isps = next.isps;
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
        const dimFilteredMode = Boolean(document.getElementById('diagram-dim-filtered')?.checked ?? true);
        renderNetwork({ preserveViewport: dimFilteredMode });
    }

    function setVisible(isVisible) {
        isDiagramVisible = Boolean(isVisible);
        syncTraceFlowAnimation();
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

    // The card size to persist: for a device grown to host port chips, the node's
    // width/height include the chip bands, so save the pre-chip base instead —
    // otherwise the bands would be re-added on top of the saved size on every
    // reload and the card would keep growing.
    function getDeviceBaseSize(node) {
        if (!node) return null;
        const baseWidth = Number(node.data('chipBaseWidth'));
        const baseHeight = Number(node.data('chipBaseHeight'));
        if (Number.isFinite(baseWidth) && Number.isFinite(baseHeight)) {
            return { width: baseWidth, height: baseHeight };
        }
        return getDeviceNodeSize(node);
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
        const iconSvgContent = String(node.data('cardIconSvgContent') || '').trim() || null;
        const imageHref = String(node.data('cardImageUrl') || '').trim();
        const rotation = getDeviceNodeRotation(node);
        // A rotated card can't host chips (its frame is rotated), so drop them
        // while rotated and let the next full render rebuild the chip layout.
        const chipLayout = rotation ? null : (node.data('cardChipLayout') || null);
        // Without a live chip layout the node must shrink back to its pre-chip
        // base, or a formerly-grown card would redraw at the banded size empty.
        const baseWidth = Number(node.data('chipBaseWidth'));
        const baseHeight = Number(node.data('chipBaseHeight'));
        const hasChipBase = Number.isFinite(baseWidth) && Number.isFinite(baseHeight);
        if (!chipLayout && hasChipBase && Number(node.data('width')) !== baseWidth) {
            node.data({ width: baseWidth, height: baseHeight });
        }
        const width = Number(node.data('width')) || DEVICE_BASE_METRICS.width;
        const height = Number(node.data('height')) || DEVICE_BASE_METRICS.height;
        const fontSize = Number(node.data('fontSize')) || DEVICE_BASE_METRICS.fontSize;
        const textMaxWidth = Number(node.data('textMaxWidth')) || DEVICE_BASE_METRICS.textMaxWidth;
        const padding = Number(node.data('padding')) || DEVICE_BASE_METRICS.padding;
        const signature = JSON.stringify({
            label,
            status,
            storageLabel,
            iconSvgContent,
            imageHref,
            rotation,
            width,
            height,
            fontSize,
            textMaxWidth,
            padding,
            chips: chipLayout ? `${chipLayout.chips.length}:${chipLayout.nodeWidth}x${chipLayout.nodeHeight}` : ''
        });
        const lastSignature = String(node.data('cardSvgSignature') || '');
        if (lastSignature && lastSignature === signature) {
            return;
        }
        node.data('cardSvgTargetSignature', signature);
        // When chips are present the node.data width/height are the grown node
        // size; the builder derives the card size from the chip layout instead.
        const cardWidth = chipLayout ? chipLayout.cardWidth : width;
        const cardHeight = chipLayout ? chipLayout.cardHeight : height;
        const url = buildDeviceCardSvg({
            label,
            status,
            storageLabel,
            rotation,
            iconSvgContent,
            imageHref,
            width: cardWidth,
            height: cardHeight,
            fontSize,
            textMaxWidth,
            padding,
            chipLayout
        });
        if (cardSvgCache.has(url)) {
            node.data('cardSvg', url);
            node.data('cardSvgRotation', rotation);
            node.data('cardSvgSignature', signature);
            return;
        }

        const img = new Image();
        img.onload = () => {
            cardSvgCache.add(url);
            if (!cy) return;
            const target = cy.getElementById(node.id());
            if (!target || target.empty()) return;
            const targetSignature = String(target.data('cardSvgTargetSignature') || '');
            if (!targetSignature || targetSignature !== signature) return;
            target.data('cardSvg', url);
            target.data('cardSvgRotation', rotation);
            target.data('cardSvgSignature', signature);
        };
        img.onerror = () => {
            cardSvgCache.add(url);
            if (!cy) return;
            const target = cy.getElementById(node.id());
            if (!target || target.empty()) return;
            const targetSignature = String(target.data('cardSvgTargetSignature') || '');
            if (!targetSignature || targetSignature !== signature) return;
            target.data('cardSvg', url);
            target.data('cardSvgRotation', rotation);
            target.data('cardSvgSignature', signature);
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
        updateDiagramFloorPlanCta(hasBackground);
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

    function resolveSavedSize(savedPositions, deviceId) {
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
        return isLayoutEditable;
    }

    function resolveAutoDeviceSize({ label, storageLabel, hasMedia, savedSize }) {
        const fontSize = DEVICE_BASE_METRICS.fontSize;
        const lineHeight = fontSize * 1.25;
        const basePadding = DEVICE_BASE_METRICS.padding;
        const minWidth = DEVICE_SIZE_LIMITS.minWidth;
        const maxWidth = DEVICE_SIZE_LIMITS.maxWidth;
        const mediaSize = hasMedia ? 38 : 0;
        const mediaOffset = hasMedia ? (basePadding + mediaSize + 8) : (basePadding + 7);
        const horizontalPadding = basePadding + 6;
        const maxTextWidth = Math.max(50, maxWidth - mediaOffset - horizontalPadding);
        let width = Math.max(DEVICE_BASE_METRICS.width, minWidth);
        let textWidth = Math.max(60, width - mediaOffset - horizontalPadding);
        let lines = buildSvgTextLines(label, textWidth, fontSize, Number.POSITIVE_INFINITY);
        while (lines.length > DEVICE_TEXT_MAX_LINES && width < maxWidth) {
            width = Math.min(maxWidth, width + 26);
            textWidth = Math.max(60, width - mediaOffset - horizontalPadding);
            lines = buildSvgTextLines(label, textWidth, fontSize, Number.POSITIVE_INFINITY);
        }
        const longestLineLength = lines.reduce((maxLen, line) => Math.max(maxLen, line.length), 0);
        const approxCharWidth = fontSize * 0.55;
        const neededTextWidth = Math.min(
            maxTextWidth,
            Math.max(70, Math.ceil(longestLineLength * approxCharWidth) + 8)
        );
        width = clampNumber(
            Math.max(width, neededTextWidth + mediaOffset + horizontalPadding),
            minWidth,
            maxWidth
        );
        textWidth = Math.max(60, width - mediaOffset - horizontalPadding);
        lines = buildSvgTextLines(label, textWidth, fontSize, Number.POSITIVE_INFINITY);

        const storageReserve = storageLabel ? 24 : 0;
        const textHeight = Math.max(lineHeight, lines.length * lineHeight);
        const contentHeight = Math.max(
            hasMedia ? mediaSize + basePadding * 2 : 0,
            textHeight + basePadding * 2 + storageReserve
        );
        const height = clampNumber(
            Math.ceil(contentHeight),
            DEVICE_SIZE_LIMITS.minHeight,
            DEVICE_SIZE_LIMITS.maxHeight
        );
        if (!savedSize) {
            return { width, height };
        }
        return {
            width: clampNumber(Math.max(savedSize.width, width), minWidth, maxWidth),
            height: clampNumber(
                Math.max(savedSize.height, height),
                DEVICE_SIZE_LIMITS.minHeight,
                DEVICE_SIZE_LIMITS.maxHeight
            )
        };
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
        const size = getDeviceBaseSize(node);
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
            const size = node && !node.empty() ? getDeviceBaseSize(node) : null;
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
            const [storedFile, storedOpacity, storedCtaDismissed] = await Promise.all([
                getUiPreference(DIAGRAM_BACKGROUND_UI_KEY),
                getUiPreference(DIAGRAM_BACKGROUND_OPACITY_UI_KEY),
                getUiPreference(DIAGRAM_FLOORPLAN_CTA_DISMISSED_UI_KEY)
            ]);
            diagramFloorPlanCtaDismissed = Boolean(storedCtaDismissed);
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
            backgroundLayer.style.transform = '';
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
        backgroundLayer.style.transform = 'none';
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
    const hdmiToggle = document.getElementById('show-hdmi-connections');
    if (hdmiToggle) {
        hdmiToggle.addEventListener('change', handleDiagramConnectionToggleChange);
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
    const bluetoothToggle = document.getElementById('show-bluetooth-connections');
    if (bluetoothToggle) {
        bluetoothToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const showIconsToggle = document.getElementById('diagram-show-icons');
    if (showIconsToggle) {
        showIconsToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const showInternetToggle = document.getElementById('diagram-show-internet');
    if (showInternetToggle) {
        showInternetToggle.addEventListener('change', handleDiagramConnectionToggleChange);
    }
    const colorByNetworkToggle = document.getElementById('diagram-color-by-network');
    if (colorByNetworkToggle) {
        colorByNetworkToggle.addEventListener('change', () => {
            // Turning coloring off drops any active VLAN highlight before re-render.
            if (!colorByNetworkToggle.checked) {
                highlightedNetworkId = null;
            }
            handleDiagramConnectionToggleChange();
        });
    }
    const dimFilteredToggle = document.getElementById('diagram-dim-filtered');
    if (dimFilteredToggle) {
        dimFilteredToggle.addEventListener('change', handleDiagramConnectionToggleChange);
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
    initDiagramSearch();
    initDiagramLegend();
    initDiagramFloorPlanCta();
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
        document.addEventListener('keydown', handleAnalysisEscape);
        // Pause the trace flow animation while the browser tab is hidden, and
        // honor OS-level reduced-motion changes live.
        document.addEventListener('visibilitychange', syncTraceFlowAnimation);
        if (typeof TRACE_FLOW_REDUCED_MOTION_QUERY.addEventListener === 'function') {
            TRACE_FLOW_REDUCED_MOTION_QUERY.addEventListener('change', syncTraceFlowAnimation);
        }
        const analysisClearBtn = document.getElementById('map-analysis-clear');
        if (analysisClearBtn) {
            analysisClearBtn.addEventListener('click', clearDiagramAnalysis);
        }
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
        // ISP clouds are only grabified, never locked: positionIspNodes() must
        // still be able to move the auto-positioned ones programmatically.
        const ispNodes = cy.nodes('[type="internet"]');
        if (isLayoutEditable) {
            if (!cachedPositions) {
                cachedPositionsUseBackground = hasDiagramBackground();
                cachedPositions = await loadPositions(cachedPositionsUseBackground);
            }
            nodes.unlock();
            nodes.grabify();
            floorsAndAreas.unlock();
            floorsAndAreas.grabify();
            ispNodes.grabify();
        } else {
            nodes.lock();
            nodes.ungrabify();
            floorsAndAreas.lock();
            floorsAndAreas.ungrabify();
            ispNodes.ungrabify();
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

// Leaving the diagram means tearing down its overlays and fullscreen first,
// otherwise the browser restores the page in a half-fullscreen state.
async function leaveDiagramForNavigation() {
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
}

async function navigateToDeviceEdit(deviceId) {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) return;

    await leaveDiagramForNavigation();

    window.location.href = `device-edit.html?id=${encodeURIComponent(normalizedId)}`;
}

// ISPs live in Settings, so editing one deep-links into that panel with the
// provider modal already open.
async function navigateToIspEdit(ispId) {
    const normalizedId = String(ispId || '').trim();
    if (!normalizedId) return;

    await leaveDiagramForNavigation();

    window.location.href = `settings.html?panel=isps&isp=${encodeURIComponent(normalizedId)}`;
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
                    'background-color': '#101216',
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
                    'background-color': '#006fff',
                    'background-opacity': 0.03,
                    'border-color': 'rgba(0, 111, 255, 0.5)',
                    'border-width': 1.5,
                    'label': 'data(label)',
                    'text-valign': 'top',
                    'text-halign': 'center',
                    'text-margin-y': 20,
                    'font-size': 20,
                    'font-weight': 'bold',
                    'color': '#338bff',
                    'text-background-color': 'rgba(28, 31, 38, 0.9)',
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
                    'border-color': 'rgba(86, 93, 107, 0.4)',
                    'border-width': 2,
                    'border-style': 'dashed',
                    'label': 'data(label)',
                    'text-valign': 'top',
                    'text-halign': 'center',
                    'text-margin-y': 18,
                    'font-size': 16,
                    'font-weight': 'bold',
                    'color': '#7e8595',
                    'text-background-color': 'rgba(28, 31, 38, 0.9)',
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
                    'border-color': '#f5a524'
                }
            },
            // Device not working status
            {
                selector: 'node[type="device"][status="not-working"]',
                style: {
                    'border-color': '#f0383b'
                }
            },
            // Device working status
            {
                selector: 'node[type="device"][status="working"]',
                style: {
                    'border-color': '#38cc65'
                }
            },
            // Search highlight (subtle glow while the locate ping animates)
            {
                selector: 'node.search-pulse',
                style: {
                    'overlay-color': '#006fff',
                    'overlay-opacity': 0.12,
                    'overlay-padding': 6
                }
            },
            // Devices excluded by the active filters (highlight mode)
            {
                selector: 'node.filter-dimmed',
                style: {
                    'opacity': 0.14
                }
            },
            {
                selector: 'edge.filter-dimmed',
                style: {
                    'opacity': 0.08,
                    'text-opacity': 0
                }
            },
            // Network (VLAN) coloring: a tinted halo behind the device card when
            // "Color by network" is on and the device belongs to a network.
            {
                selector: 'node[type="device"][networkColor]',
                style: {
                    'underlay-color': 'data(networkColor)',
                    'underlay-opacity': 0.35,
                    'underlay-padding': 7,
                    'underlay-shape': 'roundrectangle'
                }
            },
            // Devices/edges outside the spotlighted VLAN fade back.
            {
                selector: 'node.network-dimmed',
                style: {
                    'opacity': 0.12
                }
            },
            {
                selector: 'edge.network-dimmed',
                style: {
                    'opacity': 0.06,
                    'text-opacity': 0
                }
            },
            // Edge styles
            {
                selector: 'edge[connectionType="ethernet"]',
                style: {
                    'width': 2,
                    'line-color': '#006fff',
                    // No arrowheads on Ethernet/SFP links — the port chips at each
                    // end already show where the cable lands.
                    'target-arrow-shape': 'none',
                    'source-arrow-shape': 'none',
                    'curve-style': 'bezier',
                    // Cable type, negotiated speed and PoE (see formatEthernetLabel).
                    'label': 'data(label)',
                    // Each end's port speed is drawn as a chip inside its device
                    // card; the chip pass sets a per-edge inline endpoint style
                    // (an "x y" px offset from the node center) so the line ends
                    // on that chip. Endpoint props can't be data()-mapped, hence
                    // the inline style; ends without a chip keep the default.
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="usb"]',
                style: {
                    'width': 2,
                    'line-color': '#00a0e0',
                    'target-arrow-color': '#00a0e0',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="hdmi"]',
                style: {
                    'width': 2,
                    'line-color': '#a855f7',
                    'target-arrow-color': '#a855f7',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="power"]',
                style: {
                    'width': 2,
                    'line-color': '#f5a524',
                    'target-arrow-color': '#f5a524',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="wifi"]',
                style: {
                    'width': 2,
                    'line-color': '#339fff',
                    'line-style': 'dashed',
                    'line-dash-pattern': [8, 6],
                    'target-arrow-shape': 'none',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="zigbee"]',
                style: {
                    'width': 2,
                    'line-color': '#f7c948',
                    'line-style': 'dashed',
                    'line-dash-pattern': [7, 5],
                    'target-arrow-shape': 'none',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                // Bluetooth is short range and point to point, so a tighter dash
                // keeps it apart from the mesh protocols above.
                selector: 'edge[connectionType="bluetooth"]',
                style: {
                    'width': 2,
                    'line-color': '#ec4899',
                    'line-style': 'dashed',
                    'line-dash-pattern': [4, 4],
                    'target-arrow-shape': 'none',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge[connectionType="zwave"]',
                style: {
                    'width': 2,
                    'line-color': '#38cc65',
                    'line-style': 'dashed',
                    'line-dash-pattern': [7, 5],
                    'target-arrow-shape': 'none',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            // Internet provider clouds and WAN links
            {
                selector: 'node[type="internet"]',
                style: {
                    'background-color': 'rgba(0, 0, 0, 0)',
                    'background-opacity': 0,
                    'border-width': 0,
                    'overlay-opacity': 0,
                    'background-image': 'data(cardSvg)',
                    'background-fit': 'contain',
                    'background-repeat': 'no-repeat',
                    'shape': 'rectangle',
                    'width': 'data(width)',
                    'height': 'data(height)',
                    'label': '',
                    'text-opacity': 0,
                    // Cloud cards are pill-shaped: make any highlight underlay
                    // (failure simulation, trace path) follow that shape. The
                    // radius is clamped to half the underlay height, so one
                    // generous value covers every underlay padding.
                    'underlay-shape': 'round-rectangle',
                    'underlay-corner-radius': 32
                }
            },
            {
                selector: 'edge[connectionType="wan"]',
                style: {
                    'width': 2,
                    'line-color': '#7e8595',
                    'target-arrow-shape': 'none',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 10,
                    'color': '#f7f8fa',
                    'text-outline-width': 2,
                    'text-outline-color': 'rgba(16, 18, 22, 0.9)',
                    'text-background-color': 'rgba(16, 18, 22, 0.8)',
                    'text-background-opacity': 1,
                    'text-background-padding': 2,
                    'text-background-shape': 'roundrectangle'
                }
            },
            {
                // Over-the-air last miles (cellular, satellite, fixed wireless)
                // read as dashed, matching the other wireless layers.
                selector: 'edge[connectionType="wan"][medium="wireless"]',
                style: {
                    'line-style': 'dashed',
                    'line-dash-pattern': [8, 6]
                }
            },
            // Network (VLAN) coloring for device-to-device links. Same-VLAN links
            // take the network color; cross-VLAN links render dashed and neutral
            // so the boundary (usually a router hop) is obvious. Kept after the
            // per-type edge styles so it overrides their line colors.
            {
                selector: 'edge[networkColor]',
                style: {
                    'line-color': 'data(networkColor)',
                    'target-arrow-color': 'data(networkColor)',
                    'source-arrow-color': 'data(networkColor)'
                }
            },
            {
                selector: 'edge[crossVlan="true"]',
                style: {
                    'line-style': 'dashed',
                    'line-color': '#7e8595',
                    'target-arrow-color': '#7e8595',
                    'source-arrow-color': '#7e8595'
                }
            },
            // Trace path highlight (kept after the per-type edge styles so the
            // accent color wins over the connection-type line colors)
            {
                selector: 'node.trace-path',
                style: {
                    'underlay-color': '#006fff',
                    'underlay-opacity': 0.15,
                    'underlay-padding': 4,
                    'underlay-shape': 'roundrectangle'
                }
            },
            {
                selector: 'node.trace-source',
                style: {
                    'underlay-opacity': 0.3
                }
            },
            {
                selector: 'edge.trace-path',
                style: {
                    'width': 3.5,
                    'line-color': '#006fff',
                    'line-style': 'solid',
                    'target-arrow-color': '#006fff',
                    'source-arrow-color': '#006fff',
                    'z-index': 9999
                }
            },
            {
                // While the trace flow animation runs, the highlighted path
                // switches to a dense dash so the marching motion reads clearly;
                // without animation (reduced motion) it stays solid.
                selector: 'edge.trace-path.trace-flow',
                style: {
                    'line-style': 'dashed',
                    'line-dash-pattern': [12, 6]
                }
            },
            {
                selector: 'node.trace-dimmed',
                style: {
                    'opacity': 0.14
                }
            },
            {
                selector: 'edge.trace-dimmed',
                style: {
                    'opacity': 0.08,
                    'text-opacity': 0
                }
            },
            // Failure simulation
            {
                selector: 'node.sim-failed',
                style: {
                    'underlay-color': '#f0383b',
                    'underlay-opacity': 0.4,
                    'underlay-padding': 6,
                    'underlay-shape': 'roundrectangle'
                }
            },
            {
                selector: 'node.sim-affected',
                style: {
                    'underlay-color': '#f0383b',
                    'underlay-opacity': 0.16,
                    'underlay-padding': 4,
                    'underlay-shape': 'roundrectangle'
                }
            },
            // Devices that keep LAN connectivity but lose their path to internet
            {
                selector: 'node.sim-no-internet',
                style: {
                    'underlay-color': '#f5a524',
                    'underlay-opacity': 0.5,
                    'underlay-padding': 5,
                    'underlay-shape': 'roundrectangle'
                }
            },
            {
                selector: 'edge.sim-dead',
                style: {
                    'line-color': '#f0383b',
                    'target-arrow-color': '#f0383b',
                    'source-arrow-color': '#f0383b',
                    'opacity': 0.4,
                    'line-style': 'dashed',
                    'line-dash-pattern': [6, 5]
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

    cy.on('tap', 'node[type="internet"]', function(evt) {
        if (canResizeDevices()) return;
        hideResizeHandles();
        showIspTooltip(evt.target);
    });

    // While editing the layout, moving a device re-evaluates which card edge each
    // port chip sits on (top/bottom) so links stay pretty in real time. Only the
    // moved device and its wired neighbours can change, and rebuilds are batched
    // per frame and skipped when the chip layout is unchanged.
    let pendingChipRecompute = new Set();
    let chipRecomputeRaf = null;

    function getPortNeighborIds(deviceId) {
        const device = devices.find((d) => String(d.id) === String(deviceId));
        const ids = new Set();
        if (device && Array.isArray(device.ports)) {
            device.ports.forEach((port) => {
                if (port && port.connectedTo) ids.add(String(port.connectedTo));
            });
        }
        return ids;
    }

    function scheduleChipRecompute(deviceId) {
        if (!isLayoutEditable) return;
        pendingChipRecompute.add(String(deviceId));
        getPortNeighborIds(deviceId).forEach((id) => pendingChipRecompute.add(id));
        if (chipRecomputeRaf) return;
        chipRecomputeRaf = requestAnimationFrame(() => {
            chipRecomputeRaf = null;
            const ids = pendingChipRecompute;
            pendingChipRecompute = new Set();
            recomputePortChipsForDevices(ids);
        });
    }

    function recomputePortChipsForDevices(ids) {
        if (!cy || !ids || !ids.size) return;
        const showEthernet = document.getElementById('show-ethernet-connections')?.checked ?? true;
        if (!showEthernet) return;
        const visible = new Set(cy.nodes('node[type="device"]').map((n) => n.id()));
        const getPos = (id) => {
            const n = cy.getElementById(String(id));
            if (!n || n.empty() || n.data('type') !== 'device') return null;
            const p = n.position();
            return { x: p.x, y: p.y };
        };
        const isVisible = (id) => visible.has(String(id));

        ids.forEach((id) => {
            const node = cy.getElementById(String(id));
            if (!node || node.empty() || node.data('type') !== 'device') return;
            if (normalizeDeviceRotation(node.data('rotation') || 0) !== 0) return;
            const device = devices.find((d) => String(d.id) === String(id));
            if (!device) return;
            const lists = buildDeviceChipList(device, getPos, isVisible);
            if (!lists) return;
            const { topChips, bottomChips, allChips } = lists;

            const chipWidth = Math.max(...allChips.map((c) => measurePortChipWidth(c.text)));
            const baseWidth = Number(node.data('chipBaseWidth')) || Number(node.data('width')) || DEVICE_BASE_METRICS.width;
            const baseHeight = Number(node.data('chipBaseHeight')) || Number(node.data('height')) || DEVICE_BASE_METRICS.height;
            const layout = computeDeviceChipLayout(baseWidth, baseHeight, topChips, bottomChips, chipWidth);
            const sig = portChipSignature(allChips);

            if (node.data('chipLayoutSig') !== sig) {
                node.data('chipBaseWidth', baseWidth);
                node.data('chipBaseHeight', baseHeight);
                node.data('width', layout.nodeWidth);
                node.data('height', layout.nodeHeight);
                node.data('cardChipLayout', layout);
                node.data('chipLayoutSig', sig);
                node.data('cardSvgSignature', '');
                node.data('cardSvgTargetSignature', '');
                node.data('cardSvg', buildDeviceCardSvg({
                    label: node.data('cardLabel') || node.data('label'),
                    status: node.data('cardStatus') || node.data('status'),
                    storageLabel: node.data('cardStorageLabel') || '',
                    rotation: 0,
                    iconSvgContent: node.data('cardIconSvgContent') || null,
                    imageHref: node.data('cardImageUrl') || '',
                    width: baseWidth,
                    height: baseHeight,
                    fontSize: node.data('fontSize'),
                    textMaxWidth: node.data('textMaxWidth'),
                    padding: node.data('padding'),
                    chipLayout: layout
                }));
                // Ethernet endpoints follow the chip they land on (layout changed).
                layout.chips.forEach((chip) => {
                    if (!chip.connected || !chip.otherId) return;
                    const other = cy.getElementById(String(chip.otherId));
                    if (!other || other.empty()) return;
                    const offX = (chip.cx - layout.nodeWidth / 2).toFixed(1);
                    const offY = (chip.cy - layout.nodeHeight / 2).toFixed(1);
                    const ep = `${offX}px ${offY}px`;
                    node.edgesWith(other).forEach((edge) => {
                        if (edge.data('connectionType') !== 'ethernet') return;
                        if (edge.source().id() === String(id)) edge.style('source-endpoint', ep);
                        else edge.style('target-endpoint', ep);
                    });
                });
            }

            // Non-ethernet ends clip to the card body and depend on live positions,
            // so refresh them every move.
            node.connectedEdges().forEach((edge) => {
                if (edge.data('connectionType') === 'ethernet') return;
                const other = edge.source().id() === String(id) ? edge.target() : edge.source();
                if (!other || other.empty() || other.data('type') !== 'device') return;
                const ep = computeCardBoundaryEndpoint(
                    { x: other.position().x, y: other.position().y },
                    { x: node.position().x, y: node.position().y },
                    layout
                );
                if (edge.source().id() === String(id)) edge.style('source-endpoint', ep);
                else edge.style('target-endpoint', ep);
            });
        });
    }

    // Clouds follow their gateway while it is dragged in layout edit mode
    cy.on('position', 'node[type="device"]', (event) => {
        repositionIspNodesForGateway(event.target.id());
        scheduleChipRecompute(event.target.id());
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

    // Dragging a cloud detaches it from auto-follow and marks the layout dirty
    cy.on('dragfree', 'node[type="internet"]', (event) => {
        event.target.data('hasSavedPosition', 'true');
        markLayoutDirty();
    });



    // Allow panning by dragging on nodes when not in edit mode (devices), always for background/areas/floors
    cy.on('tapstart', 'node[type="device"]', (event) => {
        if (isLayoutEditable) return;
        isPanningFromNode = true;
        lastPanPosition = event.renderedPosition;
    });

    cy.on('tapstart', 'node[type="area"], node[type="floor"], node[type="diagram-background"], node[type="internet"]', (event) => {
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
const DIAGRAM_FLOORPLAN_CTA_DISMISSED_UI_KEY = 'diagramFloorPlanCtaDismissed';
let diagramFloorPlanCtaDismissed = false;

function updateDiagramFloorPlanCta(hasBackground) {
    const cta = document.getElementById('map-floorplan-cta');
    if (!cta) return;
    cta.hidden = Boolean(hasBackground) || diagramFloorPlanCtaDismissed;
}

function initDiagramFloorPlanCta() {
    const uploadBtn = document.getElementById('map-floorplan-cta-upload');
    const dismissBtn = document.getElementById('map-floorplan-cta-dismiss');
    const backgroundInput = document.getElementById('diagram-background-input');
    if (uploadBtn && backgroundInput) {
        uploadBtn.addEventListener('click', () => backgroundInput.click());
    }
    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            diagramFloorPlanCtaDismissed = true;
            updateDiagramFloorPlanCta(true);
            setUiPreference(DIAGRAM_FLOORPLAN_CTA_DISMISSED_UI_KEY, true).catch((error) => {
                console.error('Failed to persist floor plan CTA dismissal:', error);
            });
        });
    }
}

let mapSearchMatches = [];
let mapSearchActiveIndex = 0;

function isDiagramSearchOpen() {
    const panel = document.getElementById('map-search');
    return Boolean(panel && !panel.hidden);
}

function openDiagramSearch() {
    const panel = document.getElementById('map-search');
    const input = document.getElementById('map-search-input');
    const trigger = document.getElementById('map-search-btn');
    if (!panel || !input) return;
    panel.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    input.value = '';
    renderDiagramSearchResults('');
    input.focus();
}

function closeDiagramSearch() {
    const panel = document.getElementById('map-search');
    const trigger = document.getElementById('map-search-btn');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function renderDiagramSearchResults(query) {
    const resultsEl = document.getElementById('map-search-results');
    if (!resultsEl || !cy) return;
    const normalized = String(query || '').trim().toLowerCase();
    const deviceNodes = cy.nodes('node[type="device"]').map((deviceNode) => ({
        id: deviceNode.id(),
        label: String(deviceNode.data('label') || '')
    }));
    deviceNodes.sort((a, b) => a.label.localeCompare(b.label));
    mapSearchMatches = deviceNodes
        .filter(item => !normalized || item.label.toLowerCase().includes(normalized))
        .slice(0, 7);
    mapSearchActiveIndex = 0;
    if (!mapSearchMatches.length) {
        resultsEl.innerHTML = '<div class="map-search-empty">No devices found</div>';
        return;
    }
    resultsEl.innerHTML = mapSearchMatches.map((item, index) => `
        <button type="button" class="map-search-item${index === 0 ? ' is-active' : ''}" data-device-id="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>
    `).join('');
}

function updateDiagramSearchActiveItem() {
    const resultsEl = document.getElementById('map-search-results');
    if (!resultsEl) return;
    resultsEl.querySelectorAll('.map-search-item').forEach((item, index) => {
        item.classList.toggle('is-active', index === mapSearchActiveIndex);
    });
}

function focusDiagramDevice(deviceId) {
    if (!cy) return;
    const node = cy.getElementById(String(deviceId || ''));
    if (!node || node.empty()) return;
    closeDiagramSearch();
    hideDeviceTooltip();
    cy.stop();
    cy.animate(
        { zoom: Math.max(cy.zoom(), 0.9), center: { eles: node } },
        { duration: 450, easing: 'ease-in-out-cubic', complete: () => pulseDiagramNode(node) }
    );
}

function pulseDiagramNode(node) {
    const mapContainer = document.getElementById('network-map');
    if (!mapContainer) return;
    const existingPing = mapContainer.querySelector('.map-locate-ping');
    if (existingPing) existingPing.remove();

    const position = node.renderedPosition();
    const size = Math.max(node.renderedWidth(), node.renderedHeight()) * 2.4;
    const ping = document.createElement('div');
    ping.className = 'map-locate-ping';
    ping.style.left = `${position.x}px`;
    ping.style.top = `${position.y}px`;
    ping.style.width = `${size}px`;
    ping.style.height = `${size}px`;
    ping.innerHTML = '<span></span><span></span><span></span>';
    mapContainer.appendChild(ping);

    node.addClass('search-pulse');
    setTimeout(() => {
        node.removeClass('search-pulse');
        ping.remove();
    }, 1900);
}

function initDiagramSearch() {
    const trigger = document.getElementById('map-search-btn');
    const panel = document.getElementById('map-search');
    const input = document.getElementById('map-search-input');
    const resultsEl = document.getElementById('map-search-results');
    if (!trigger || !panel || !input || !resultsEl) return;

    trigger.addEventListener('click', () => {
        if (isDiagramSearchOpen()) {
            closeDiagramSearch();
        } else {
            openDiagramSearch();
        }
    });

    input.addEventListener('input', () => renderDiagramSearchResults(input.value));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeDiagramSearch();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!mapSearchMatches.length) return;
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            mapSearchActiveIndex = (mapSearchActiveIndex + delta + mapSearchMatches.length) % mapSearchMatches.length;
            updateDiagramSearchActiveItem();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const match = mapSearchMatches[mapSearchActiveIndex];
            if (match) {
                focusDiagramDevice(match.id);
            }
        }
    });

    resultsEl.addEventListener('click', (event) => {
        const item = event.target.closest('.map-search-item');
        if (item) {
            focusDiagramDevice(item.getAttribute('data-device-id'));
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!isDiagramSearchOpen()) return;
        if (panel.contains(event.target) || trigger.contains(event.target)) return;
        closeDiagramSearch();
    });
}

function syncDiagramLegend() {
    document.querySelectorAll('.map-legend-chip').forEach((chip) => {
        const checkbox = document.getElementById(chip.getAttribute('data-connection') || '');
        if (!checkbox) return;
        chip.classList.toggle('is-off', !checkbox.checked);
        chip.setAttribute('aria-pressed', checkbox.checked ? 'true' : 'false');
    });
}

function initDiagramLegend() {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    legend.querySelectorAll('.map-legend-chip').forEach((chip) => {
        const checkbox = document.getElementById(chip.getAttribute('data-connection') || '');
        if (!checkbox) return;
        chip.addEventListener('click', () => checkbox.click());
        checkbox.addEventListener('change', syncDiagramLegend);
    });
    syncDiagramLegend();
}

// Which networks actually have at least one device currently on the map, so the
// legend only lists VLANs the user can see.
function getNetworksOnMap() {
    if (!cy) return [];
    const presentIds = new Set();
    cy.nodes('[type="device"]').forEach((node) => {
        const device = devices.find(d => String(d.id || '') === node.id());
        const netId = device ? String(device.networkId || '').trim() : '';
        if (netId) presentIds.add(netId);
    });
    return (Array.isArray(networks) ? networks : []).filter(net => presentIds.has(String(net.id || '').trim()));
}

function renderNetworkLegend(colorByNetwork) {
    const legend = document.getElementById('map-network-legend');
    if (!legend) return;
    const networksOnMap = colorByNetwork ? getNetworksOnMap() : [];
    if (!networksOnMap.length) {
        legend.hidden = true;
        legend.innerHTML = '';
        legend.classList.remove('has-active');
        return;
    }
    const colorMap = buildNetworkColorMap(networks);
    legend.hidden = false;
    legend.innerHTML = networksOnMap.map((net) => {
        const id = String(net.id || '').trim();
        const color = colorMap.get(id) || '#7e8595';
        const vlanLabel = getNetworkVlanLabel(net);
        return `<button type="button" class="map-network-chip" data-network-id="${escapeHtml(id)}" aria-pressed="false">
            <span class="map-network-swatch" style="--network-color: ${escapeHtml(color)}" aria-hidden="true"></span>
            <span class="map-network-name">${escapeHtml(net.name || 'Network')}</span>
            ${vlanLabel ? `<span class="map-network-vlan">${escapeHtml(vlanLabel)}</span>` : ''}
        </button>`;
    }).join('');

    legend.querySelectorAll('.map-network-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            setNetworkHighlight(chip.getAttribute('data-network-id') || '');
        });
    });
}

function setNetworkHighlight(networkId) {
    const id = String(networkId || '').trim();
    highlightedNetworkId = (highlightedNetworkId === id || !id) ? null : id;
    applyNetworkHighlight();
}

// Spotlight one VLAN: its devices and intra-VLAN links stay bright, everything
// else dims. Re-applied after each render so it survives filter/layout changes.
function applyNetworkHighlight() {
    if (!cy) return;
    const legend = document.getElementById('map-network-legend');
    cy.nodes().removeClass('network-dimmed');
    cy.edges().removeClass('network-dimmed');

    const validIds = new Set((Array.isArray(networks) ? networks : []).map(net => String(net.id || '').trim()));
    if (highlightedNetworkId && !validIds.has(highlightedNetworkId)) {
        highlightedNetworkId = null;
    }

    if (!highlightedNetworkId) {
        if (legend) {
            legend.classList.remove('has-active');
            legend.querySelectorAll('.map-network-chip').forEach((chip) => {
                chip.classList.remove('is-active');
                chip.setAttribute('aria-pressed', 'false');
            });
        }
        return;
    }

    if (legend) {
        legend.classList.add('has-active');
        legend.querySelectorAll('.map-network-chip').forEach((chip) => {
            const isActive = chip.getAttribute('data-network-id') === highlightedNetworkId;
            chip.classList.toggle('is-active', isActive);
            chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    const inNetwork = new Set(
        devices
            .filter(device => String(device.networkId || '').trim() === highlightedNetworkId)
            .map(device => String(device.id || ''))
    );
    cy.nodes('[type="device"]').forEach((node) => {
        if (!inNetwork.has(node.id())) node.addClass('network-dimmed');
    });
    cy.edges().forEach((edge) => {
        const bothInside = inNetwork.has(edge.source().id()) && inNetwork.has(edge.target().id());
        if (!bothInside) edge.addClass('network-dimmed');
    });
}

function formatConnectionTypeLabel(type) {
    if (type === 'wifi') return 'Wi-Fi';
    if (type === 'usb') return 'USB';
    if (type === 'hdmi') return 'HDMI';
    if (type === 'zwave') return 'Z-Wave';
    return type.charAt(0).toUpperCase() + type.slice(1);
}

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
    const statusRaw = String(device.status || '');
    const statusLabel = statusRaw.replace(/-/g, ' ');
    const iconUrl = device.type ? `img/devices/${encodeURIComponent(device.type)}.svg` : 'img/devices/generic.svg';

    const detailRows = [];
    if (floor) detailRows.push(['Floor', floor.name]);
    const installedAreaName = installedAreaId ? getAreaName(areas, installedAreaId) : '';
    if (installedAreaName && installedAreaName !== 'Unknown') detailRows.push(['Installed area', installedAreaName]);
    const controlledAreaName = controlledAreaId ? getAreaName(areas, controlledAreaId) : '';
    if (controlledAreaName && controlledAreaName !== 'Unknown') detailRows.push(['Controlled area', controlledAreaName]);
    if (device.type) detailRows.push(['Type', getFriendlyOption(settings?.types, device.type, formatDeviceType)]);
    if (device.brand) detailRows.push(['Brand', getFriendlyOption(settings?.brands, device.brand, formatDeviceType)]);
    if (device.model) detailRows.push(['Model', device.model]);

    // Connections currently visible on the diagram for this device
    const connectionItems = [];
    node.connectedEdges().forEach((edge) => {
        const connectionType = String(edge.data('connectionType') || '');
        if (!connectionType) return;
        const other = edge.source().id() === node.id() ? edge.target() : edge.source();
        if (!other || other.empty() || other.data('type') !== 'device') return;
        connectionItems.push({ type: connectionType, name: String(other.data('label') || '') });
    });
    connectionItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.type.localeCompare(b.type));
    const visibleConnections = connectionItems.slice(0, 6);
    const extraConnections = connectionItems.length - visibleConnections.length;

    const detailsHtml = detailRows.map(([label, value]) => `
            <div class="tooltip-row">
                <span class="tooltip-label">${escapeHtml(label)}</span>
                <span class="tooltip-value">${escapeHtml(value)}</span>
            </div>`).join('');

    // Network (VLAN) row with a color chip matching the map coloring.
    const deviceNetwork = device.networkId
        ? (networks || []).find(net => String(net.id || '') === String(device.networkId))
        : null;
    let networkHtml = '';
    if (deviceNetwork) {
        const networkColor = getNetworkColor(networks, deviceNetwork.id) || '#7e8595';
        const networkMetaParts = [getNetworkVlanLabel(deviceNetwork), deviceNetwork.subnet].filter(Boolean).join(' · ');
        networkHtml = `
            <div class="tooltip-row">
                <span class="tooltip-label">Network</span>
                <span class="tooltip-value tooltip-network-value">
                    <span class="tooltip-network-swatch" style="--network-color: ${escapeHtml(networkColor)}" aria-hidden="true"></span>
                    <span class="tooltip-network-name">${escapeHtml(deviceNetwork.name || 'Network')}</span>
                    ${networkMetaParts ? `<span class="tooltip-network-meta">${escapeHtml(networkMetaParts)}</span>` : ''}
                </span>
            </div>`;
    }

    const connectionsHtml = connectionItems.length ? `
            <div class="tooltip-connections">
                <span class="tooltip-connections-title">Connections</span>
                ${visibleConnections.map(item => `
                <div class="tooltip-conn-row">
                    <span class="legend-line ${escapeHtml(item.type)}" aria-hidden="true"></span>
                    <span class="tooltip-conn-name">${escapeHtml(item.name)}</span>
                    <span class="tooltip-conn-type">${escapeHtml(formatConnectionTypeLabel(item.type))}</span>
                </div>`).join('')}
                ${extraConnections > 0 ? `<span class="tooltip-conn-more">+${extraConnections} more</span>` : ''}
            </div>` : '';

    const isSimulatedFailed = simulatedFailedDeviceIds.has(device.id);

    tooltip.innerHTML = `
        <div class="tooltip-header">
            <span class="tooltip-device-icon" aria-hidden="true"><img src="${iconUrl}" alt=""></span>
            <span class="tooltip-title">${escapeHtml(name)}</span>
            ${statusRaw ? `<span class="status-badge status-${escapeHtml(statusRaw)}">${escapeHtml(statusLabel)}</span>` : ''}
            <button class="tooltip-close-btn" onclick="document.getElementById('device-tooltip').remove()">×</button>
        </div>
        <div class="tooltip-body">
            ${detailsHtml}
            ${networkHtml}
            ${connectionsHtml}
        </div>
        <div class="tooltip-actions">
            <button class="tooltip-action-btn tooltip-trace-btn" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="5" cy="19" r="2.5"></circle>
                    <circle cx="19" cy="5" r="2.5"></circle>
                    <path d="M7 17c3-3 2 2 5-1s2 2 5-1"></path>
                </svg>
                Trace path
            </button>
            <button class="tooltip-action-btn tooltip-action-danger tooltip-simulate-btn" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4v7"></path>
                    <path d="M7.5 6.5a7 7 0 1 0 9 0"></path>
                </svg>
                ${isSimulatedFailed ? 'Restore device' : 'Simulate failure'}
            </button>
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
    const traceButton = tooltip.querySelector('.tooltip-trace-btn');
    if (traceButton) {
        traceButton.addEventListener('click', () => {
            hideDeviceTooltip();
            traceDevicePath(device.id);
        });
    }
    const simulateButton = tooltip.querySelector('.tooltip-simulate-btn');
    if (simulateButton) {
        simulateButton.addEventListener('click', () => {
            hideDeviceTooltip();
            toggleSimulatedFailure(device.id);
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
        // renderedPosition is relative to the cytoscape container; convert to
        // viewport coordinates (the tooltip is position: fixed) and keep the
        // tooltip on screen, flipping to the other side of the node if needed
        const containerRect = cy.container().getBoundingClientRect();
        const anchorX = containerRect.left + renderedPosition.x;
        const anchorY = containerRect.top + renderedPosition.y;
        const tooltipRect = tooltip.getBoundingClientRect();
        const margin = 12;
        let left = anchorX + 20;
        let top = anchorY + 20;
        if (left + tooltipRect.width > window.innerWidth - margin) {
            left = anchorX - tooltipRect.width - 20;
        }
        if (top + tooltipRect.height > window.innerHeight - margin) {
            top = anchorY - tooltipRect.height - 20;
        }
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }
}

// Minimal tooltip for ISP cloud nodes (they are not devices: no edit page)
function showIspTooltip(node) {
    hideDeviceTooltip();

    const isp = getIspByNodeId(node.id());
    if (!isp) return;

    const renderedPosition = node.renderedPosition();
    const tooltip = document.createElement('div');
    tooltip.id = 'device-tooltip';
    tooltip.className = 'device-tooltip';

    const name = isp.name || 'Internet';
    const technologyLabel = typeof getIspTechnologyLabel === 'function' ? getIspTechnologyLabel(isp.technology) : '';
    const download = formatIspSpeedValue(isp.downloadSpeed);
    const upload = formatIspSpeedValue(isp.uploadSpeed);
    const gatewayNode = cy ? cy.$id(String(node.data('gatewayId') || '')) : null;
    const gatewayName = gatewayNode && !gatewayNode.empty() ? String(gatewayNode.data('label') || '') : '';
    const gatewayAuto = node.data('gatewayAuto') === 'true';
    const isSimulatedDown = simulatedFailedDeviceIds.has(node.id());

    const detailRows = [];
    if (technologyLabel) detailRows.push(['Technology', technologyLabel]);
    if (download) detailRows.push(['Download', `${download} Mbps`]);
    if (upload) detailRows.push(['Upload', `${upload} Mbps`]);
    if (gatewayName) detailRows.push(['Gateway', gatewayAuto ? `${gatewayName} (auto)` : gatewayName]);
    if (isp.notes) detailRows.push(['Notes', isp.notes]);

    const detailsHtml = detailRows.map(([label, value]) => `
            <div class="tooltip-row">
                <span class="tooltip-label">${escapeHtml(label)}</span>
                <span class="tooltip-value">${escapeHtml(value)}</span>
            </div>`).join('');

    tooltip.innerHTML = `
        <div class="tooltip-header">
            <span class="tooltip-device-icon tooltip-isp-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">${getIspIconSvgContent(isp.technology)}</svg>
            </span>
            <span class="tooltip-title">${escapeHtml(name)}</span>
            ${isp.role === 'backup' ? '<span class="status-badge status-pending">Backup</span>' : ''}
            <button class="tooltip-close-btn" onclick="document.getElementById('device-tooltip').remove()">×</button>
        </div>
        <div class="tooltip-body">
            <div class="tooltip-row">
                <span class="tooltip-label">Type</span>
                <span class="tooltip-value">Internet provider</span>
            </div>
            ${detailsHtml}
        </div>
        <div class="tooltip-actions">
            <button class="tooltip-action-btn tooltip-action-danger tooltip-simulate-btn" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4v7"></path>
                    <path d="M7.5 6.5a7 7 0 1 0 9 0"></path>
                </svg>
                ${isSimulatedDown ? 'Restore provider' : 'Simulate outage'}
            </button>
        </div>
        <div class="tooltip-footer">
            <button class="tooltip-edit-btn" type="button">
                Edit Provider
            </button>
        </div>
    `;

    const tooltipRoot = document.fullscreenElement || document.getElementById('diagram-section') || document.getElementById('map-section') || document.body;
    tooltipRoot.appendChild(tooltip);

    const simulateButton = tooltip.querySelector('.tooltip-simulate-btn');
    if (simulateButton) {
        simulateButton.addEventListener('click', () => {
            hideDeviceTooltip();
            toggleSimulatedFailure(node.id());
        });
    }

    const editButton = tooltip.querySelector('.tooltip-edit-btn');
    if (editButton) {
        editButton.addEventListener('click', () => {
            void navigateToIspEdit(isp.id);
        });
    }

    bindTooltipDismiss(tooltip);

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
    const hdmiToggle = document.getElementById('show-hdmi-connections');
    const powerToggle = document.getElementById('show-power-connections');
    const wifiToggle = document.getElementById('show-wifi-connections');
    const zigbeeToggle = document.getElementById('show-zigbee-connections');
    const zwaveToggle = document.getElementById('show-zwave-connections');
    const bluetoothToggle = document.getElementById('show-bluetooth-connections');
    const showEthernet = ethernetToggle ? ethernetToggle.checked : true;
    const showUsb = usbToggle ? usbToggle.checked : true;
    const showHdmi = hdmiToggle ? hdmiToggle.checked : true;
    const showPower = powerToggle ? powerToggle.checked : true;
    const showWifi = wifiToggle ? wifiToggle.checked : false;
    const showZigbee = zigbeeToggle ? zigbeeToggle.checked : false;
    const showZwave = zwaveToggle ? zwaveToggle.checked : false;
    const showBluetooth = bluetoothToggle ? bluetoothToggle.checked : false;

    const matchedDevices = Array.isArray(filteredDevices)
        ? filteredDevices
        : (deviceFilters ? deviceFilters.getFilteredDevices() : devices);
    const dimFilteredMode = Boolean(document.getElementById('diagram-dim-filtered')?.checked ?? true);
    const sourceDevices = dimFilteredMode ? devices : matchedDevices;
    const filteredDevicesList = sourceDevices.filter(device => device.status !== 'wishlist');
    const matchedDeviceIds = dimFilteredMode ? new Set(matchedDevices.map(device => device.id)) : null;
    const hasBackground = hasDiagramBackground();
    const showIcons = Boolean(document.getElementById('diagram-show-icons')?.checked ?? true);

    const mapCountLabel = document.getElementById('map-devices-count');
    if (mapCountLabel) {
        const matchedCount = matchedDevices.filter(device => device.status !== 'wishlist').length;
        mapCountLabel.textContent = `${matchedCount} device${matchedCount !== 1 ? 's' : ''}`;
    }

    console.log('Rendering map with devices:', filteredDevicesList.length);

    if (hasBackground) {
        await ensureBackgroundImageReady();
    }

    if (showIcons) {
        await prefetchDeviceIcons(filteredDevicesList.map(d => d.type || null));
    }
    const embeddedDeviceImages = new Map();
    const devicesWithCustomImage = filteredDevicesList.filter((device) => String(device?.deviceImage?.path || '').trim());
    if (devicesWithCustomImage.length) {
        await Promise.all(devicesWithCustomImage.map(async (device) => {
            const deviceId = String(device?.id || '').trim();
            if (!deviceId) return;
            const imageUrl = await getEmbeddedDiagramDeviceImageUrl(device);
            if (!imageUrl) return;
            embeddedDeviceImages.set(deviceId, imageUrl);
        }));
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
        highlightedNetworkId = null;
        renderNetworkLegend(false);
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
    const floorById = new Map(
        floors
            .map((floor) => [String(floor?.id || '').trim(), floor])
            .filter(([floorId]) => Boolean(floorId))
    );
    const areasWithValidFloor = [];
    const areasWithoutValidFloor = [];
    filteredAreas.forEach((area) => {
        const floorId = String(area?.floor || '').trim();
        if (floorId && floorById.has(floorId)) {
            areasWithValidFloor.push(area);
            return;
        }
        areasWithoutValidFloor.push(area);
    });
    const floorIds = [...new Set(areasWithValidFloor.map((area) => String(area.floor || '').trim()).filter(Boolean))];
    const filteredFloors = floors.filter((floor) => floorIds.includes(String(floor?.id || '').trim()));
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
    const resolveDeviceSize = (deviceId) => resolveSavedSize(savedPositions, deviceId);
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
    
    // Sort floors by level (highest first) and add a synthetic floor for areas/devices missing floor assignment.
    const NO_FLOOR_FLOOR_KEY = '__no_floor__';
    const NO_FLOOR_NODE_ID = `floor-${NO_FLOOR_FLOOR_KEY}`;
    const sortedFloors = [...filteredFloors].sort((a, b) => (b.level || 0) - (a.level || 0));
    if (areasWithoutValidFloor.length || unassignedDevices.length) {
        sortedFloors.push({
            id: NO_FLOOR_FLOOR_KEY,
            name: 'No Floor',
            level: -10000,
            isSyntheticNoFloor: true
        });
    }
    
    let yOffset = 0;
    const floorSpacing = 300;
    const areaSpacing = 150;
    const deviceSpacingX = 180;
    const deviceSpacingY = 100;
    
    // Add floors, areas, and devices
    sortedFloors.forEach((floor, floorIndex) => {
        const areasInFloor = floor.isSyntheticNoFloor
            ? areasWithoutValidFloor
            : filteredAreas.filter((area) => String(area?.floor || '').trim() === String(floor.id || '').trim());
        
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
            
            // Sort devices: connected first, then unconnected (defined-but-free
            // ports do not count as connections)
            const hasPortConnections = d => Array.isArray(d.ports) && d.ports.some(p => p && p.connectedTo);
            const devicesWithConnections = devicesInArea.filter(hasPortConnections);
            const devicesWithoutConnections = devicesInArea.filter(d => !hasPortConnections(d));
            
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
                const typeIconKey = device.type ? `img/devices/${encodeURIComponent(device.type)}.svg` : 'img/devices/generic.svg';
                const typeIconSvg = _deviceIconCache[typeIconKey] || null;
                const uploadedImageUrl = embeddedDeviceImages.get(String(device.id || '').trim()) || '';
                const savedSize = resolveDeviceSize(device.id);
                const deviceSize = resolveAutoDeviceSize({
                    label: deviceLabel,
                    storageLabel,
                    hasMedia: Boolean(uploadedImageUrl || (showIcons && typeIconSvg)),
                    savedSize
                });
                applyDeviceSizeData(deviceData, deviceSize);
                deviceData.rotation = resolveDeviceRotation(device.id) ?? 0;
                deviceData.cardLabel = deviceLabel;
                deviceData.cardStatus = device.status || '';
                deviceData.cardStorageLabel = storageLabel || '';
                deviceData.cardIconSvgContent = showIcons ? (typeIconSvg || '') : '';
                deviceData.cardImageUrl = uploadedImageUrl;
                deviceData.cardSvgRotation = deviceData.rotation;
                deviceData.cardSvgTargetRotation = deviceData.rotation;
                deviceData.cardSvgSignature = '';
                deviceData.cardSvgTargetSignature = '';
                deviceData.cardSvg = buildDeviceCardSvg({
                    label: deviceLabel,
                    status: device.status,
                    storageLabel,
                    rotation: deviceData.rotation,
                    iconSvgContent: showIcons ? typeIconSvg : null,
                    imageHref: uploadedImageUrl,
                    width: deviceData.width,
                    height: deviceData.height,
                    fontSize: deviceData.fontSize,
                    textMaxWidth: deviceData.textMaxWidth,
                    padding: deviceData.padding
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
        const floorId = NO_FLOOR_NODE_ID;
        const areaId = 'area-unassigned';

        const hasNoFloorNode = elements.some((element) => element?.group === 'nodes' && element?.data?.id === floorId);
        if (!hasNoFloorNode) {
            elements.push({
                group: 'nodes',
                data: {
                    id: floorId,
                    label: 'No Floor',
                    type: 'floor',
                    level: -10000,
                    transparentBackground: hasBackground ? 'true' : 'false',
                    hideOutline: hasBackground && !isLayoutEditable ? 'true' : 'false'
                }
            });
        }

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
            const typeIconKey = device.type ? `img/devices/${encodeURIComponent(device.type)}.svg` : 'img/devices/generic.svg';
            const typeIconSvg = _deviceIconCache[typeIconKey] || null;
            const uploadedImageUrl = embeddedDeviceImages.get(String(device.id || '').trim()) || '';
            const savedSize = resolveDeviceSize(device.id);
            const deviceSize = resolveAutoDeviceSize({
                label: deviceLabel,
                storageLabel,
                hasMedia: Boolean(uploadedImageUrl || (showIcons && typeIconSvg)),
                savedSize
            });
            applyDeviceSizeData(deviceData, deviceSize);
            deviceData.rotation = resolveDeviceRotation(device.id) ?? 0;
            deviceData.cardLabel = deviceLabel;
            deviceData.cardStatus = device.status || '';
            deviceData.cardStorageLabel = storageLabel || '';
            deviceData.cardIconSvgContent = showIcons ? (typeIconSvg || '') : '';
            deviceData.cardImageUrl = uploadedImageUrl;
            deviceData.cardSvgRotation = deviceData.rotation;
            deviceData.cardSvgTargetRotation = deviceData.rotation;
            deviceData.cardSvgSignature = '';
            deviceData.cardSvgTargetSignature = '';
            deviceData.cardSvg = buildDeviceCardSvg({
                label: deviceLabel,
                status: device.status,
                storageLabel,
                rotation: deviceData.rotation,
                iconSvgContent: showIcons ? typeIconSvg : null,
                imageHref: uploadedImageUrl,
                width: deviceData.width,
                height: deviceData.height,
                fontSize: deviceData.fontSize,
                textMaxWidth: deviceData.textMaxWidth,
                padding: deviceData.padding
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
    
    // Add Internet provider clouds attached to their gateway devices. Clouds
    // with a user-saved position keep it; the rest auto-follow their gateway.
    const showInternet = Boolean(document.getElementById('diagram-show-internet')?.checked ?? true);
    if (showInternet) {
        buildIspDiagramElements(filteredDevicesList).forEach((element) => {
            if (element.group === 'nodes') {
                const resolved = resolveSavedPosition(element.data.id, null);
                if (resolved) {
                    element.position = resolved;
                    element.data.hasSavedPosition = 'true';
                } else if (backgroundNormalizedPositions.has(element.data.id)) {
                    // Normalized position captured by the resolver; applied after layout.
                    element.data.hasSavedPosition = 'true';
                }
            }
            elements.push(element);
        });
    }

    // Add edges for connections
    const processedConnections = new Set();

    // Ethernet edges keyed by device pair, so the port-chip pass can attach each
    // edge end to the exact chip it should land on.
    const ethernetPairEdges = new Map();

    // Device positions/sizes as already placed above. devicePositionById is used
    // to decide which card edge (top/bottom) each port chip sits on; the registry
    // keeps the node element so the chip pass can widen it and redraw its card.
    const devicePositionById = new Map();
    const deviceRenderRegistry = new Map();
    elements.forEach((element) => {
        if (element.group === 'nodes' && element.data && element.data.type === 'device' && element.position) {
            const id = String(element.data.id);
            devicePositionById.set(id, {
                x: element.position.x,
                y: element.position.y,
                width: Number(element.data.width) || DEVICE_BASE_METRICS.width,
                height: Number(element.data.height) || DEVICE_BASE_METRICS.height
            });
            deviceRenderRegistry.set(id, element);
        }
    });

    filteredDevicesList.forEach(device => {
        if (!device.ports || !Array.isArray(device.ports)) return;
        
        device.ports.forEach(port => {
            if (!port.connectedTo) return;
            
            // Check if connected device is in filtered list
            if (!filteredDevicesList.find(d => d.id === port.connectedTo)) return;
            
            // Determine connection type
            let connectionType;
            let show;

            if (port.type.startsWith('ethernet')) {
                connectionType = 'ethernet';
                show = showEthernet;
            } else if (port.type.startsWith('sfp')) {
                // SFP/SFP+ are wired network links, so they share the Ethernet layer
                connectionType = 'ethernet';
                show = showEthernet;
            } else if (port.type.startsWith('hdmi')) {
                connectionType = 'hdmi';
                show = showHdmi;
            } else if (port.type.startsWith('usb')) {
                connectionType = 'usb';
                show = showUsb;
            } else if (port.type.startsWith('power')) {
                connectionType = 'power';
                show = showPower;
            }

            // Create unique connection ID per device pair and type, so the mirrored
            // port collapses but distinct connection types between the same pair don't
            const connectionId = `${[device.id, port.connectedTo].sort().join('-')}-${connectionType}`;
            if (processedConnections.has(connectionId)) return;
            processedConnections.add(connectionId);
            
            if (show) {
                let label = '';
                if (connectionType === 'ethernet') {
                    const meta = getEthernetConnectionMeta(device, port, filteredDevicesList);
                    label = formatEthernetLabel(meta);
                } else if (connectionType === 'hdmi') {
                    label = 'HDMI';
                } else if (connectionType === 'usb') {
                    label = 'USB';
                } else if (connectionType === 'power') {
                    label = getPowerConnectionLabel(device, port, filteredDevicesList);
                }

                // Determine arrow direction based on port type
                // Input ports: arrow points TO this device (receives data/power)
                // Output ports: arrow points FROM this device (sends data/power)
                // Input/Output ports: arrows on both ends (bidirectional)
                const isBidirectionalPort = port.type.endsWith('-io');
                const isInputPort = !isBidirectionalPort && port.type.includes('input');
                const sourceId = isInputPort ? port.connectedTo : device.id;
                const targetId = isInputPort ? device.id : port.connectedTo;

                const edgeEl = {
                    group: 'edges',
                    data: {
                        id: `${device.id}-${port.connectedTo}-${port.type}`,
                        source: sourceId,
                        target: targetId,
                        connectionType: connectionType,
                        label: label,
                        bidirectional: isBidirectionalPort
                    }
                };
                elements.push(edgeEl);
                if (connectionType === 'ethernet') {
                    // Endpoint properties can't be data()-mapped, so the chip pass
                    // sets them as an inline per-edge style. Keyed by the sorted
                    // device pair so each device can attach its end to the right chip.
                    edgeEl.style = {};
                    ethernetPairEdges.set(
                        [String(device.id), String(port.connectedTo)].sort().join('|'),
                        edgeEl
                    );
                }
            }
        });
    });

    // Layout of every device that grew chip bands, so non-ethernet edges can be
    // re-clipped to the card body (not the band) once all edges exist.
    const chipLayoutsByDevice = new Map();
    applyPortSpeedChips({
        filteredDevicesList,
        devicePositionById,
        deviceRenderRegistry,
        ethernetPairEdges,
        chipLayoutsByDevice,
        showEthernet
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

    if (showBluetooth) {
        const processedBluetoothConnections = new Set();
        filteredDevicesList.forEach((device) => {
            const bluetoothProxyId = String(device.bluetoothProxyId || '').trim();
            if (!bluetoothProxyId || bluetoothProxyId === String(device.id || '')) return;
            if (!isBluetoothConnectionDevice(device)) return;

            const bluetoothProxy = filteredDevicesList.find((item) => item.id === bluetoothProxyId);
            if (!isBluetoothParentDiagramDevice(bluetoothProxy)) return;

            const connectionId = [String(device.id || ''), bluetoothProxyId].sort().join('-bluetooth-');
            if (processedBluetoothConnections.has(connectionId)) return;
            processedBluetoothConnections.add(connectionId);

            elements.push({
                group: 'edges',
                data: {
                    id: `bluetooth-${connectionId}`,
                    source: String(device.id || ''),
                    target: bluetoothProxyId,
                    connectionType: 'bluetooth',
                    label: ''
                }
            });
        });
    }

    // Color devices and their links by network (VLAN) when enabled. Done as a
    // single post-pass so every edge-building block above stays untouched: same
    // VLAN on both ends -> tint the link; different VLANs -> flag it cross-VLAN.
    const colorByNetwork = Boolean(document.getElementById('diagram-color-by-network')?.checked);
    if (colorByNetwork) {
        const networkColorMap = buildNetworkColorMap(networks);
        const deviceNetworkById = new Map(
            devices.map(device => [String(device.id || ''), String(device.networkId || '').trim()])
        );
        elements.forEach((element) => {
            if (element.group === 'nodes' && element.data && element.data.type === 'device') {
                const netId = deviceNetworkById.get(String(element.data.id)) || '';
                const color = netId ? (networkColorMap.get(netId) || '') : '';
                if (color) element.data.networkColor = color;
            } else if (element.group === 'edges' && element.data) {
                const sourceNet = deviceNetworkById.get(String(element.data.source));
                const targetNet = deviceNetworkById.get(String(element.data.target));
                // Only device-to-device edges qualify; ISP/WAN endpoints are absent
                // from the map and skip both branches.
                if (sourceNet === undefined || targetNet === undefined) return;
                if (sourceNet && targetNet && sourceNet === targetNet) {
                    element.data.networkColor = networkColorMap.get(sourceNet) || '';
                } else if (sourceNet && targetNet && sourceNet !== targetNet) {
                    element.data.crossVlan = 'true';
                }
            }
        });
    } else {
        highlightedNetworkId = null;
    }

    // Keep non-ethernet arrows (power, USB, HDMI, wireless) landing on the card
    // body of chip-grown devices, not out on a speed chip.
    reclipEdgesAroundChips({ elements, chipLayoutsByDevice, devicePositionById });

    // Update cytoscape
    hideEmptyMapMessage();
    cy.elements().remove();
    cy.add(elements);
    positionIspNodes();
    renderNetworkLegend(colorByNetwork);
    applyNetworkHighlight();

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
    positionIspNodes();
    applyFilterDimming(matchedDeviceIds);
    reapplyDiagramAnalysis();
    if (hasLegacyAbsoluteBackgroundPositions && diagramBackgroundImageSize) {
        void migratePositionsToBackgroundNormalized(savedPositions);
    }
}

// Dim devices excluded by the active filters (highlight mode); pass null to clear
function applyFilterDimming(matchedIds) {
    if (!cy) return;
    cy.batch(() => {
        cy.nodes('node[type="device"]').forEach((node) => {
            node.toggleClass('filter-dimmed', matchedIds ? !matchedIds.has(node.id()) : false);
        });
        // ISP clouds follow their gateway's dimming state
        cy.nodes('node[type="internet"]').forEach((node) => {
            const gateway = cy.$id(String(node.data('gatewayId') || ''));
            const dimmed = Boolean(matchedIds) && (gateway.empty() || gateway.hasClass('filter-dimmed'));
            node.toggleClass('filter-dimmed', dimmed);
        });
        cy.edges().forEach((edge) => {
            const dimmed = edge.source().hasClass('filter-dimmed') || edge.target().hasClass('filter-dimmed');
            edge.toggleClass('filter-dimmed', dimmed);
        });
    });
}

// === Internet providers (ISP clouds) ===
// ISPs render as synthetic diagram-only nodes attached to their gateway device.
// They are never part of the devices store: no table/grid presence, no filters.

const ISP_NODE_ID_PREFIX = 'isp-node-';
const ISP_NODE_HEIGHT = 52;
const ISP_NODE_VERTICAL_GAP = 110;
// Eligible gateway types come from common.js (isIspGatewayEligibleDevice) so the
// diagram, Settings and the device form never disagree on what can be a gateway.
// A modem/ONT terminates the ISP line itself, so it outranks a router when
// auto-detecting the gateway even though it has far fewer connected ports.
const ISP_DEMARCATION_TYPES = new Set(['modems', 'modems-ont']);

function getIspByNodeId(nodeId) {
    const ispId = String(nodeId || '').slice(ISP_NODE_ID_PREFIX.length);
    return isps.find(isp => isp && isp.id === ispId) || null;
}

function countConnectedPorts(device) {
    if (!Array.isArray(device?.ports)) return 0;
    return device.ports.filter(port => port && port.connectedTo).length;
}

function normalizeDeviceType(device) {
    return typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(device?.type)
        : String(device?.type || '').trim().toLowerCase();
}

// True when the device is the box where the ISP line physically lands, so the
// WAN edge represents the last mile itself and not a patch cable behind it.
function isIspDemarcationDevice(device) {
    return ISP_DEMARCATION_TYPES.has(normalizeDeviceType(device));
}

// Explicit gateway wins; otherwise fall back to a modem/ONT, then to the
// most-connected router.
function resolveIspGatewayDevice(isp, devicesList) {
    const explicitId = String(isp?.gatewayDeviceId || '').trim();
    if (explicitId) {
        return { device: devicesList.find(d => d.id === explicitId) || null, auto: false };
    }
    const candidates = devicesList.filter(device => isIspGatewayEligibleDevice(device));
    if (!candidates.length) {
        return { device: null, auto: true };
    }
    candidates.sort((a, b) => {
        const demarcationDelta = Number(isIspDemarcationDevice(b)) - Number(isIspDemarcationDevice(a));
        if (demarcationDelta) return demarcationDelta;
        return countConnectedPorts(b) - countConnectedPorts(a);
    });
    return { device: candidates[0], auto: true };
}

function formatIspSpeedValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// The cloud card only carries the technology; link speed belongs on the WAN
// edge, like cable speed does on ethernet edges.
function buildIspSubtitle(isp) {
    return typeof getIspTechnologyLabel === 'function' ? getIspTechnologyLabel(isp.technology) : '';
}

// Physical medium of each last mile. Only shown when the WAN edge lands on a
// modem/ONT: with a plain router the edge may be skipping an unmodeled ONT, and
// the cable actually plugged into that router would be Ethernet, not fiber.
const ISP_LAST_MILE_MEDIUM = {
    fiber: 'Fiber',
    cable: 'Coax',
    dsl: 'Phone line'
};

function getIspLastMileMedium(isp, gateway) {
    if (!isIspDemarcationDevice(gateway)) return '';
    return ISP_LAST_MILE_MEDIUM[String(isp?.technology || '').trim().toLowerCase()] || '';
}

function formatWanLabel(isp, gateway) {
    const download = formatIspSpeedValue(isp.downloadSpeed);
    const upload = formatIspSpeedValue(isp.uploadSpeed);
    let speedLabel = '';
    if (download && upload) {
        speedLabel = `${download}/${upload} Mbps`;
    } else if (download) {
        speedLabel = `${download} Mbps`;
    } else if (upload) {
        speedLabel = `${upload} Mbps up`;
    }
    const base = getIspLastMileMedium(isp, gateway) || 'WAN';
    return speedLabel ? `${base} (${speedLabel})` : base;
}

function getIspIconSvgContent(technology) {
    const normalized = String(technology || '').trim().toLowerCase();
    if (normalized === '4g-5g' || normalized === 'fixed-wireless') {
        return '<path d="M12 20v-7"></path><path d="M9.2 10.2a4 4 0 0 1 5.6 0"></path><path d="M6.7 7.7a7.5 7.5 0 0 1 10.6 0"></path><circle cx="12" cy="13" r="0.6" fill="currentColor"></circle>';
    }
    if (normalized === 'satellite') {
        return '<path d="M5.5 9.5a9 9 0 0 0 9 9l3.2-3.2a9 9 0 0 0-9-9z"></path><path d="M12.5 16.5 15 19"></path><path d="M9 6l9 9"></path>';
    }
    return '<path d="M7.5 17.5a4 4 0 1 1 .7-7.95A5.5 5.5 0 0 1 18.9 11a3.5 3.5 0 0 1 -1.4 6.5z"></path>';
}

function buildIspCardSvg({ name, subtitle, technology, width, height }) {
    const safeName = escapeSvgText(name);
    const safeSubtitle = escapeSvgText(subtitle || '');
    const radius = (height / 2) - 1;
    const iconSize = 20;
    const iconX = 15;
    const iconY = (height - iconSize) / 2;
    const textX = iconX + iconSize + 9;
    const nameY = safeSubtitle ? height / 2 - 6 : height / 2;
    const subtitleY = height / 2 + 11;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius}" ry="${radius}" fill="#17191f" stroke="#2b303b" stroke-width="1.5" stroke-dasharray="5 4"/>
    <g transform="translate(${iconX}, ${iconY}) scale(${iconSize / 24})" fill="none" stroke="#b0b6c2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${getIspIconSvgContent(technology)}</g>
    <text x="${textX}" y="${nameY}" fill="#f4f5f7" font-family="Lato, 'Helvetica Neue', Arial, sans-serif" font-size="12.5" font-weight="700" dominant-baseline="central">${safeName}</text>
    ${safeSubtitle ? `<text x="${textX}" y="${subtitleY}" fill="#7e8595" font-family="Lato, 'Helvetica Neue', Arial, sans-serif" font-size="10" dominant-baseline="central">${safeSubtitle}</text>` : ''}
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildIspDiagramElements(devicesList) {
    const ispElements = [];
    if (!Array.isArray(isps) || !isps.length) return ispElements;
    isps.forEach((isp) => {
        if (!isp || !isp.id) return;
        const { device: gateway, auto } = resolveIspGatewayDevice(isp, devicesList);
        if (!gateway) return;
        const name = String(isp.name || 'Internet').trim() || 'Internet';
        const displayName = name.length > 22 ? `${name.slice(0, 21)}…` : name;
        let subtitle = buildIspSubtitle(isp);
        if (subtitle.length > 30) subtitle = `${subtitle.slice(0, 29)}…`;
        const textUnits = Math.max(displayName.length * 7, subtitle.length * 5.4);
        const width = Math.round(clampNumber(62 + textUnits, 132, 250));
        const nodeId = `${ISP_NODE_ID_PREFIX}${isp.id}`;
        ispElements.push({
            group: 'nodes',
            data: {
                id: nodeId,
                type: 'internet',
                label: name,
                ispId: isp.id,
                gatewayId: gateway.id,
                gatewayAuto: auto ? 'true' : 'false',
                width: width,
                height: ISP_NODE_HEIGHT,
                cardSvg: buildIspCardSvg({
                    name: displayName,
                    subtitle,
                    technology: isp.technology,
                    width,
                    height: ISP_NODE_HEIGHT
                })
            },
            selectable: false,
            grabbable: false
        });
        ispElements.push({
            group: 'edges',
            data: {
                id: `wan-${isp.id}`,
                source: nodeId,
                target: gateway.id,
                connectionType: 'wan',
                medium: isWirelessIspTechnology(isp.technology) ? 'wireless' : 'wired',
                label: formatWanLabel(isp, gateway)
            }
        });
    });
    return ispElements;
}

// Keep each cloud floating above its gateway; clouds sharing a gateway spread
// out. Clouds the user positioned by hand (saved or dragged) are left alone.
function positionIspNodes() {
    if (!cy) return;
    const ispNodes = cy.nodes('node[type="internet"]').filter((node) => node.data('hasSavedPosition') !== 'true');
    if (!ispNodes.length) return;
    const groups = new Map();
    ispNodes.forEach((node) => {
        const gatewayId = String(node.data('gatewayId') || '');
        if (!groups.has(gatewayId)) groups.set(gatewayId, []);
        groups.get(gatewayId).push(node);
    });
    groups.forEach((nodes, gatewayId) => {
        const gateway = cy.$id(gatewayId);
        if (gateway.empty()) return;
        const gatewayPosition = gateway.position();
        const gatewayHeight = gateway.height() || 0;
        let xCursor = 0;
        const totalWidth = nodes.reduce((sum, node) => sum + (node.data('width') || 0), 0) + (nodes.length - 1) * 30;
        nodes.forEach((node) => {
            const nodeWidth = node.data('width') || 0;
            const x = gatewayPosition.x - totalWidth / 2 + xCursor + nodeWidth / 2;
            node.position({
                x: x,
                y: gatewayPosition.y - gatewayHeight / 2 - ISP_NODE_VERTICAL_GAP
            });
            xCursor += nodeWidth + 30;
        });
    });
}

function repositionIspNodesForGateway(gatewayId) {
    if (!cy || !gatewayId) return;
    const hasClouds = cy.nodes('node[type="internet"]').some((node) => String(node.data('gatewayId') || '') === gatewayId);
    if (hasClouds) positionIspNodes();
}

// === Diagram analysis: trace path & failure simulation ===
// Both features operate on the connections currently visible on the diagram
// (hidden connection layers and filtered-out devices are not traversed).

// Bluetooth is deliberately absent: a proxy link carries telemetry, not the
// device's path to the internet, so losing it is not an upstream outage.
const NETWORK_ANALYSIS_CONNECTION_TYPES = new Set(['ethernet', 'usb', 'wifi', 'zigbee', 'zwave', 'wan']);
// Wireless edges point child -> parent, unlike wired ones. Bluetooth is listed
// so the orientation still reads correctly if it ever joins the analysis set.
const WIRELESS_CONNECTION_TYPES = new Set(['wifi', 'zigbee', 'zwave', 'bluetooth']);

function isNetworkAnalysisEdge(edge) {
    return NETWORK_ANALYSIS_CONNECTION_TYPES.has(String(edge.data('connectionType') || ''));
}

// Upstream = toward the network root (router/coordinator). Wireless edges point
// device -> parent, while wired edges point provider -> consumer, so the upstream
// neighbor is the source of an incoming wired edge. Bidirectional "-io" wired
// edges are ambiguous and treated as undirected unless includeBidirectional is false.
function getUpstreamNetworkLinks(nodeId, options = {}) {
    const includeBidirectional = options.includeBidirectional !== false;
    const includeWan = options.includeWan !== false;
    const links = [];
    if (!cy) return links;
    cy.$id(nodeId).connectedEdges().forEach((edge) => {
        if (!isNetworkAnalysisEdge(edge)) return;
        const type = String(edge.data('connectionType') || '');
        if (!includeWan && type === 'wan') return;
        const source = edge.data('source');
        const target = edge.data('target');
        if (WIRELESS_CONNECTION_TYPES.has(type)) {
            if (source === nodeId) links.push({ id: target, edge });
        } else if (edge.data('bidirectional')) {
            if (includeBidirectional) links.push({ id: source === nodeId ? target : source, edge });
        } else if (target === nodeId) {
            links.push({ id: source, edge });
        }
    });
    return links;
}

// Undirected BFS over the visible network edges from the given start nodes,
// returning the set of reachable node ids. blockedIds are treated as removed.
function collectReachableDeviceIds(startIds, options = {}) {
    const includeWan = options.includeWan !== false;
    const blockedIds = options.blockedIds || new Set();
    const reachable = new Set();
    const queue = [];
    startIds.forEach((id) => {
        if (blockedIds.has(id)) return;
        reachable.add(id);
        queue.push(id);
    });
    while (queue.length) {
        const currentId = queue.shift();
        cy.$id(currentId).connectedEdges().forEach((edge) => {
            const type = String(edge.data('connectionType') || '');
            if (!NETWORK_ANALYSIS_CONNECTION_TYPES.has(type)) return;
            if (!includeWan && type === 'wan') return;
            const otherId = edge.data('source') === currentId ? edge.data('target') : edge.data('source');
            if (reachable.has(otherId) || blockedIds.has(otherId)) return;
            const otherNode = cy.$id(otherId);
            if (otherNode.empty()) return;
            const otherType = otherNode.data('type');
            if (otherType !== 'device' && otherType !== 'internet') return;
            reachable.add(otherId);
            queue.push(otherId);
        });
    }
    return reachable;
}

// Highlight the full upstream chain from a device to its network root(s),
// dimming everything else. BFS with a visited set guards against cycles.
function traceDevicePath(deviceId) {
    if (!cy || cy.$id(deviceId).empty()) return;
    clearFailureSimulation({ updateBanner: false });
    traceFlowDirections.clear();
    const pathNodeIds = new Set([deviceId]);
    const pathEdgeIds = new Set();
    const queue = [deviceId];
    while (queue.length) {
        const currentId = queue.shift();
        getUpstreamNetworkLinks(currentId).forEach((link) => {
            pathEdgeIds.add(link.edge.id());
            if (!traceFlowDirections.has(link.edge.id())) {
                // Animation flow direction: currentId is the downstream end of
                // this link, so edges whose source is downstream animate
                // source -> target (negative dash-offset steps) and the rest
                // animate target -> source — always toward the network root.
                traceFlowDirections.set(link.edge.id(), link.edge.data('source') === currentId ? -1 : 1);
            }
            if (!pathNodeIds.has(link.id)) {
                pathNodeIds.add(link.id);
                queue.push(link.id);
            }
        });
    }
    tracedDeviceId = deviceId;
    cy.batch(() => {
        cy.nodes('node[type="device"], node[type="internet"]').forEach((node) => {
            const onPath = pathNodeIds.has(node.id());
            node.toggleClass('trace-path', onPath);
            node.toggleClass('trace-source', node.id() === deviceId);
            node.toggleClass('trace-dimmed', !onPath);
        });
        cy.edges().forEach((edge) => {
            const onPath = pathEdgeIds.has(edge.id());
            edge.toggleClass('trace-path', onPath);
            edge.toggleClass('trace-dimmed', !onPath);
        });
    });
    const device = devices.find(d => d.id === deviceId);
    const name = device ? (device.name || device.model || 'Unnamed Device') : 'device';
    const upstreamCount = pathNodeIds.size - 1;
    showAnalysisBanner('trace', upstreamCount > 0
        ? `Tracing path for ${name} — ${upstreamCount} upstream device${upstreamCount === 1 ? '' : 's'}`
        : `${name} has no visible upstream connections`);
    syncTraceFlowAnimation();
}

function clearTracePath(options = {}) {
    tracedDeviceId = null;
    traceFlowDirections.clear();
    syncTraceFlowAnimation();
    if (cy) {
        cy.elements().removeClass('trace-path trace-source trace-dimmed');
    }
    if (options.updateBanner !== false) {
        hideAnalysisBanner('trace');
    }
}

// === Trace flow animation ===
// While a trace is active, the highlighted edges switch to a dashed pattern
// (edge.trace-path.trace-flow) and their line-dash-offset advances so the
// dashes "flow" from the traced device toward the network root. Any style
// change makes Cytoscape repaint the whole canvas, so instead of updating on
// every animation frame the offset advances in discrete marching-ants steps
// every TRACE_FLOW_STEP_MS — visually identical, a fraction of the repaints.

const TRACE_FLOW_STEP_MS = 55;
const TRACE_FLOW_STEP_PX = 3;
const TRACE_FLOW_PERIOD_PX = 18; // dash 12 + gap 6, keeps the offset bounded
const TRACE_FLOW_REDUCED_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');

function traceFlowFrame(timestamp) {
    if (!cy || !traceFlowDirections.size) {
        traceFlowRaf = null;
        return;
    }
    traceFlowRaf = requestAnimationFrame(traceFlowFrame);
    if (timestamp - traceFlowLastStep < TRACE_FLOW_STEP_MS) return;
    traceFlowLastStep = timestamp;
    traceFlowOffset = (traceFlowOffset + TRACE_FLOW_STEP_PX) % TRACE_FLOW_PERIOD_PX;
    cy.batch(() => {
        traceFlowDirections.forEach((sign, edgeId) => {
            const edge = cy.$id(edgeId);
            // Decreasing line-dash-offset moves dashes source -> target; each
            // edge's sign (captured during the trace BFS) orients the flow.
            if (edge.nonempty()) edge.style('line-dash-offset', sign * traceFlowOffset);
        });
    });
}

// Single source of truth for whether the flow animation should be running:
// an active trace, the Diagram tab shown, the browser tab visible and no
// reduced-motion preference. Starts or stops the loop to match; stopping
// removes the dash overrides so the highlight falls back to the solid style.
function syncTraceFlowAnimation() {
    const shouldAnimate = Boolean(cy)
        && traceFlowDirections.size > 0
        && isDiagramVisible
        && !document.hidden
        && !TRACE_FLOW_REDUCED_MOTION_QUERY.matches;
    if (shouldAnimate) {
        cy.batch(() => {
            // Drop leftovers from a previous trace (re-trace without clearing)
            cy.edges('.trace-flow').forEach((edge) => {
                if (!traceFlowDirections.has(edge.id())) {
                    edge.removeClass('trace-flow');
                    edge.removeStyle('line-dash-offset');
                }
            });
            traceFlowDirections.forEach((_sign, edgeId) => {
                cy.$id(edgeId).addClass('trace-flow');
            });
        });
        if (traceFlowRaf === null) {
            traceFlowLastStep = 0;
            traceFlowRaf = requestAnimationFrame(traceFlowFrame);
        }
        return;
    }
    if (traceFlowRaf !== null) {
        cancelAnimationFrame(traceFlowRaf);
        traceFlowRaf = null;
    }
    if (cy) {
        cy.batch(() => {
            cy.edges('.trace-flow').forEach((edge) => {
                edge.removeClass('trace-flow');
                edge.removeStyle('line-dash-offset');
            });
        });
    }
}

function toggleSimulatedFailure(deviceId) {
    if (simulatedFailedDeviceIds.has(deviceId)) {
        simulatedFailedDeviceIds.delete(deviceId);
    } else {
        simulatedFailedDeviceIds.add(deviceId);
    }
    if (simulatedFailedDeviceIds.size) {
        applyFailureSimulation();
    } else {
        clearFailureSimulation();
    }
}

// Mark the simulated-failed devices/providers and recompute reachability from
// the network roots. Recomputing from the roots — instead of propagating
// downstream from the failed node — keeps devices with a redundant live path
// unaffected and handles cascading failures for free. Two tiers:
// - offline (red): no LAN path to a root anymore
// - no internet (orange): LAN still works, but no path to any live ISP cloud
function applyFailureSimulation() {
    if (!cy) return;
    clearTracePath({ updateBanner: false });
    Array.from(simulatedFailedDeviceIds).forEach((id) => {
        if (cy.$id(id).empty()) simulatedFailedDeviceIds.delete(id);
    });
    if (!simulatedFailedDeviceIds.size) {
        clearFailureSimulation();
        return;
    }

    // LAN roots: devices with no unambiguous upstream link over LAN connections
    // (WAN links to ISP clouds don't count — the LAN works without internet).
    const lanRootIds = [];
    cy.nodes('node[type="device"]').forEach((node) => {
        if (!getUpstreamNetworkLinks(node.id(), { includeBidirectional: false, includeWan: false }).length) {
            lanRootIds.push(node.id());
        }
    });

    const lanReachable = collectReachableDeviceIds(lanRootIds, {
        includeWan: false,
        blockedIds: simulatedFailedDeviceIds
    });

    const offlineIds = new Set();
    cy.nodes('node[type="device"]').forEach((node) => {
        const id = node.id();
        if (!simulatedFailedDeviceIds.has(id) && !lanReachable.has(id)) {
            offlineIds.add(id);
        }
    });

    // Internet tier: a device "loses internet" when it had a path to an ISP
    // cloud before the failures but not after. Devices that never had internet
    // (standalone sensors, isolated meshes) are left untouched.
    const ispNodes = cy.nodes('node[type="internet"]');
    const noInternetIds = new Set();
    if (ispNodes.length) {
        const allIspIds = ispNodes.map((node) => node.id());
        const liveIspIds = allIspIds.filter((id) => !simulatedFailedDeviceIds.has(id));
        const baselineInternet = collectReachableDeviceIds(allIspIds, { blockedIds: new Set() });
        const blocked = new Set([...simulatedFailedDeviceIds, ...offlineIds]);
        const currentInternet = collectReachableDeviceIds(liveIspIds, { blockedIds: blocked });
        baselineInternet.forEach((id) => {
            if (simulatedFailedDeviceIds.has(id) || offlineIds.has(id)) return;
            if (cy.$id(id).data('type') !== 'device') return;
            if (!currentInternet.has(id)) noInternetIds.add(id);
        });
    }

    const downIds = new Set([...simulatedFailedDeviceIds, ...offlineIds]);
    cy.batch(() => {
        cy.nodes('node[type="device"], node[type="internet"]').forEach((node) => {
            const id = node.id();
            node.toggleClass('sim-failed', simulatedFailedDeviceIds.has(id));
            node.toggleClass('sim-affected', offlineIds.has(id));
            node.toggleClass('sim-no-internet', noInternetIds.has(id));
        });
        cy.edges().forEach((edge) => {
            const dead = downIds.has(edge.data('source')) || downIds.has(edge.data('target'));
            edge.toggleClass('sim-dead', dead);
        });
    });

    let subject;
    if (simulatedFailedDeviceIds.size === 1) {
        const failedId = simulatedFailedDeviceIds.values().next().value;
        subject = `Simulating failure of ${String(cy.$id(failedId).data('label') || 'device')}`;
    } else {
        subject = `Simulating ${simulatedFailedDeviceIds.size} failures`;
    }
    const impactParts = [];
    if (offlineIds.size) {
        impactParts.push(`${offlineIds.size} device${offlineIds.size === 1 ? '' : 's'} offline`);
    }
    if (noInternetIds.size) {
        impactParts.push(`${noInternetIds.size} without internet`);
    }
    const impact = impactParts.length ? impactParts.join(' · ') : 'no other devices affected';
    showAnalysisBanner('failure', `${subject} — ${impact}`);
}

function clearFailureSimulation(options = {}) {
    simulatedFailedDeviceIds.clear();
    if (cy) {
        cy.elements().removeClass('sim-failed sim-affected sim-no-internet sim-dead');
    }
    if (options.updateBanner !== false) {
        hideAnalysisBanner('failure');
    }
}

function clearDiagramAnalysis() {
    clearTracePath({ updateBanner: false });
    clearFailureSimulation({ updateBanner: false });
    hideAnalysisBanner();
}

// Re-render rebuilds all elements, dropping analysis classes; re-run any active
// analysis against the fresh graph (or drop it if its device disappeared).
function reapplyDiagramAnalysis() {
    if (!cy) return;
    if (tracedDeviceId) {
        const previousId = tracedDeviceId;
        if (cy.$id(previousId).empty()) {
            clearTracePath();
        } else {
            traceDevicePath(previousId);
        }
        return;
    }
    if (simulatedFailedDeviceIds.size) {
        applyFailureSimulation();
    }
}

function showAnalysisBanner(mode, text) {
    const banner = document.getElementById('map-analysis-banner');
    if (!banner) return;
    banner.hidden = false;
    banner.classList.toggle('is-trace', mode === 'trace');
    banner.classList.toggle('is-failure', mode === 'failure');
    const textEl = document.getElementById('map-analysis-text');
    if (textEl) textEl.textContent = text;
}

function hideAnalysisBanner(mode) {
    const banner = document.getElementById('map-analysis-banner');
    if (!banner || banner.hidden) return;
    if (mode && !banner.classList.contains(`is-${mode}`)) return;
    banner.hidden = true;
    banner.classList.remove('is-trace', 'is-failure');
}

function handleAnalysisEscape(event) {
    if (event.key !== 'Escape') return;
    // In fullscreen, Esc exits fullscreen first; the banner ✕ still works there.
    if (document.fullscreenElement || document.body.classList.contains('map-fullscreen')) return;
    if (!tracedDeviceId && !simulatedFailedDeviceIds.size) return;
    clearDiagramAnalysis();
}

// Short PoE labels for connection edges (mirror device-form's POE_STANDARD_OPTIONS)
const POE_SHORT = {
    'poe':       'PoE',
    'poe-plus':  'PoE+',
    'poe-pp-60': 'PoE++',
    'poe-pp-90': 'PoE++',
    'passive':   'Passive PoE'
};

function getEthernetConnectionMeta(device, port, devicesList) {
    const kind = String(port.type || '').split('-')[0];
    const meta = {
        kind: kind === 'sfp' || kind === 'sfpplus' ? kind : 'ethernet',
        cableType: port.cableType || '',
        speed: port.speed || '',
        poe: ''
    };
    const connectedDevice = devicesList.find(d => d.id === port.connectedTo);
    if (!connectedDevice || !connectedDevice.ports) {
        return meta;
    }
    const reversePort = (port.connectedToPort
            ? connectedDevice.ports.find(p => p && String(p.id || '') === String(port.connectedToPort))
            : null) ||
        connectedDevice.ports.find(p => p.connectedTo === device.id && p.type && p.type.startsWith(meta.kind === 'ethernet' ? 'ethernet' : 'sfp'));
    if (!reversePort) {
        return meta;
    }
    if (!meta.cableType && reversePort.cableType) {
        meta.cableType = reversePort.cableType;
    }
    // The link only ever runs as fast as its slower end, so the badge shows
    // whichever of the two port speeds is lower (not just whichever is set).
    const reverseSpeed = reversePort.speed || '';
    if (!meta.speed) {
        meta.speed = reverseSpeed;
    } else if (reverseSpeed) {
        const ownMbps = parseEthernetSpeedMbps(meta.speed);
        const otherMbps = parseEthernetSpeedMbps(reverseSpeed);
        if (ownMbps != null && otherMbps != null && otherMbps < ownMbps) {
            meta.speed = reverseSpeed;
        }
    }
    // PoE only applies to the link when one end provides power (PSE) and the
    // other end is powered (PD) — mismatched or missing roles mean no PoE
    const pseSide = port.poeRole === 'pse' && reversePort.poeRole === 'pd' ? port
        : (port.poeRole === 'pd' && reversePort.poeRole === 'pse' ? reversePort : null);
    if (pseSide) {
        const pdSide = pseSide === port ? reversePort : port;
        meta.poe = pseSide.poeStandard || pdSide.poeStandard || '';
    }
    return meta;
}

function formatCableTypeLabel(cableType) {
    return cableType.replace(/^cat/i, 'Cat');
}

// The label that rides on the link itself: cable type, the negotiated speed and
// PoE. The negotiated speed (the slower of the two ends) is a property of the
// link, so it belongs here — each end's own port speed is the chip drawn inside
// its device card.
function formatEthernetLabel(meta) {
    if (!meta) {
        return 'Ethernet';
    }
    const baseName = meta.kind === 'sfp' ? 'SFP' : (meta.kind === 'sfpplus' ? 'SFP+' : 'Ethernet');
    const cableLabel = meta.cableType ? formatCableTypeLabel(meta.cableType) : '';
    const speedLabel = formatPortSpeedLabel(meta);
    const poeLabel = meta.poe ? (POE_SHORT[meta.poe] || 'PoE') : '';
    return [cableLabel || baseName, speedLabel, poeLabel].filter(Boolean).join(' · ');
}

// Formats a stored speed ("1Gbps") for display ("1 Gbps"). Used both for the
// link's negotiated speed on the edge label and for a port's own speed chip.
function formatPortSpeedLabel(meta) {
    if (!meta || !meta.speed) {
        return '';
    }
    return String(meta.speed).replace(/([0-9])([A-Za-z])/, '$1 $2');
}

// Converts a stored network port speed (e.g. "1Gbps", "100Mbps") to Mbps so
// the two ends of a link can be compared. Returns null when unparseable.
function parseEthernetSpeedMbps(value) {
    const match = /^([\d.]+)\s*([GgMm])/.exec(String(value || '').trim());
    if (!match) {
        return null;
    }
    const num = parseFloat(match[1]);
    if (!Number.isFinite(num)) {
        return null;
    }
    return match[2].toLowerCase() === 'g' ? num * 1000 : num;
}

// Port speed chips are drawn as a row of small tabs on the top/bottom edge of
// the device card. These constants size a single chip.
const PORT_CHIP_HEIGHT = 14;
const PORT_CHIP_GAP = 5;
const PORT_CHIP_SIDE_MARGIN = 7;
const PORT_CHIP_FONT_SIZE = 7.5;

// Width a chip needs for its text (Lato bold ~7.5px ≈ 4.7px/char) plus padding.
function measurePortChipWidth(text) {
    return Math.round(clampNumber(String(text || '').length * 4.7 + 12, 30, 92));
}

// Lays out a device's port-speed chips as a row hugging the top edge (chips for
// links coming from above) and/or the bottom edge (links from below), widening
// the card so a crowded row never overlaps and adding a thin band above/below
// for the chips to sit in. Returns the grown node size, the card's offset/size
// inside it, and each chip's center in node-local SVG coordinates. Mutates the
// passed chip objects, setting cx/cy/w on each.
function computeDeviceChipLayout(baseWidth, baseHeight, topChips, bottomChips, chipWidth) {
    const chipH = PORT_CHIP_HEIGHT;
    const gap = PORT_CHIP_GAP;
    const band = chipH + gap;
    // A device with a lot of ports would otherwise grow unboundedly wide; cap the
    // card at the normal device max and shrink the chips to fit that busier side.
    const maxCard = DEVICE_SIZE_LIMITS.maxWidth;
    const maxPerSide = Math.max(topChips.length, bottomChips.length);
    if (maxPerSide > 0) {
        const fitWidth = Math.floor(
            (maxCard - 2 * PORT_CHIP_SIDE_MARGIN - (maxPerSide - 1) * gap) / maxPerSide
        );
        chipWidth = Math.max(30, Math.min(chipWidth, fitWidth));
    }
    const rowWidth = (arr) => arr.length
        ? arr.length * chipWidth + (arr.length - 1) * gap + 2 * PORT_CHIP_SIDE_MARGIN
        : 0;
    const cardWidth = clampNumber(
        Math.max(baseWidth, rowWidth(topChips), rowWidth(bottomChips)),
        DEVICE_SIZE_LIMITS.minWidth,
        maxCard
    );
    const topBand = topChips.length ? band : 0;
    const bottomBand = bottomChips.length ? band : 0;
    const cardHeight = baseHeight;
    const nodeWidth = cardWidth;
    const nodeHeight = topBand + cardHeight + bottomBand;
    const placeRow = (arr, cy) => {
        const total = arr.length * chipWidth + (arr.length - 1) * gap;
        const startX = (cardWidth - total) / 2;
        arr.forEach((chip, index) => {
            chip.w = chipWidth;
            chip.cx = startX + index * (chipWidth + gap) + chipWidth / 2;
            chip.cy = cy;
        });
    };
    placeRow(topChips, chipH / 2);
    placeRow(bottomChips, nodeHeight - chipH / 2);
    return {
        nodeWidth,
        nodeHeight,
        cardY: topBand,
        cardWidth,
        cardHeight,
        chipHeight: chipH,
        chips: [...topChips, ...bottomChips]
    };
}

// A network (RJ45/SFP) data port is the only kind that carries a link speed and
// therefore gets a chip.
function isNetworkPortTypeForChip(type) {
    const t = String(type || '');
    return t.startsWith('ethernet') || t.startsWith('sfp');
}

// Draws every device's network ports as speed chips on its card: every chip
// shows that port's own speed, with the ethernet arrow landing on the chip for
// connected ports; empty ports show the same speed, muted, with no cable.
// The device card is widened and its edges reshaped in place, and each ethernet
// edge end is re-pointed at the chip it belongs to. Runs only while the Ethernet
// layer is visible.
// Computes a device's port chips and which card edge (top/bottom) each sits on,
// from live geometry: a connected chip faces its peer (top if the peer is above,
// bottom if below) so the link runs straight into it; empty ports go on top. The
// bottom edge is reserved (all chips forced up) when a wired non-ethernet line
// reaches this device from below. `getPos(id)` returns a device's map center
// ({x,y}) or null; `isVisible(id)` says whether a peer is drawn on the map.
// Returns { topChips, bottomChips, allChips } or null when the device has no
// network ports. Shared by the full render and the live drag recompute.
function buildDeviceChipList(device, getPos, isVisible) {
    const dpos = getPos(device.id);
    if (!dpos) return null;
    const ports = Array.isArray(device.ports) ? device.ports : [];
    const networkPorts = ports.filter((port) => port && isNetworkPortTypeForChip(port.type));
    if (!networkPorts.length) return null;

    const reserveBottom = ports.some((port) => {
        if (!port || !port.connectedTo) return false;
        const t = String(port.type || '');
        if (!(t.startsWith('power') || t.startsWith('usb') || t.startsWith('hdmi'))) return false;
        const opos = getPos(port.connectedTo);
        return opos && opos.y > dpos.y + 1;
    });

    const chips = networkPorts.map((port) => {
        const connectedId = String(port.connectedTo || '');
        if (connectedId && isVisible(connectedId)) {
            const opos = getPos(connectedId);
            const peerBelow = Boolean(opos && opos.y > dpos.y + 1);
            return {
                // The chip describes this device's own port, so it always shows
                // that port's speed — not the link's negotiated speed (which is
                // the slower of the two ends and belongs on the edge label).
                text: formatPortSpeedLabel({ speed: port.speed }) || '—',
                connected: true,
                otherId: connectedId,
                otherX: opos ? opos.x : dpos.x,
                side: !reserveBottom && peerBelow ? 'bottom' : 'top'
            };
        }
        // No connection (or the peer is not on the map): a present-but-unused port.
        return {
            text: formatPortSpeedLabel({ speed: port.speed }) || '—',
            connected: false,
            otherId: '',
            otherX: dpos.x,
            side: 'top'
        };
    });

    // Connected chips first (sorted by the peer's x to reduce crossings), then
    // empty ports trailing on the right.
    const bySide = (side) => chips
        .filter((c) => c.side === side)
        .sort((a, b) => (a.connected === b.connected ? a.otherX - b.otherX : (a.connected ? -1 : 1)));
    return { topChips: bySide('top'), bottomChips: bySide('bottom'), allChips: chips };
}

// A stable signature of a device's chip layout, so a live recompute can skip the
// (expensive) card SVG rebuild when nothing about the chips actually changed.
function portChipSignature(allChips) {
    return allChips.map((c) => `${c.side}:${c.text}`).join('|');
}

function applyPortSpeedChips({ filteredDevicesList, devicePositionById, deviceRenderRegistry, ethernetPairEdges, chipLayoutsByDevice, showEthernet }) {
    if (!showEthernet) return;

    const visibleSet = new Set(filteredDevicesList.map((d) => String(d.id)));
    const getPos = (id) => devicePositionById.get(String(id)) || null;
    const isVisible = (id) => visibleSet.has(String(id));

    filteredDevicesList.forEach((device) => {
        const deviceId = String(device.id || '');
        const element = deviceRenderRegistry.get(deviceId);
        if (!element) return;
        // Rotated cards use a rotated SVG frame that the axis-aligned chip
        // endpoints can't follow, so they keep the plain (chip-less) card.
        if (normalizeDeviceRotation(element.data.rotation || 0) !== 0) return;

        const lists = buildDeviceChipList(device, getPos, isVisible);
        if (!lists) return;
        const { topChips, bottomChips, allChips } = lists;

        const chipWidth = Math.max(...allChips.map((c) => measurePortChipWidth(c.text)));
        const baseWidth = Number(element.data.width) || DEVICE_BASE_METRICS.width;
        const baseHeight = Number(element.data.height) || DEVICE_BASE_METRICS.height;
        const layout = computeDeviceChipLayout(baseWidth, baseHeight, topChips, bottomChips, chipWidth);

        // Grow the node to the banded size and redraw its card with the chips.
        // Keep the pre-chip base so save/serialize never bakes the bands in.
        element.data.chipBaseWidth = baseWidth;
        element.data.chipBaseHeight = baseHeight;
        element.data.width = layout.nodeWidth;
        element.data.height = layout.nodeHeight;
        element.data.cardChipLayout = layout;
        element.data.chipLayoutSig = portChipSignature(allChips);
        if (chipLayoutsByDevice) {
            chipLayoutsByDevice.set(deviceId, {
                nodeWidth: layout.nodeWidth,
                nodeHeight: layout.nodeHeight,
                cardWidth: layout.cardWidth,
                cardHeight: layout.cardHeight,
                cardY: layout.cardY
            });
        }
        element.data.cardSvgSignature = '';
        element.data.cardSvgTargetSignature = '';
        element.data.cardSvg = buildDeviceCardSvg({
            label: element.data.cardLabel || element.data.label,
            status: element.data.cardStatus || element.data.status,
            storageLabel: element.data.cardStorageLabel || '',
            rotation: 0,
            iconSvgContent: element.data.cardIconSvgContent || null,
            imageHref: element.data.cardImageUrl || '',
            width: baseWidth,
            height: baseHeight,
            fontSize: element.data.fontSize,
            textMaxWidth: element.data.textMaxWidth,
            padding: element.data.padding,
            chipLayout: layout
        });

        // Re-point each connected chip's edge end at the chip via an inline
        // per-edge endpoint style (endpoint props are not data()-mappable).
        layout.chips.forEach((chip) => {
            if (!chip.connected || !chip.otherId) return;
            const edgeEl = ethernetPairEdges.get([deviceId, chip.otherId].sort().join('|'));
            if (!edgeEl) return;
            if (!edgeEl.style) edgeEl.style = {};
            const offX = (chip.cx - layout.nodeWidth / 2).toFixed(1);
            const offY = (chip.cy - layout.nodeHeight / 2).toFixed(1);
            const endpoint = `${offX}px ${offY}px`;
            if (String(edgeEl.data.source) === deviceId) {
                edgeEl.style['source-endpoint'] = endpoint;
            } else {
                edgeEl.style['target-endpoint'] = endpoint;
            }
        });
    });
}

// Endpoint (as an offset-from-node-center px string) where a line coming from
// `farWorld` should meet the card body of a chip-grown device, so the arrow ends
// on the card rectangle rather than out in the chip band.
function computeCardBoundaryEndpoint(farWorld, deviceWorld, layout) {
    const nodeCenterX = layout.nodeWidth / 2;
    const nodeCenterY = layout.nodeHeight / 2;
    // Card is horizontally centered in the node; vertically it sits below the top
    // band. Card center offset from node center is (0, cardY + cardHeight/2 - nodeH/2).
    const cardCenterOffsetY = layout.cardY + layout.cardHeight / 2 - nodeCenterY;
    const dx = farWorld.x - deviceWorld.x;
    const dy = farWorld.y - deviceWorld.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const halfW = layout.cardWidth / 2;
    const halfH = layout.cardHeight / 2;
    const t = Math.min(
        ux !== 0 ? halfW / Math.abs(ux) : Infinity,
        uy !== 0 ? halfH / Math.abs(uy) : Infinity
    );
    const offX = ux * t;
    const offY = cardCenterOffsetY + uy * t;
    return `${offX.toFixed(1)}px ${offY.toFixed(1)}px`;
}

// Non-ethernet edges (power, USB, HDMI, wireless) clip to the whole node box by
// default, which now includes the chip bands — so their arrows would land on a
// chip and read as if plugged into a port. Re-point each such end that touches a
// chip-grown device at the card body instead. Only device–device ends are
// adjusted; ends at ISP/cloud nodes keep the default.
function reclipEdgesAroundChips({ elements, chipLayoutsByDevice, devicePositionById }) {
    if (!chipLayoutsByDevice || !chipLayoutsByDevice.size) return;
    elements.forEach((el) => {
        if (el.group !== 'edges' || !el.data) return;
        if (el.data.connectionType === 'ethernet') return;
        const sourceId = String(el.data.source);
        const targetId = String(el.data.target);
        const reEnd = (endId, farId, endKey) => {
            const layout = chipLayoutsByDevice.get(endId);
            if (!layout) return;
            const devPos = devicePositionById.get(endId);
            const farPos = devicePositionById.get(farId);
            if (!devPos || !farPos) return;
            if (!el.style) el.style = {};
            el.style[endKey] = computeCardBoundaryEndpoint(farPos, devPos, layout);
        };
        reEnd(sourceId, targetId, 'source-endpoint');
        reEnd(targetId, sourceId, 'target-endpoint');
    });
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

function isBluetoothConnectionDevice(device) {
    if (!device || typeof device !== 'object') {
        return false;
    }
    const rawConnectivity = device.connectivity;
    const normalized = typeof normalizeOptionValue === 'function'
        ? normalizeOptionValue(rawConnectivity)
        : String(rawConnectivity || '').trim().toLowerCase();
    // Custom connectivity options such as "Bluetooth LE" count as Bluetooth.
    return normalized.startsWith('bluetooth') || normalized === 'ble';
}

function isZigbeeParentDiagramDevice(device) {
    // A coordinator/router is a valid Zigbee parent regardless of its own
    // connectivity (USB/Ethernet/Wi-Fi), so only the role flags matter here.
    return Boolean(device && (device.zigbeeController || device.zigbeeRepeater));
}

function isZwaveParentDiagramDevice(device) {
    // A Z-Wave coordinator is a valid parent regardless of its own connectivity.
    return Boolean(device && device.zwaveController);
}

function isBluetoothParentDiagramDevice(device) {
    // A Bluetooth proxy relays for nearby devices no matter how it reaches the hub.
    return Boolean(device && device.bluetoothProxy);
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
    if (typeof formatDeviceStorageSummary === 'function') {
        return formatDeviceStorageSummary(device);
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
    if (normalized === 'pending') return '#f5a524';
    if (normalized === 'not-working') return '#f0383b';
    if (normalized === 'working') return '#38cc65';
    return '#006fff';
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
            current = '';
        }
        let remainingWord = word;
        while (remainingWord.length > maxChars) {
            lines.push(remainingWord.slice(0, maxChars));
            remainingWord = remainingWord.slice(maxChars);
        }
        current = remainingWord;
    });

    if (current) {
        lines.push(current);
    }

    const hasLimit = Number.isFinite(maxLines) && maxLines > 0;
    if (!hasLimit || lines.length <= maxLines) {
        return lines;
    }
    const trimmed = lines.slice(0, maxLines);
    const last = trimmed[maxLines - 1];
    if (last.length > 3) {
        trimmed[maxLines - 1] = `${last.slice(0, Math.max(1, last.length - 3))}...`;
    }
    return trimmed;
}

function buildDeviceCardSvg({ label, status, storageLabel, rotation, iconSvgContent, imageHref, width, height, fontSize, textMaxWidth, padding, chipLayout }) {
    // With a chipLayout the node grows a band above/below the card to hold the
    // port-speed chips; the card itself keeps its own (possibly widened) size and
    // is drawn offset down by the top band. Without one, node === card.
    const cardOuterWidth = chipLayout ? chipLayout.cardWidth : width;
    const cardOuterHeight = chipLayout ? chipLayout.cardHeight : height;
    const canvasWidth = chipLayout ? chipLayout.nodeWidth : clampNumber(Number(width), DEVICE_SIZE_LIMITS.minWidth, DEVICE_SIZE_LIMITS.maxWidth);
    const canvasHeight = chipLayout ? chipLayout.nodeHeight : clampNumber(Number(height), DEVICE_SIZE_LIMITS.minHeight, DEVICE_SIZE_LIMITS.maxHeight);
    const cardOffsetY = chipLayout ? chipLayout.cardY : 0;
    const safeWidth = clampNumber(Number(cardOuterWidth), DEVICE_SIZE_LIMITS.minWidth, DEVICE_SIZE_LIMITS.maxWidth);
    const safeHeight = clampNumber(Number(cardOuterHeight), DEVICE_SIZE_LIMITS.minHeight, DEVICE_SIZE_LIMITS.maxHeight);
    const statusColor = getDeviceStatusColor(status);
    const rx = 10;
    const safeFontSize = clampNumber(
        Number(fontSize),
        DEVICE_FONT_LIMITS.minFontSize,
        DEVICE_FONT_LIMITS.maxFontSize
    );
    const safePadding = clampNumber(
        Number(padding),
        DEVICE_FONT_LIMITS.minPadding,
        DEVICE_FONT_LIMITS.maxPadding
    );
    const hasImage = Boolean(String(imageHref || '').trim());
    const hasIcon = Boolean(iconSvgContent);
    const showMedia = hasImage || hasIcon;
    const mediaSize = showMedia ? clampNumber(safeHeight - safePadding * 2, 26, 42) : 0;
    const mediaX = safePadding + 2;
    const mediaY = Math.round((safeHeight - mediaSize) / 2);
    // Without media the label owns the whole card, so center it horizontally
    // instead of leaving it hugging the left edge.
    const textStartX = showMedia ? (mediaX + mediaSize + 8) : (safePadding + 4);
    const textAnchor = showMedia ? 'start' : 'middle';
    const textX = showMedia ? textStartX : Math.round(safeWidth / 2);
    const safeTextMaxWidth = clampNumber(
        Number(textMaxWidth) || (showMedia ? (safeWidth - textStartX - safePadding - 4) : (safeWidth - safePadding * 2 - 6)),
        50,
        Math.max(50, safeWidth - textStartX - safePadding - 4)
    );
    const lineHeight = safeFontSize * 1.25;
    const reservedBottom = storageLabel ? 24 : 0;
    const availableTextHeight = Math.max(lineHeight, safeHeight - safePadding * 2 - reservedBottom);
    const maxLines = Math.max(1, Math.floor(availableTextHeight / lineHeight));
    const lines = buildSvgTextLines(label, safeTextMaxWidth, safeFontSize, maxLines);
    const totalHeight = Math.min(availableTextHeight, lineHeight * lines.length);
    let startY = safePadding + safeFontSize + Math.max(0, (availableTextHeight - totalHeight) / 2);
    const angle = normalizeDeviceRotation(rotation || 0);
    const radians = (angle * Math.PI) / 180;
    const rotatedWidth = Math.abs(safeWidth * Math.cos(radians)) + Math.abs(safeHeight * Math.sin(radians));
    const rotatedHeight = Math.abs(safeWidth * Math.sin(radians)) + Math.abs(safeHeight * Math.cos(radians));
    const scale = angle
        ? Math.min(safeWidth / rotatedWidth, safeHeight / rotatedHeight, 1)
        : 1;
    const rotateTransform = angle
        ? `translate(${safeWidth / 2} ${safeHeight / 2}) rotate(${angle}) scale(${scale}) translate(${-safeWidth / 2} ${-safeHeight / 2})`
        : '';
    // Shift the whole card down by the top chip band (if any), then rotate.
    const groupTransform = (cardOffsetY || rotateTransform)
        ? `transform="translate(0 ${cardOffsetY})${rotateTransform ? ' ' + rotateTransform : ''}"`
        : '';

    const textMarkup = lines.map((line, index) => {
        const y = startY + index * lineHeight;
        return `<tspan x="${textX}" y="${y}">${escapeSvgText(line)}</tspan>`;
    }).join('');

    let storageMarkup = '';
    if (storageLabel) {
        // Size the badge to its label so longer labels (multiple disks, types) stay
        // readable, shrinking the font (and ellipsizing as a last resort) when the
        // label cannot fit the card at full size.
        let storageText = String(storageLabel);
        let storageFontSize = Math.max(9, safeFontSize - 2);
        const maxBadgeWidth = Math.max(56, safeWidth - 16);
        const badgeWidthFor = (text, size) => Math.ceil(text.length * size * 0.55) + 16;
        if (badgeWidthFor(storageText, storageFontSize) > maxBadgeWidth) {
            storageFontSize = Math.max(8, Math.floor((maxBadgeWidth - 16) / (storageText.length * 0.55)));
            if (badgeWidthFor(storageText, storageFontSize) > maxBadgeWidth) {
                const maxChars = Math.max(4, Math.floor((maxBadgeWidth - 16) / (storageFontSize * 0.55)) - 1);
                storageText = `${storageText.slice(0, maxChars)}…`;
            }
        }
        const badgeWidth = clampNumber(badgeWidthFor(storageText, storageFontSize), 56, maxBadgeWidth);
        const badgeHeight = clampNumber(Math.round(safeHeight * 0.28), 18, 24);
        const badgeX = safeWidth - badgeWidth - 6;
        const badgeY = safeHeight - badgeHeight - 6;
        const safeLabel = escapeSvgText(storageText);
        storageMarkup = [
            `<rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${Math.min(6, Math.round(badgeHeight / 2))}" ry="${Math.min(6, Math.round(badgeHeight / 2))}" fill="rgba(255,255,255,0.08)"/>`,
            `<text x="${badgeX + badgeWidth / 2}" y="${badgeY + badgeHeight / 2 + storageFontSize * 0.36}" text-anchor="middle" font-size="${storageFontSize}" font-family="'Lato', 'Helvetica Neue', Arial, sans-serif" fill="#b0b6c2">${safeLabel}</text>`
        ].join('');
    }

    let statusDotMarkup = '';
    if (status) {
        const dotX = safeWidth - 11;
        const dotY = 11;
        statusDotMarkup = [
            `<circle cx="${dotX}" cy="${dotY}" r="6" fill="${statusColor}" opacity="0.18"/>`,
            `<circle cx="${dotX}" cy="${dotY}" r="3" fill="${statusColor}"/>`
        ].join('');
    }

    let mediaMarkup = '';
    if (showMedia) {
        const mediaClipId = 'mediaClip';
        const mediaFrame = [
            `<rect x="${mediaX}" y="${mediaY}" width="${mediaSize}" height="${mediaSize}" rx="8" ry="8" fill="rgba(255,255,255,0.07)"/>`,
            `<clipPath id="${mediaClipId}"><rect x="${mediaX + 1}" y="${mediaY + 1}" width="${mediaSize - 2}" height="${mediaSize - 2}" rx="7" ry="7"/></clipPath>`
        ].join('');

        if (hasImage) {
            mediaMarkup = [
                mediaFrame,
                `<image href="${escapeSvgAttr(imageHref)}" x="${mediaX + 1}" y="${mediaY + 1}" width="${mediaSize - 2}" height="${mediaSize - 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${mediaClipId})"/>`
            ].join('');
        } else if (hasIcon) {
            const iconSize = 22;
            const ix = mediaX + Math.round((mediaSize - iconSize) / 2);
            const iy = mediaY + Math.round((mediaSize - iconSize) / 2);
            // Device type icons are drawn on a 48x48 grid as filled product art;
            // they carry their own <g stroke="none"> so nothing is stroked here.
            const iconScale = (iconSize / DEVICE_ICON_VIEWBOX).toFixed(4);
            mediaMarkup = [
                mediaFrame,
                `<g transform="translate(${ix},${iy}) scale(${iconScale})">${iconSvgContent}</g>`
            ].join('');
        }
    }

    const chipsMarkup = chipLayout ? buildPortChipsMarkup(chipLayout) : '';

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
        '<defs>',
        `<linearGradient id="cardBgGrad" x1="0" y1="0" x2="0" y2="${safeHeight}" gradientUnits="userSpaceOnUse">`,
        '<stop offset="0" stop-color="#293039"/>',
        '<stop offset="1" stop-color="#1a1e25"/>',
        '</linearGradient>',
        '<linearGradient id="chipGrad" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#293039"/>',
        '<stop offset="1" stop-color="#1a1e25"/>',
        '</linearGradient>',
        '</defs>',
        `<g ${groupTransform}>`,
        `<rect x="0.5" y="0.5" width="${safeWidth - 1}" height="${safeHeight - 1}" rx="${rx}" ry="${rx}" fill="url(#cardBgGrad)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`,
        `<path d="M ${rx} 1.5 H ${safeWidth - rx}" stroke="rgba(255,255,255,0.08)" stroke-width="1" fill="none"/>`,
        statusDotMarkup,
        mediaMarkup,
        `<text x="${textX}" y="${safeHeight / 2}" text-anchor="${textAnchor}" font-size="${safeFontSize}" font-weight="600" font-family="'Lato', 'Helvetica Neue', Arial, sans-serif" fill="#f4f5f7">${textMarkup}</text>`,
        storageMarkup,
        '</g>',
        chipsMarkup,
        '</svg>'
    ].join('');
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Draws the row(s) of port-speed chips as small tabs on the device card's top
// and/or bottom edge. Connected ports get a solid blue-bordered chip (the
// ethernet arrow lands on it); empty ports get a muted, dashed chip so it reads
// as "port present, nothing plugged in".
function buildPortChipsMarkup(chipLayout) {
    const chipH = chipLayout.chipHeight;
    const rx = 4;
    const fontSize = PORT_CHIP_FONT_SIZE;
    return chipLayout.chips.map((chip) => {
        const w = chip.w;
        const x = chip.cx - w / 2;
        const y = chip.cy - chipH / 2;
        const connected = chip.connected !== false;
        const stroke = connected ? 'rgba(0,111,255,0.55)' : 'rgba(255,255,255,0.14)';
        const dash = connected ? '' : ' stroke-dasharray="3 2"';
        const textFill = connected ? '#f4f5f7' : '#7e8595';
        const fillOpacity = connected ? '1' : '0.55';
        return [
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${chipH}" rx="${rx}" ry="${rx}" fill="url(#chipGrad)" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="1"${dash}/>`,
            `<text x="${chip.cx.toFixed(1)}" y="${(chip.cy + fontSize * 0.35).toFixed(1)}" text-anchor="middle" font-size="${fontSize}" font-weight="600" font-family="'Lato', 'Helvetica Neue', Arial, sans-serif" fill="${textFill}">${escapeSvgText(chip.text)}</text>`
        ].join('');
    }).join('');
}

function escapeSvgText(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeSvgAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
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
    // Persist only user-positioned ISP clouds; auto-positioned ones keep
    // following their gateway on every render.
    cy.nodes('[type="internet"]').forEach(node => {
        if (node.data('hasSavedPosition') !== 'true') {
            delete positions[node.id()];
            return;
        }
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
