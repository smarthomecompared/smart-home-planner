// Device Filters Module
// This module provides shared filtering functionality for devices

class DeviceFilters {
    constructor() {
        this.devices = [];
        this.areas = [];
        this.floors = [];
        this.settings = {};
        this.filteredDevices = [];
        this.onFilterChange = null; // Callback for when filters change
    }

    // Initialize with data
    init(devices, areas, floors, settings) {
        this.devices = devices;
        this.areas = areas;
        this.floors = floors;
        this.settings = settings;
        this.filteredDevices = devices; // Initialize with all devices
        this.setupEventListeners();
        this.updateFilterOptions();
        // Ensure all filters are cleared on init (browser might cache values)
        this.ensureFiltersCleared();
    }
    
    // Ensure filters are in default state (without triggering events)
    ensureFiltersCleared() {
        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.userModified) { // Only clear if not modified by user
                if (el.type === 'checkbox') {
                    el.checked = value;
                } else {
                    el.value = value;
                }
            }
        };

        setValue('filter-name', '');
        setValue('filter-floor', '');
        setValue('filter-area', '');
        setValue('filter-brand', '');
        setValue('filter-status', '');
        setValue('filter-type', '');
        setValue('filter-connectivity', '');
        setValue('filter-power', '');
        setValue('filter-ups-protected', '');
        setValue('filter-battery-type', '');
        setValue('filter-thread-border-router', false);
        setValue('filter-matter-hub', false);
        setValue('filter-zigbee-controller', false);
        setValue('filter-zigbee-repeater', false);
        setValue('filter-home-assistant', false);
        setValue('filter-google-home', false);
        setValue('filter-alexa', false);
        setValue('filter-apple-home-kit', false);
        setValue('filter-samsung-smartthings', false);
        setValue('filter-local-only', '');
    }

    // Update data (called when data changes)
    updateData(devices, areas, floors, settings) {
        this.devices = devices;
        this.areas = areas;
        this.floors = floors;
        this.settings = settings;
        this.updateFilterOptions();
    }

    // Setup event listeners for filter controls
    setupEventListeners() {
        const filterIds = [
            'filter-name',
            'filter-floor',
            'filter-area',
            'filter-brand',
            'filter-status',
            'filter-type',
            'filter-connectivity',
            'filter-power',
            'filter-ups-protected',
            'filter-battery-type',
            'filter-thread-border-router',
            'filter-matter-hub',
            'filter-zigbee-controller',
            'filter-zigbee-repeater',
            'filter-home-assistant',
            'filter-google-home',
            'filter-alexa',
            'filter-apple-home-kit',
            'filter-samsung-smartthings',
            'filter-local-only'
        ];

        filterIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                const eventType = element.type === 'text' ? 'input' : 'change';
                element.addEventListener(eventType, () => this.applyFilters());
            }
        });

        // Toggle advanced filters
        const toggleBtn = document.getElementById('toggle-advanced-filters');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const advancedFilters = document.getElementById('advanced-filters');
                if (advancedFilters) {
                    const isCollapsed = advancedFilters.classList.toggle('is-collapsed');
                    toggleBtn.classList.toggle('is-expanded', !isCollapsed);
                    toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
                }
            });
        }

        // Clear filters
        const clearBtn = document.getElementById('clear-filters');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearFilters());
        }
    }

    // Update filter dropdown options
    updateFilterOptions() {
        // Update floor filter
        const floorFilter = document.getElementById('filter-floor');
        const currentFloorValue = floorFilter ? floorFilter.value : '';
        if (floorFilter) {
            const sortedFloors = [...this.floors].sort((a, b) => a.name.localeCompare(b.name));
            floorFilter.innerHTML = '<option value="">All Floors</option>' +
                sortedFloors.map(floor => `<option value="${floor.id}">${this.escapeHtml(floor.name)}</option>`).join('');
            floorFilter.value = currentFloorValue;
        }

        // Update area filter
        const areaFilter = document.getElementById('filter-area');
        const currentAreaValue = areaFilter ? areaFilter.value : '';
        if (areaFilter) {
            const sortedAreas = [...this.areas].sort((a, b) => a.name.localeCompare(b.name));
            areaFilter.innerHTML = '<option value="">All Areas</option>' + 
                sortedAreas.map(area => `<option value="${area.id}">${this.escapeHtml(area.name)}</option>`).join('');
            areaFilter.value = currentAreaValue;
        }
        
        // Update brand filter
        const brandFilter = document.getElementById('filter-brand');
        const currentBrandValue = brandFilter ? brandFilter.value : '';
        if (brandFilter) {
            const configuredBrands = this.settings.brands || [];
            const deviceBrands = [...new Set(this.devices.map(d => d.brand).filter(Boolean))];
            const allBrands = [...new Set([...configuredBrands, ...deviceBrands])].sort();
            brandFilter.innerHTML = '<option value="">All Brands</option>' + 
                allBrands.map(brand => `<option value="${brand}">${this.escapeHtml(brand)}</option>`).join('');
            brandFilter.value = currentBrandValue;
        }
        
        // Update type filter
        const typeFilter = document.getElementById('filter-type');
        const currentTypeValue = typeFilter ? typeFilter.value : '';
        if (typeFilter) {
            const configuredTypes = this.settings.types || [];
            const deviceTypes = [...new Set(this.devices.map(d => d.type).filter(Boolean))];
            const allTypes = [...new Set([...configuredTypes, ...deviceTypes])].sort();
            typeFilter.innerHTML = '<option value="">All Types</option>' + 
                allTypes.map(type => `<option value="${type}">${this.escapeHtml(this.formatDeviceType(type))}</option>`).join('');
            typeFilter.value = currentTypeValue;
        }
        
        // Update connectivity filter
        const connectivityFilter = document.getElementById('filter-connectivity');
        const currentConnectivityValue = connectivityFilter ? connectivityFilter.value : '';
        if (connectivityFilter) {
            const configuredConnectivity = this.settings.connectivity || [];
            const deviceConnectivity = [...new Set(this.devices.map(d => d.connectivity).filter(Boolean))];
            const allConnectivity = [...new Set([...configuredConnectivity, ...deviceConnectivity])].sort();
            connectivityFilter.innerHTML = '<option value="">All Connectivity</option>' + 
                allConnectivity.map(conn => {
                    const displayName = conn.charAt(0).toUpperCase() + conn.slice(1).replace('-', ' ');
                    return `<option value="${conn}">${this.escapeHtml(displayName)}</option>`;
                }).join('');
            connectivityFilter.value = currentConnectivityValue;
        }

        // Update battery type filter
        const batteryTypeFilter = document.getElementById('filter-battery-type');
        const currentBatteryTypeValue = batteryTypeFilter ? batteryTypeFilter.value : '';
        if (batteryTypeFilter) {
            const deviceBatteryTypes = [...new Set(this.devices.map(d => d.batteryType).filter(Boolean))].sort();
            batteryTypeFilter.innerHTML = '<option value="">All Battery Types</option>' + 
                deviceBatteryTypes.map(type => `<option value="${type}">${this.escapeHtml(type)}</option>`).join('');
            batteryTypeFilter.value = currentBatteryTypeValue;
        }
    }

    // Apply all filters and return filtered devices
    applyFilters() {
        const getElementValue = (id) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`Filter element not found: ${id}`);
                return '';
            }
            const value = el.type === 'checkbox' ? el.checked : el.value;
            if (value && value !== '' && value !== false) {
                console.log(`Filter ${id} has value:`, value);
            }
            return value;
        };

        const nameFilter = (getElementValue('filter-name') || '').toString().trim().toLowerCase();
        const floorFilter = getElementValue('filter-floor');
        const areaFilter = getElementValue('filter-area');
        const brandFilter = getElementValue('filter-brand');
        const statusFilter = getElementValue('filter-status');
        const typeFilter = getElementValue('filter-type');
        const connectivityFilter = getElementValue('filter-connectivity');
        const powerFilter = getElementValue('filter-power');
        const upsProtectedFilter = getElementValue('filter-ups-protected');
        const threadBorderRouterFilter = getElementValue('filter-thread-border-router');
        const matterHubFilter = getElementValue('filter-matter-hub');
        const zigbeeControllerFilter = getElementValue('filter-zigbee-controller');
        const zigbeeRepeaterFilter = getElementValue('filter-zigbee-repeater');
        const batteryTypeFilter = getElementValue('filter-battery-type');
        const homeAssistantFilter = getElementValue('filter-home-assistant');
        const googleHomeFilter = getElementValue('filter-google-home');
        const alexaFilter = getElementValue('filter-alexa');
        const appleHomeKitFilter = getElementValue('filter-apple-home-kit');
        const samsungSmartThingsFilter = getElementValue('filter-samsung-smartthings');
        const localOnlyFilter = getElementValue('filter-local-only');
        
        // Debug: log active filters
        const activeFilters = {
            name: nameFilter,
            floor: floorFilter,
            area: areaFilter,
            brand: brandFilter,
            status: statusFilter,
            type: typeFilter,
            connectivity: connectivityFilter,
            power: powerFilter,
            upsProtected: upsProtectedFilter,
            threadBorderRouter: threadBorderRouterFilter,
            matterHub: matterHubFilter,
            zigbeeController: zigbeeControllerFilter,
            zigbeeRepeater: zigbeeRepeaterFilter,
            batteryType: batteryTypeFilter,
            homeAssistant: homeAssistantFilter,
            googleHome: googleHomeFilter,
            alexa: alexaFilter,
            appleHomeKit: appleHomeKitFilter,
            samsungSmartThings: samsungSmartThingsFilter,
            localOnly: localOnlyFilter
        };
        
        const appliedFilters = Object.entries(activeFilters)
            .filter(([key, value]) => value && value !== '')
            .map(([key, value]) => `${key}: ${value}`);
        
        if (appliedFilters.length > 0) {
            console.log('Active filters:', appliedFilters);
        }
        
        this.filteredDevices = this.devices;

        if (nameFilter) {
            this.filteredDevices = this.filteredDevices.filter(d =>
                (d.name || '').toLowerCase().includes(nameFilter)
            );
        }

        if (floorFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => {
                if (!d.area) return false;
                const area = this.areas.find(a => a.id === d.area);
                return area && area.floor === floorFilter;
            });
        }

        if (areaFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => d.area === areaFilter);
        }
        
        if (brandFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => d.brand === brandFilter);
        }
        
        if (statusFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => d.status === statusFilter);
        }
        
        if (typeFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => d.type === typeFilter);
        }
        
        if (connectivityFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => d.connectivity === connectivityFilter);
        }

        if (powerFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => d.power === powerFilter);
        }

        if (upsProtectedFilter) {
            const isProtected = upsProtectedFilter === 'true';
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.upsProtected) === isProtected);
        }

        if (threadBorderRouterFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.threadBorderRouter));
        }

        if (matterHubFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.matterHub));
        }

        if (zigbeeControllerFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.zigbeeController));
        }

        if (zigbeeRepeaterFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.zigbeeRepeater));
        }

        if (batteryTypeFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => (d.batteryType || '') === batteryTypeFilter);
        }

        if (homeAssistantFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.homeAssistant));
        }

        if (googleHomeFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.googleHome));
        }

        if (alexaFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.alexa));
        }

        if (appleHomeKitFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.appleHomeKit));
        }

        if (samsungSmartThingsFilter) {
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.samsungSmartThings));
        }

        if (localOnlyFilter) {
            const isLocal = localOnlyFilter === 'true';
            this.filteredDevices = this.filteredDevices.filter(d => Boolean(d.localOnly) === isLocal);
        }
        
        // Log results
        console.log(`Filters applied: ${this.devices.length} devices → ${this.filteredDevices.length} filtered`);
        
        // Call callback if provided
        if (this.onFilterChange) {
            this.onFilterChange(this.filteredDevices);
        }

        return this.filteredDevices;
    }

    // Clear all filters
    clearFilters() {
        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = value;
                } else {
                    el.value = value;
                }
            }
        };

        setValue('filter-name', '');
        setValue('filter-floor', '');
        setValue('filter-area', '');
        setValue('filter-brand', '');
        setValue('filter-status', '');
        setValue('filter-type', '');
        setValue('filter-connectivity', '');
        setValue('filter-power', '');
        setValue('filter-ups-protected', '');
        setValue('filter-battery-type', '');
        setValue('filter-thread-border-router', false);
        setValue('filter-matter-hub', false);
        setValue('filter-zigbee-controller', false);
        setValue('filter-zigbee-repeater', false);
        setValue('filter-home-assistant', false);
        setValue('filter-google-home', false);
        setValue('filter-alexa', false);
        setValue('filter-apple-home-kit', false);
        setValue('filter-samsung-smartthings', false);
        setValue('filter-local-only', '');
        
        this.applyFilters();
    }

    // Get current filtered devices
    getFilteredDevices() {
        return this.filteredDevices;
    }

    // Utility functions
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDeviceType(type) {
        if (!type) return '';
        return type.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}

// Export as global for easy access
window.DeviceFilters = DeviceFilters;
