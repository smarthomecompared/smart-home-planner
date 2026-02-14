#!/usr/bin/env python3
import json
import os
import threading
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler

DATA_FILE = os.environ.get("SHP_DATA_FILE", "/data/smart-home-planner.json")
WEB_ROOT = os.environ.get("SHP_WEB_ROOT", "/srv")
HOST = os.environ.get("SHP_HOST", "")
PORT = int(os.environ.get("SHP_PORT", "80"))

_lock = threading.Lock()


def _read_storage():
    if not os.path.exists(DATA_FILE):
        return {}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def _write_storage(payload):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    tmp_path = f"{DATA_FILE}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp_path, DATA_FILE)


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/storage"):
            with _lock:
                payload = _read_storage()
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_PUT(self):
        if not self.path.startswith("/api/storage"):
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
        if self.path.startswith("/api/storage"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(404)


def main():
    handler = partial(AppHandler, directory=WEB_ROOT)
    server = HTTPServer((HOST, PORT), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
