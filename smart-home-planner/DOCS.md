# Smart Home Planner App - User Guide

The Smart Home Planner app helps you plan, document, and visualize your smart home. It is built for clarity: it keeps real-world details in one place so you can manage devices across rooms, floors, and networks without losing context.

## Initial Sync With Home Assistant

When the app is installed in Home Assistant, it will sync key information so you do not have to start from scratch. This sync brings in the structure of your home and keeps the app aligned with what Home Assistant already knows.

What to expect from the initial sync:
1. Areas and floors from Home Assistant appear in the app.
2. Devices present in Home Assistant appear in the app with their basic identity.
3. The app uses the same area structure so you can navigate devices by room immediately.

You stay in control of how Home Assistant areas map into the app:
1. Installed Area is where the device physically lives.
2. Controlled Area is the space a device influences, even if it is installed elsewhere.

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
4. Connectivity captures how the device communicates, along with its network and role flags.
5. Power captures wired or battery status and energy usage.
6. Integrations capture which ecosystems the device belongs to.
7. Files and notes keep manuals, receipts, and maintenance history close to the device.

## Dashboard

The Dashboard is your operational overview. It is designed to answer two questions quickly: what do I have and what needs attention?

What the Dashboard provides:
1. Top-level totals for devices, floors, and areas.
2. Status highlights for working, pending, and not working devices.
3. Action lists for Pending, Not Working, and Wishlist devices.
4. Battery planning insights and upcoming changes.
5. Power usage summaries and heavy consumers.
6. Distribution views by type, brand, connectivity, and integrations.

How to use it effectively:
1. Use the Pending list to drive installation work.
2. Use the Battery Changes Soon list to plan maintenance.
3. Use connectivity and integration cards to see ecosystem coverage.
4. Expand any card for a larger, easier-to-scan view.

## Devices

The Devices screen is the heart of the app. It combines search, filtering, and multiple views so you can move from overview to detail quickly.

### Filters

Filters let you narrow the inventory without losing context. Use them to answer specific questions such as which battery devices are in a certain area or which devices are Zigbee repeaters.

Common filters include:
1. Name, brand, and type
2. Floor, Installed Area, and Controlled Area
3. Status and power type
4. Connectivity, network, and role flags
5. Integrations and local-only devices

Use Clear Filters when you want to return to a full inventory view.

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

### Diagram View

The Diagram view gives you a spatial and relational understanding of devices.

Best use cases:
1. Visualizing device connections such as Ethernet, USB, and Power.
2. Understanding how devices are grouped by Installed or Controlled Area.
3. Refining layout by dragging devices into a meaningful arrangement.
4. Entering full screen for deep review sessions.

The layout editor lets you position devices in a way that matches your real-world setup, then save the layout so it stays consistent.

## Add Device

Use Add Device to capture both operational and planning information. The form is organized to mirror how you think about hardware: what it is, where it lives, how it connects, and how it is maintained.

Guidance for each section:
1. Basic Information identifies the device and makes it searchable.
2. Installation defines location and status, which drives filters and dashboards.
3. Power captures energy needs, battery planning, and consumption data.
4. Storage helps document hubs and servers with disk space.
5. Connectivity captures how the device communicates and its network identity.
6. Ports describe connections to other devices for mapping and documentation.
7. Integrations track ecosystem ownership across platforms.
8. Notes and Files keep manuals, receipts, and maintenance history in one place.

## Edit Device

Edit Device is where you keep information accurate over time. Use it whenever a device changes status, location, or configuration.

Typical tasks:
1. Change a device from Pending to Working after installation.
2. Update battery change dates after maintenance.
3. Add files such as invoices or manuals.
4. Update connectivity details after a network change.
5. Delete the device if it is permanently removed.

The Apply action lets you save changes without leaving the page, which is useful during longer editing sessions.

## Settings

Settings is where you maintain the app’s overall structure and reference data.

### General

Use Data Management when you want a portable backup of the app:
1. Export Data saves your full inventory and attachments.
2. Import Data restores a previous backup.

Use Networks to manage the list used in device connectivity fields.

### Device Options

Device Options control the selectable lists used throughout the app. Keep these tidy to speed up device entry and maintain consistency across the inventory.

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
