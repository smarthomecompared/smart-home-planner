# Smart Home Planner

Static web app to plan, document, and visualize your smart home ecosystem. Everything is stored in the browser (localStorage) and the UI includes dashboards, advanced filters, and a device connection map.

## Features
- A quick dashboard that highlights what matters most in your smart home.
- Easy device list with search, filters, and a clear status overview.
- Simple forms to keep device details, notes, and dates in one place.
- Organize everything by floors and areas.
- Visual map to see how devices are connected.
- Support for multiple homes.
- Backup and restore your data from Settings.

## Tech Stack
- Vanilla HTML/CSS/JS (no build step).
- Cytoscape.js (CDN) for the map.
- localStorage for persistence.

## Quick start
Recommended: run a local static server.

```bash
cd website
python3 -m http.server 8000
```

Open in the browser: `http://localhost:8000/index.html`

Note: opening with `file://` may work, but localStorage and some behaviors depend on the browser.

## Data and privacy
- All data is stored in the user's browser (localStorage).
- No backend and no tracking.
- The map loads Cytoscape from `unpkg.com`; for 100% offline usage, download the library and update the script tag.

## Structure
- `website/`: static site.
- `website/js/`: data logic, filters, forms, and map.
- `website/css/`: styles.

## Import/Export
From **Settings** you can export a JSON with devices, areas, floors, homes, settings, and map positions, or import a backup.

## Demo data
A complete demo dataset lives at `sample.json`. Import it from **Settings** to explore the dashboard, map, and filters with sample data.


## License
MIT. See `LICENSE`.
