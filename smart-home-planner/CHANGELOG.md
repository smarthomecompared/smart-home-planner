## 1.5.0 - 2026-03-05

### Added
- Support to assign a multiple links to each device
- Support to link Z-Wave and Zigbee devices
- Display Z-Wave and Zigbee connections on diagram
- Persist diagram display settings

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
