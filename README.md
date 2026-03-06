# Smart Home Planner Stats Dashboard

Static dashboard with installation/version history for the add-on.

## Requirements

- Node.js 18+ (20+ recommended)
- npm
- Python 3 (for a simple local server)

## Run locally

1. Install dependencies:

```bash
npm install
```

2. (Optional) Update `docs/history.json` with the latest data:

```bash
npm start
```

3. Start a local server serving `docs/`:

```bash
python3 -m http.server 8080 --directory docs
```

4. Open in your browser:

```text
http://localhost:8080
```

5. Stop the server with `Ctrl + C`.

## Note

Do not open `docs/index.html` directly with `file://`, because the dashboard uses `fetch("./history.json")` and must be served over HTTP.

## Troubleshooting (macOS)

If you get `OSError: [Errno 48] Address already in use`, port `8080` is already taken.

1. Use a different port:

```bash
python3 -m http.server 8081 --directory docs
```

Open `http://localhost:8081`.

2. Or free port `8080`:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
kill <PID>
# If needed:
kill -9 <PID>
```
