#!/usr/bin/env python3
import json
import os
import threading
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

DATA_FILE = os.environ.get("SHP_DATA_FILE", "/data/data.json")
DATA_DIR = os.path.dirname(DATA_FILE) or "/data"
AREAS_FILE = os.path.join(DATA_DIR, "areas.json")
FLOORS_FILE = os.path.join(DATA_DIR, "floors.json")
WEB_ROOT = os.environ.get("SHP_WEB_ROOT", "/srv")
HOST = os.environ.get("SHP_HOST", "")
PORT = int(os.environ.get("SHP_PORT", "80"))
HOSTNAME = os.environ.get("HOSTNAME", "unknown")
HOSTNAME_NORMALIZED = HOSTNAME.strip().lower()
IS_LOCAL_RUNTIME = HOSTNAME_NORMALIZED.startswith("local_") or HOSTNAME_NORMALIZED.startswith("local-")
MAX_DEBUG_FILE_BYTES = 1024 * 1024 * 2

_lock = threading.Lock()


def _read_storage():
    if not os.path.exists(DATA_FILE):
        return {}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def _read_registry(path):
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def _write_storage(payload):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    tmp_path = f"{DATA_FILE}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp_path, DATA_FILE)


def _is_json_text(text):
    try:
        json.loads(text)
        return True
    except Exception:
        return False


def _list_data_files():
    if not os.path.isdir(DATA_DIR):
        return []
    entries = []
    for root, _dirs, files in os.walk(DATA_DIR):
        for filename in files:
            full_path = os.path.join(root, filename)
            try:
                stat = os.stat(full_path)
            except OSError:
                continue
            rel_path = os.path.relpath(full_path, DATA_DIR).replace(os.sep, "/")
            entries.append(
                {
                    "name": rel_path,
                    "size": stat.st_size,
                    "modifiedAt": int(stat.st_mtime),
                }
            )
    return sorted(entries, key=lambda item: item["name"].lower())


def _resolve_data_file(name):
    if not name:
        raise ValueError("Missing file name")
    normalized = os.path.normpath(str(name)).replace("\\", "/")
    normalized = normalized.lstrip("/")
    if normalized.startswith("..") or "/../" in f"/{normalized}/":
        raise ValueError("Invalid file path")

    data_dir_real = os.path.realpath(DATA_DIR)
    full_path = os.path.realpath(os.path.join(DATA_DIR, normalized))
    if full_path != data_dir_real and not full_path.startswith(f"{data_dir_real}{os.sep}"):
        raise ValueError("Invalid file path")
    if not os.path.isfile(full_path):
        raise FileNotFoundError(normalized)
    return full_path, normalized


class AppHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/storage":
            with _lock:
                payload = _read_storage()
            self._send_json(200, payload)
            return

        if path == "/api/runtime":
            self._send_json(
                200,
                {
                    "hostname": HOSTNAME,
                    "isLocalRuntime": IS_LOCAL_RUNTIME,
                    "isAddonRuntime": not IS_LOCAL_RUNTIME,
                },
            )
            return

        if path == "/api/ha/areas":
            with _lock:
                payload = _read_registry(AREAS_FILE)
            self._send_json(200, payload)
            return

        if path == "/api/ha/floors":
            with _lock:
                payload = _read_registry(FLOORS_FILE)
            self._send_json(200, payload)
            return

        if path == "/api/debug/files":
            if not IS_LOCAL_RUNTIME:
                self._send_json(403, {"error": "Debug API is only available in local runtime"})
                return
            self._send_json(200, {"files": _list_data_files()})
            return

        if path == "/api/debug/file":
            if not IS_LOCAL_RUNTIME:
                self._send_json(403, {"error": "Debug API is only available in local runtime"})
                return
            name = (query.get("name") or [""])[0]
            try:
                full_path, safe_name = _resolve_data_file(name)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            except FileNotFoundError:
                self._send_json(404, {"error": "File not found"})
                return
            try:
                size = os.path.getsize(full_path)
                if size > MAX_DEBUG_FILE_BYTES:
                    self._send_json(
                        413,
                        {
                            "error": f"File is too large ({size} bytes). Max allowed is {MAX_DEBUG_FILE_BYTES} bytes."
                        },
                    )
                    return
                with open(full_path, "rb") as handle:
                    raw = handle.read()
                content = raw.decode("utf-8", errors="replace")
                self._send_json(
                    200,
                    {
                        "name": safe_name,
                        "size": size,
                        "isJson": _is_json_text(content),
                        "content": content,
                    },
                )
                return
            except OSError as error:
                self._send_json(500, {"error": f"Unable to read file: {error}"})
                return

        super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/storage":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return
        with _lock:
            _write_storage(payload)
        self.send_response(204)
        self.end_headers()

    def do_OPTIONS(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(404)


def main():
    mode_label = "LOCAL DEVELOPMENT" if IS_LOCAL_RUNTIME else "PRODUCTION"
    print(f"[runtime] HOSTNAME={HOSTNAME} | Mode: {mode_label}", flush=True)
    handler = partial(AppHandler, directory=WEB_ROOT)
    server = HTTPServer((HOST, PORT), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
