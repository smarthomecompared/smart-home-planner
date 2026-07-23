## 1.8.0

### Added
- Device finder on the Diagram view: search from the map toolbar and the view zooms to and highlights the matching device
- Floating connection legend on the Diagram view; each chip also toggles its connection layer on and off
- Floor plan suggestion banner on the Diagram view when no background image is set, with a one-click upload button (dismissible)
- Active filters are now shown as removable chips in a slim row below the page header, with a count badge on the Filters button and a "Clear all" shortcut
- The device counter now reads "Showing X of Y devices" while filters are active
- Filtered-out devices on the Diagram view are now dimmed in place instead of removed, keeping them visible in context (configurable via the new "Dim filtered-out devices" toggle in Diagram Settings)

### Changed
- Complete UI redesign
- All dropdown selects across the app now open a custom dark menu matching the UniFi OS design (with keyboard navigation and type-to-search) instead of the native browser dropdown
- Redesigned the diagram device popover: dark card with device icon and status badge, empty fields are hidden, and the device's visible connections are listed
- Redesigned the diagram device cards: cleaner dark cards with a subtle gradient, hairline border, and a status dot with glow instead of the thick colored frame
- Improved Diagram view accessibility: the Diagram Settings header is now a keyboard-focusable button and the device counter announces filter changes to screen readers
- Redesigned the boolean filter checkboxes (Integrations, connectivity roles) as compact selectable chips, making the filters panel much shorter
- The expanded filters panel is now a floating side drawer overlaid on the content, so the table, grid, and diagram react live while you filter; it closes with the X button, Escape, or a click outside
- Replaced the full-width Filters bar with a compact Filters button in the page header, freeing vertical space for the content

### Fixed
- Fix the diagram background image being shifted towards the top-left corner in fullscreen mode
- Fix "Clear Filters" not resetting the Model and Network filters

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
