# Smart Home Planner App - User Guide

The Smart Home Planner app helps you plan, document, and visualize your smart home. It is built for clarity: it keeps real-world details in one place so you can manage devices across rooms, floors, and networks without losing context.

In the app, a device represents a physical piece of hardware (unlike Home Assistant, where a device can also be a logical or integration-level entity).

## Initial Sync With Home Assistant

When the app is installed in Home Assistant, it will sync key information so you do not have to start from scratch. This sync brings in the structure of your home and keeps the app aligned with what Home Assistant already knows.

What to expect from the initial sync:
1. Areas and floors from Home Assistant appear in the app.
2. Devices present in Home Assistant appear in the app with their basic identity.
3. Device labels from Home Assistant are imported so you can use them throughout the app.
4. The app uses the same area structure so you can navigate devices by room immediately.

You stay in control of how Home Assistant areas map into the app:
1. Installed Area is where the device physically lives.
2. Controlled Area is the space a device influences, even if it is installed elsewhere.

When you update labels on a Home Assistant-linked device in the app, those label changes are also applied in Home Assistant.

### Adding Devices Outside Home Assistant

The app is not limited to Home Assistant devices. You can add devices directly in the app at any time. This is useful for:
1. Planning future purchases.
2. Tracking devices that are not integrated into Home Assistant.
3. Documenting infrastructure such as switches, routers, hubs, and wiring.

Manual devices live side by side with synced devices, so your inventory stays complete.

## How the App Organizes Your Home

Understanding the core concepts will help you get the most out of the app.

Key concepts:
1. Device status shows where each device sits in its lifecycle, such as working, pending, not working, or wishlist.
2. Installed Area is the physical location of the device.
3. Controlled Area is the space a device influences.
4. Connectivity captures how the device communicates, along with its network and role flags. For Wi-Fi devices, you can also track download speed, upload speed, Wi-Fi band, and the connected router/access point. For Zigbee devices, you can assign a Zigbee router or coordinator, and for Z-Wave devices, you can assign a Z-Wave coordinator. From parent devices, you can also manage linked Wi-Fi, Zigbee, and Z-Wave devices directly.
5. Power captures wired or battery status and energy usage.
6. Integrations capture which ecosystems the device belongs to.
7. Purchase information tracks serial numbers, dates, prices, and warranty expiration.
8. Files and notes keep manuals, receipts, and maintenance history close to the device.
9. Device images let you upload a custom photo per device. When no custom image is available, the app uses the device type icon as a fallback.

## Dashboard

The Dashboard is your operational overview. It is designed to answer two questions quickly: what do I have and what needs attention?

### Overview
Shows total devices, areas, and floors, plus a quick split of working, pending, and not working devices.

### Pending Devices
Lists devices that are planned but not installed yet, so you can track installation work.

### Not Working Devices
Lists installed devices currently marked as not working to prioritize troubleshooting.

### Missing Area
Lists working devices with no area assigned in the area field currently mapped to Home Assistant.

### Tests Health
Highlights manual test cases that need attention, including failed runs, overdue checks, and tests due within the next 7 days.

### Last Backup
Shows the health and details of the latest Home Assistant backup (full or partial), including age, size, and protection. The card is highlighted as warning when the latest backup is older than 7 days or when there is no backup in the last 7 days that includes the `smart-home-planner` add-on.

### Wishlist Devices
Lists planned or desired devices that are not part of your active setup yet.

### Devices by Label
Shows how devices are distributed across labels, helping validate your tagging strategy.

### Warranty Expiring Soon

Lists devices whose warranty expires within the next 90 days. Items expiring within 30 days are highlighted in red; items between 31 and 90 days are highlighted in orange.

### Battery Changes Soon
Highlights devices approaching battery replacement and includes a purchase-oriented battery summary.

### Total Batteries by Type
Shows the total battery quantity required across your inventory by battery type.

### Total Power Consumption
Summarizes aggregate idle, mean, and max power consumption for the entire setup.

### Devices by Power Usage
Shows the highest-consuming individual devices to identify heavy consumers quickly.

### Devices by Integrations
Displays device distribution across Home Assistant and other integration ecosystems.

### Devices 100% Local
Shows the share of devices that can operate fully inside your local network.

### UPS Protected Devices
Shows how much of your inventory is covered by backup power.

