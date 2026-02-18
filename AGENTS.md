# AGENTS.md

Guidelines for agentic coding agents working in this repository.

## Project Overview

Smart Home Planner is a Home Assistant add-on for planning, documenting, and visualizing smart home ecosystems.

**Tech Stack:**
- Python 3 HTTP server (serves UI + storage API)
- Node.js WebSocket worker (syncs with Home Assistant registries)
- Vanilla HTML/CSS/JS frontend (no build step)
- Cytoscape.js for device map visualization

## Build/Deploy Commands

```bash
# Deploy to Home Assistant testing instance (requires Samba mount)
sh sync-samba.sh

# Build Docker image locally
docker build -t smart-home-planner smart-home-planner/

# Install Node.js dependencies (for sync worker)
cd smart-home-planner && npm install --omit=dev

# Run Python server locally for development
SHP_WEB_ROOT=smart-home-planner/src SHP_DATA_FILE=./data.json python3 smart-home-planner/server.py
```

## Linting/Formatting Commands

No linters are currently configured, but these are recommended:

```bash
# Python linting and formatting
pip install black ruff
black --check smart-home-planner/
ruff check smart-home-planner/

# JavaScript linting
npx eslint smart-home-planner/src/js/

# CSS linting
npx stylelint "smart-home-planner/src/css/*.css"
```

## Language Convention

**All code, comments, documentation, UI text, variable names, function names, commit messages, and documentation must be written in English.** This applies to both backend and frontend code.

## Code Style Guidelines

### Python

- **Indentation:** 4 spaces (no tabs)
- **Naming:** `snake_case` for functions, variables, and file names; `PascalCase` for classes
- **Type hints:** Not used in this codebase
- **Imports:** Standard library first, then third-party (alphabetical within groups)
- **Strings:** Double quotes for string literals
- **Error handling:** Use specific exception types, return sensible defaults on failure
- **Thread safety:** Use `threading.Lock()` for shared state (see `server.py`)
- **Functions:** Keep functions focused and under ~50 lines when possible
- **Comments:** Only for non-obvious logic; prefer self-documenting code

Example:
```python
def _sanitize_device_id(value):
    normalized = FILENAME_SAFE_PATTERN.sub("_", str(value or "").strip())
    normalized = normalized.strip("._")
    if not normalized:
        raise ValueError("Missing or invalid device id")
    return normalized
```

### JavaScript

- **Indentation:** 4 spaces (no tabs)
- **Naming:** `camelCase` for variables and functions; `PascalCase` for constructor functions
- **Modules:** Use ES modules (`import`/`export`), not CommonJS
- **Imports:** Node builtins with `node:` prefix, then third-party
- **Variables:** Use `const` by default, `let` only when reassignment is needed; never use `var`
- **Functions:** Prefer arrow functions for callbacks; regular functions for top-level
- **Equality:** Always use strict equality (`===` and `!==`)
- **Async:** Use `async`/`await` instead of raw Promises when possible
- **Strings:** Double quotes for string literals
- **Error handling:** Throw `Error` objects with descriptive messages

Example:
```javascript
async function loadHaRegistry(url) {
    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Registry request failed: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to load registry from ${url}:`, error);
        return [];
    }
}
```

### CSS

- **Indentation:** 4 spaces (no tabs)
- **Naming:** `kebab-case` for class names and IDs
- **Variables:** Use CSS custom properties defined in `:root` (see `common.css`)
- **Colors:** Use CSS variables from the dark theme palette
- **Organization:** One property per line, alphabetical or logical ordering
- **Selectors:** Prefer class selectors over ID selectors for reusability

Example:
```css
.dashboard-card {
    background: var(--card-bg);
    border-radius: 14px;
    padding: 1.5rem;
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--border-color);
}
```

### HTML

- **Indentation:** 4 spaces (no tabs)
- **Semantic elements:** Use `<header>`, `<main>`, `<nav>`, `<section>`, `<article>`
- **Accessibility:** Include `aria-*` attributes and `role` where appropriate
- **Naming:** `kebab-case` for IDs and classes
- **Quotes:** Double quotes for attribute values

## Project Structure

```
smart-home-planner/
├── config.yaml          # Home Assistant add-on configuration
├── Dockerfile           # Container build instructions
├── run.sh               # Entry point script
├── server.py            # Python HTTP server (UI + API)
├── registry-sync.js     # Node.js WebSocket sync worker
├── ha-device-update.js  # Node.js script for updating HA devices
├── package.json         # Node.js dependencies
├── src/                 # Frontend files
│   ├── index.html       # Main dashboard
│   ├── devices.html     # Device list page
│   ├── device-add.html  # Add device form
│   ├── device-edit.html # Edit device form
│   ├── settings.html    # Settings page
│   ├── js/              # JavaScript modules
│   ├── css/             # Stylesheets
│   └── img/             # Images and icons
└── website/             # Marketing website (Firebase hosted)
```

## Home Assistant Integration

- **WebSocket API:** Uses `home-assistant-js-websocket` library for real-time sync
- **Authentication:** `SUPERVISOR_TOKEN` environment variable for API access
- **Registries:** Syncs areas, floors, and devices from Home Assistant
- **Ingress:** Configured in `config.yaml` with `ingress: true` and `ingress_port: 80`
- **API Base Path:** Use `buildAppUrl()` from `common.js` to handle ingress path prefixing

## Import Conventions

### Python
```python
# Standard library
import datetime
import json
import os
import threading

# Third-party (none in this project currently)
```

### JavaScript
```javascript
// Node.js builtins with node: prefix
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Third-party
import WebSocket from "ws";
import { createConnection } from "home-assistant-js-websocket";
```

## Error Handling Patterns

### Python
- Catch specific exceptions, not bare `except:`
- Return sensible defaults (e.g., `{}` for failed JSON parse, `[]` for failed list loads)
- Log errors before returning defaults
- Use `raise ValueError("message")` for input validation

### JavaScript
- Use `try`/`catch` with `async`/`await`
- Log errors with `console.error()` including context
- Return empty arrays/objects on failure for graceful degradation
- Throw `Error` objects with descriptive messages

## Security Considerations

- **Path traversal:** Always validate and normalize file paths using `os.path.realpath()` and check they're within allowed directories
- **File uploads:** Enforce `MAX_UPLOAD_FILE_BYTES` (20MB default) and `MAX_IMPORT_ARCHIVE_BYTES` (300MB)
- **Input sanitization:** Use `FILENAME_SAFE_PATTERN` regex for file/device IDs
- **Token handling:** Never log or expose `SUPERVISOR_TOKEN`; read only from environment
- **CORS:** API endpoints handle OPTIONS preflight for cross-origin requests

## Data Persistence

- All app data stored in `/data` volume (backed up by Home Assistant)
- Main data file: `/data/data.json`
- Device attachments: `/data/device-files/<device_id>/`
- Registry files: `/data/areas.json`, `/data/floors.json`, `/data/devices.json`
- Atomic writes: Write to `.tmp` file, then `os.replace()` for crash safety
