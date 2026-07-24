## 1.8.0

### Added
- Dedicated Map page with its own filters, reachable from the left navigation rail (the map is no longer a tab inside Devices)
- Device finder on the Diagram view with zoom-to and highlight
- Floating connection legend on the Diagram view with per-layer toggles
- Floor plan suggestion banner on the Diagram view when no background image is set
- Filtered-out devices on the Diagram view are now dimmed instead of removed (configurable)
- Trace path: highlight a device's full connection chain to its network root and the Internet, with animated flow
- Failure simulation: mark devices as down and see everything that loses connectivity
- Internet Providers: manage your ISPs and see them on the diagram as clouds, with ISP outage simulation
- Multiple storages per device
- Port inventory per device (Ethernet, SFP, SFP+, HDMI, USB and power)
- HDMI connections are shown on the diagram as a new purple layer with its own toggle, and SFP/SFP+ links appear on the Ethernet layer
- USB ports now have a connector type (USB-A, USB-B, USB-C, Micro-USB, Mini-USB) and a USB version (USB 2.0, 3.0, 3.1, 3.2, USB4)
- USB port direction is labeled Host/Device (instead of Input/Output) to match the USB host/peripheral model
- Network port speeds are now limited to the valid options for each type (Ethernet up to 10G, SFP 100M/1G, SFP+ 1G/10G)
- PoE on Ethernet ports support
- Port-to-port connections with both sides kept in sync
- Brand and Type dropdowns on the device form now include a search box to filter options as you type
- Data consistency checks: the device form lists warnings at the top and under each affected field, and a new "Data Inconsistencies" dashboard card lists them across all devices

### Changed
- Complete app redesign
- Refined the Devices list pagination: compact chevron Previous/Next buttons aligned with uniform page cells, flat active state, and consistent hover
- Improved Diagram view accessibility
- Device form layout improvements
- Clearer empty state for device labels

### Fixed
- Deleting a device now clears every reference to it — wireless links (access point, Zigbee parent, Z-Wave controller), the linked-device lists on the other side, and wired port connections — from both the device list and the edit form, so no dangling references are left behind. The delete confirmation now warns how many other devices will be unassigned.
- Fix the calendar icon on date inputs rendering black and barely visible on the dark theme.
- Multiple device form layout and focus glitches
- Fix the diagram background image being shifted in fullscreen mode
- Fix "Clear Filters" not resetting the Model and Network filters
- Fix the device tooltip opening misaligned or overflowing off screen

## 1.7.0 - 2026-07-07

### Added
- New "Input/Output" direction for ethernet ports, displayed with arrows on both ends on the diagram
- Reports export now lets you pick which sections to include (Summary & Statistics, Device Details, Network Diagram, Test Cases)
- New Markdown (.md) report format that exports a full wiki with every field for each device, ideal as context for AI assistants
- New "Power Strips" device type with its own icon

### Fixed
- Fix linked Zigbee/Z-Wave devices not being saved when the coordinator connects to the hub through USB, Ethernet or Wi-Fi instead of the Zigbee/Z-Wave protocol itself. Linked devices are now persisted and shown on the diagram based on the coordinator/router role, regardless of the coordinator's own connectivity

## 1.6.1 - 2026-07-07

### Fixed
- Fix add-on installation failing to build the image ("base name (${BUILD_FROM}) should not be blank") after the Home Assistant Supervisor builder migration, which no longer provides the `BUILD_FROM` build argument

## 1.6.0

### Added
- Generate and download reports for your smart home inventory
- New "Warranty Expiring Soon" Dashboard card
- Home Assistant persistent notifications for active warnings
- Support to upload avatar image to each device
- Support to bulk edit Installation Date

## 1.5.1 - 2026-03-05

### Fixed
- Fix missing `smart-home-planner` app backup warning

## 1.5.0 - 2026-03-05

### Added
- Support to assign a multiple links to each device
- Support to link Z-Wave and Zigbee devices
- Display Z-Wave and Zigbee connections on diagram
- Persist diagram display settings
- Show warning when there is no backup in the last 7 days that includes the `smart-home-planner` app.

### Fixed
- Changing any Diagram Settings doesn't reset the diagram zoom anymore
- Devices without floor now are displayed on the diagram

## 1.4.0 - 2026-02-27

### Added
- New Test Cases page with manual test definition, scheduling, and run logging
- Wi-Fi connectivity details (download/upload speed, band, connected access point) and optional dotted Wi-Fi diagram links with band labels

## 1.3.0 - 2026-02-26

### Added
- Added Z-Wave controller field on each device
- Added help info with explanations and best practices regarding each device data
- Aded new Missing Area card in home dashboard
- Added Last Backup dashboard card in home dahsboard

### Fixes
- Cache fixes


## 1.2.0 - 2026-02-24

### Added
- Overlaying devices on a floor plan image for spatial context.

### Fixes
- Fixed cahing of js and css resources

## 1.1.0 - 2026-02-22

### Added
- More device fields: serial number, purchase date, store, price and Warranty Expiration
- Added Global Search
- Added links to buy needed batteries on Amazon

## 1.0.0 - 2026-02-21

### Added
- More device types
- Integration with Home Assistant labels
- Support for bulk edit the devices

# Changed
- Settings UI improvements

## 0.5.0 - 2026-02-19

### Added
- Now editing the area of a device in the app also edits it in HA
- Support to attach files and images to each device

### Changed
- Home dashboard UI improvements
- Navigation UI improvements
- Excluded Devices UI Improvements
  
## 0.4.0 - 2026-02-16

### Added
- New "Excluded Devices" section on Settings
- More automatic devices exclusions when syncing with HA
- Support to open a device in HA
- Now editing the name of a device in the app also edits it in HA
- Added apply button on edit device screen
  
### Changed
- Now the UI is wide screen and the devices tables supports more columns
- Improved success messages UI

## 0.3.0 - 2026-02-15

### Added

- Integration with Home Assistant devices, floors and areas

### Removed

- Given that Home Assistant doesnn't support it, the support for multiple homes was removed
- Removed demo mode support

## 0.2.0 - 2026-02-14

### Changed

- Migration to Home Assistant App.
- All the data is now backed up with the Home Assistamt backup system

## 0.1.0 - 2026-02-09

### Added

- A quick dashboard that highlights what matters most in your smart home.
- Easy device list with search, filters, and a clear status overview.
- Simple forms to keep device details, notes, and dates in one place.
- Organize everything by floors and areas.
- Visual map to see how devices are connected.
- Support for multiple homes.
- Backup and restore your data from Settings.