### Devices by Type
Displays distribution by hardware category such as sensor, camera, switch, or thermostat.

### Devices by Connectivity
Displays distribution by protocol or transport such as Wi-Fi, Zigbee, Z-Wave, Thread, or Ethernet.

### Devices by Brand
Shows vendor distribution to understand brand concentration across your setup.

## Devices

The Devices screen is the heart of the app. It combines search, filtering, and multiple views so you can move from overview to detail quickly.

### Global Search

Use the search bar in the top navigation to find devices and test cases from anywhere in the app. Search is real time and scans text details, so you can locate records by name, notes, labels, model, test steps, and expected outcomes.

### Filters

Filters let you narrow the inventory without losing context. Use them to answer specific questions such as which battery devices are in a certain area or which devices are Zigbee repeaters.

Common filters include:
1. Name, brand, and type
2. Floor, Installed Area, and Controlled Area
3. Status and power type
4. Connectivity, network, and role flags
5. Labels
6. Integrations and local-only devices

Use Clear Filters when you want to return to a full inventory view.

### Bulk Edit

Bulk Edit lets you apply a single change to multiple devices. Select devices from the table or cards, choose a field, and apply one update at a time. Supported fields include Installed Area, Controlled Area, Add/Remove Labels, Type, Brand, Status, Purchase Date, and Warranty Expiration. When the field you edit is synced with Home Assistant, the app updates Home Assistant too.

### Table View

The Table view is optimized for fast scanning and sorting.

Best use cases:
1. Sorting by status to see what is pending or not working.
2. Sorting by area to audit specific rooms.
3. Comparing connectivity and power at a glance.
4. Reviewing many devices on a single page.

### Grid View

The Grid view highlights individual devices with quick context.

Best use cases:
1. Visual scanning for key details.
2. Opening device cards for deeper editing.
3. Reviewing status and ownership by ecosystem.
4. Quickly spotting device labels without opening the full record.
5. Browsing devices visually using larger images (uploaded photo when present, otherwise type icon).

### Diagram View

The Diagram view gives you a spatial and relational understanding of devices.

Best use cases:
1. Visualizing device connections such as Ethernet, USB, Power, and optional Wi-Fi, Zigbee, and Z-Wave links.
2. Understanding how devices are grouped by Installed or Controlled Area.
3. Refining layout by dragging devices into a meaningful arrangement.
4. Entering full screen for deep review sessions.
5. Overlaying devices on a floor plan image for spatial context.

The layout editor lets you position devices in a way that matches your real-world setup, then save the layout so it stays consistent.

You can upload a background image such as a floor plan in the Diagram Settings panel. Device positions are stored relative to the background image, so they stay aligned regardless of zoom, pan, fullscreen, or window resize. Use the opacity slider to adjust the background visibility.

Diagram Settings also lets you toggle Ethernet, USB, Power, Wi-Fi, Zigbee, and Z-Wave connection overlays independently so you can focus on the relationship layer you need.

## Add Device

Use Add Device to capture both operational and planning information. The form is organized to mirror how you think about hardware: what it is, where it lives, how it connects, and how it is maintained.

Guidance for each section:
1. Basic Information identifies the device, including any labels used for filtering.
2. Purchase Information captures serial numbers, store, price, currency, and warranty expiration.
3. Installation defines location and status, which drives filters and dashboards.
4. Power captures energy needs, battery planning, and consumption data.
5. Storage helps document hubs and servers with disk space.
6. Connectivity captures how the device communicates and its network identity, including Wi-Fi speed, band, connected router/access point details, Zigbee parent assignment, and Z-Wave coordinator assignment when applicable.
7. Ports describe connections to other devices for mapping and documentation.
8. Integrations track ecosystem ownership across platforms.
9. Notes, Links, and Files keep product pages, docs, receipts, and maintenance history in one place.

## Edit Device

Edit Device is where you keep information accurate over time. Use it whenever a device changes status, location, or configuration.

Typical tasks:
1. Change a device from Pending to Working after installation.
2. Update battery change dates after maintenance.
3. Add files such as invoices or manuals.
4. Update connectivity details after a network change.
5. Link or unlink Wi-Fi, Zigbee, and Z-Wave child devices directly from the relevant parent records.
6. Update purchase info like serial numbers or warranty expiration.
7. Adjust labels to keep Home Assistant and the app aligned.
8. Upload, replace, or remove the device photo.
9. Delete the device if it is permanently removed.

