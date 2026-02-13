# Smart Home Planner (Home Assistant App)

Home Assistant App to plan, document, and visualize your smart home ecosystem. Everything is stored in the browser (localStorage) and the UI includes dashboards, advanced filters, and a device connection map. The app is served via Home Assistant **ingress** for a clean, built-in experience.

## Features
- A quick dashboard that highlights what matters most in your smart home.
- Easy device list with search, filters, and a clear status overview.
- Simple forms to keep device details, notes, and dates in one place.
- Organize everything by floors and areas.
- Visual map to see how devices are connected.
- Support for multiple homes.
- Backup and restore your data from Settings.

## Tech Stack
- Home Assistant App with ingress (served by Caddy).
- Vanilla HTML/CSS/JS (no build step).
- Cytoscape.js (CDN) for the map.
- localStorage for persistence.

## Quick start
1. Add this repository as a custom app repository in Home Assistant.
2. Install **Smart Home Planner** from the App Store.
3. Open it from the Home Assistant sidebar (ingress).

## Data and privacy
- All data is stored in the user's browser (localStorage), inside Home Assistant.
- No backend and no tracking.
- The map loads Cytoscape from `unpkg.com`; for 100% offline usage, download the library and update the script tag.

## Structure
- `config.yaml`: Home Assistant App definition.
- `website/`: UI served by the app.
- `website/js/`: data logic, filters, forms, and map.
- `website/css/`: styles.

## Import/Export
From **Settings** you can export a JSON with devices, areas, floors, homes, settings, and map positions, or import a backup.

## Demo mode
Enable Demo mode from **Settings** to load the bundled sample dataset without losing your current data. When you turn it off, your previous data is restored.

If you want to import the sample manually, use `website/json/sample.json`.


## License
MIT. See `LICENSE`.