The Apply action lets you save changes without leaving the page, which is useful during longer editing sessions.

## Test Cases

Test Cases is a dedicated workspace for defining repeatable manual checks and logging pass/fail results over time.

How it works:
1. Create test cases with a category, priority, frequency, manual steps, and expected result.
2. Run a test any time and record the outcome as Pass, Fail, or Blocked with notes.
3. Track the latest run date and next due date for each test.
4. Filter by category, priority, and health to focus on failed, overdue, or upcoming checks.
5. Sort by category, priority, last run status, or next due date to review your list in the order you need.
6. Review the last run row inside each test case to see the most recent execution details.

## Settings

Settings is where you maintain the app’s overall structure and reference data.

### Backup

The app stores its data inside Home Assistant, so your regular Home Assistant backups already include it. Use the backup tools when you need a manual export or a restore from a file:
1. Export Data saves your full inventory and attachments.
2. Import Data restores a previous backup.
3. Export to PDF generates a shareable PDF report of your smart home inventory.

### Export to PDF

The PDF report gives you a professional, printable snapshot of your entire setup. It is organized into sections so you can share it with others or keep it as a reference outside the app.

What the PDF includes:

1. Cover page with your home name and the report date.
2. Table of Contents with page numbers for each section.
3. Visual Summary with charts for device status, connectivity, power source, UPS coverage, integrations, and local versus cloud usage.
4. Summary Report with detailed breakdowns by area, floor, brand, label, battery type, and integrations.
5. Device Details with a full-page table per device covering every visible field: basic info, location, power, battery, storage, connectivity, ports, network associations, roles, integrations, purchase info, and notes.
6. Network Diagrams showing your device layout. When a floor plan background image is configured, devices appear positioned over it. Without a background, areas and floors are drawn as labeled boxes matching the app diagram. One overview page shows all devices without connections, followed by one page per active connection type (Ethernet, USB, Power, Wi-Fi, Zigbee, Z-Wave).
7. Test Cases listing all test cases grouped by category with name, priority, description, steps, and expected result.

### Networks

Networks manages the list of VLANs or network names used in device connectivity fields.

### Device Options

Device Options control the selectable lists used throughout the app. Keep these tidy to speed up device entry and maintain consistency across the inventory.

### Test Cases

Test Cases settings lets you manage the category list used in the Test Cases page. You can add, rename, or remove categories to match your operational check workflows.

### Notifications

Notifications sends Home Assistant persistent notifications for active warnings automatically. The check runs every time you open the dashboard and once every 24 hours in the background.

Notification types you can enable or disable individually:

1. Battery Changes Soon — alerts when devices are approaching their battery replacement date.
2. Warranty Expiring Soon — alerts when devices have warranty expiring within 90 days.
3. Last Backup Warning — alerts when the most recent Home Assistant backup is older than 7 days or does not include the Smart Home Planner app.
4. Tests Overdue or Due Soon — alerts when test cases are overdue or due within the next 7 days.

How notifications work:

1. Each notification type has a fixed ID in Home Assistant so the same alert is updated rather than duplicated.
2. When a condition resolves, the notification is automatically dismissed from Home Assistant.
3. If you manually dismiss a notification in Home Assistant, it will not reappear unless the underlying condition changes, such as a new device triggering the same warning.

### Home Assistant Integration

This section controls how Home Assistant areas map into the app and how synced devices are handled.

Key behaviors:
1. You choose whether Home Assistant areas map to Installed or Controlled Area.
2. Devices removed from the app but still present in Home Assistant are listed as excluded.
3. Excluded devices can be restored without re-entering their data.


## Common Use Cases

These are the most common workflows for day-to-day use:
1. Plan new purchases by adding devices as Wishlist.
2. Track installation progress with Pending status.
3. Maintain battery schedules using Battery Changes Soon.
4. Document network topology and wiring using the Diagram view.
5. Keep a single source of truth by attaching manuals and notes to devices.

The Smart Home Planner app is meant to stay out of your way while keeping your smart home fully documented. Use it as a living inventory and a planning tool that grows with your setup.
