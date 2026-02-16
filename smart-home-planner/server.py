#!/usr/bin/env python3
import datetime
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import threading
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlparse

DATA_FILE = os.environ.get("SHP_DATA_FILE", "/data/data.json")
DATA_DIR = os.path.dirname(DATA_FILE) or "/data"
DEVICE_FILES_DIR = os.path.join(DATA_DIR, "device-files")
AREAS_FILE = os.path.join(DATA_DIR, "areas.json")
FLOORS_FILE = os.path.join(DATA_DIR, "floors.json")
DEVICES_FILE = os.path.join(DATA_DIR, "devices.json")
WEB_ROOT = os.environ.get("SHP_WEB_ROOT", "/srv")
HOST = os.environ.get("SHP_HOST", "")
PORT = int(os.environ.get("SHP_PORT", "80"))
NODE_BIN = os.environ.get("SHP_NODE_BIN", "node")
HA_DEVICE_UPDATE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ha-device-update.js")
HOSTNAME = os.environ.get("HOSTNAME", "unknown")
HOSTNAME_NORMALIZED = HOSTNAME.strip().lower()
IS_LOCAL_RUNTIME = HOSTNAME_NORMALIZED.startswith("local_") or HOSTNAME_NORMALIZED.startswith("local-")
MAX_DEBUG_FILE_BYTES = 1024 * 1024 * 2
MAX_UPLOAD_FILE_BYTES = int(os.environ.get("SHP_MAX_UPLOAD_FILE_BYTES", str(20 * 1024 * 1024)))
MAX_IMPORT_ARCHIVE_BYTES = int(os.environ.get("SHP_MAX_IMPORT_ARCHIVE_BYTES", str(300 * 1024 * 1024)))
FILENAME_SAFE_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")

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


def _sanitize_device_id(value):
    normalized = FILENAME_SAFE_PATTERN.sub("_", str(value or "").strip())
    normalized = normalized.strip("._")
    if not normalized:
        raise ValueError("Missing or invalid device id")
    return normalized


def _sanitize_file_name(value):
    raw_name = str(value or "").strip()
    if not raw_name:
        raw_name = "file"
    raw_name = os.path.basename(raw_name.replace("\\", "/"))
    safe_name = FILENAME_SAFE_PATTERN.sub("_", raw_name).strip("._")
    if not safe_name:
        safe_name = "file"
    return safe_name


def _build_file_reference(relative_path, original_name, content_type, size):
    safe_path = str(relative_path or "").strip().replace("\\", "/")
    display_name = os.path.basename(str(original_name or "").replace("\\", "/")).strip()
    safe_name = _sanitize_file_name(display_name)
    mime_type = str(content_type or "").strip() or (mimetypes.guess_type(safe_name)[0] or "application/octet-stream")
    return {
        "id": f"file-{secrets.token_hex(8)}",
        "name": display_name or safe_name,
        "path": safe_path,
        "mimeType": mime_type,
        "size": int(size),
        "uploadedAt": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "isImage": mime_type.lower().startswith("image/"),
    }


def _save_device_file(device_id, file_name, content_type, file_bytes):
    safe_device_id = _sanitize_device_id(device_id)
    original_name = str(file_name or "").strip()
    safe_file_name = _sanitize_file_name(original_name)
    stem, extension = os.path.splitext(safe_file_name)
    unique_name = f"{stem}-{int(datetime.datetime.utcnow().timestamp())}-{secrets.token_hex(3)}{extension}"

    target_dir = os.path.join(DEVICE_FILES_DIR, safe_device_id)
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, unique_name)

    with open(target_path, "wb") as handle:
        handle.write(file_bytes)

    relative_path = os.path.relpath(target_path, DATA_DIR).replace(os.sep, "/")
    return _build_file_reference(relative_path, original_name or safe_file_name, content_type, len(file_bytes))


def _resolve_device_file(relative_path):
    normalized = os.path.normpath(str(relative_path or "")).replace("\\", "/").lstrip("/")
    if not normalized:
        raise ValueError("Missing file path")
    if normalized.startswith("..") or "/../" in f"/{normalized}/":
        raise ValueError("Invalid file path")
    if not normalized.startswith("device-files/"):
        raise ValueError("Invalid file path")

    files_dir_real = os.path.realpath(DEVICE_FILES_DIR)
    full_path = os.path.realpath(os.path.join(DATA_DIR, normalized))
    if full_path != files_dir_real and not full_path.startswith(f"{files_dir_real}{os.sep}"):
        raise ValueError("Invalid file path")
    if not os.path.isfile(full_path):
        raise FileNotFoundError(normalized)
    return full_path, normalized


def _iter_device_files_for_export():
    if not os.path.isdir(DEVICE_FILES_DIR):
        return []
    entries = []
    for root, _dirs, files in os.walk(DEVICE_FILES_DIR):
        for filename in files:
            if filename.endswith(".tmp"):
                continue
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, DATA_DIR).replace(os.sep, "/")
            entries.append((full_path, rel_path))
    return sorted(entries, key=lambda item: item[1].lower())


def _create_export_archive():
    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d-%H-%M-%S")
    archive_name = f"samart-home-planner-{timestamp}.tar"
    archive_file = tempfile.NamedTemporaryFile(prefix="smart-home-export-", suffix=".tar", delete=False)
    archive_path = archive_file.name
    archive_file.close()

    data_file_real = os.path.realpath(DATA_FILE)
    try:
        with tarfile.open(archive_path, "w") as tar_handle:
            if os.path.isfile(data_file_real):
                tar_handle.add(data_file_real, arcname="data.json", recursive=False)
            for full_path, rel_path in _iter_device_files_for_export():
                full_real = os.path.realpath(full_path)
                tar_handle.add(full_real, arcname=rel_path, recursive=False)
    except Exception:
        try:
            os.remove(archive_path)
        except OSError:
            pass
        raise

    return archive_path, archive_name


def _normalize_archive_member_path(value):
    normalized = os.path.normpath(str(value or "").replace("\\", "/")).replace("\\", "/")
    normalized = normalized.lstrip("/")
    if not normalized or normalized in {".", ".."}:
        raise ValueError("Invalid archive entry path")
    if normalized.startswith("..") or "/../" in f"/{normalized}/":
        raise ValueError("Invalid archive entry path")
    return normalized


def _import_archive_bytes(archive_bytes):
    if not archive_bytes:
        raise ValueError("Missing archive payload")

    with tempfile.TemporaryDirectory(prefix="smart-home-import-") as temp_dir:
        stage_root = os.path.join(temp_dir, "stage")
        os.makedirs(stage_root, exist_ok=True)
        stage_root_real = os.path.realpath(stage_root)

        imported_storage = None
        imported_files = 0

        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:*") as tar_handle:
            for member in tar_handle.getmembers():
                if not member.isfile():
                    continue
                safe_path = _normalize_archive_member_path(member.name)
                if safe_path == "data.json":
                    extracted = tar_handle.extractfile(member)
                    if extracted is None:
                        raise ValueError("Invalid data.json entry in archive")
                    raw_payload = extracted.read()
                    try:
                        parsed_storage = json.loads(raw_payload.decode("utf-8"))
                    except Exception as error:
                        raise ValueError("Invalid data.json in archive") from error
                    if not isinstance(parsed_storage, dict):
                        raise ValueError("Invalid data.json in archive")
                    imported_storage = parsed_storage
                    continue

                if not safe_path.startswith("device-files/"):
                    # Ignore non-device-files payloads in import archives.
                    continue

                extracted = tar_handle.extractfile(member)
                if extracted is None:
                    continue
                target_path = os.path.realpath(os.path.join(stage_root, safe_path))
                if target_path != stage_root_real and not target_path.startswith(f"{stage_root_real}{os.sep}"):
                    raise ValueError("Invalid archive entry path")
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, "wb") as handle:
                    handle.write(extracted.read())
                imported_files += 1

        if imported_storage is None:
            raise ValueError("Archive must contain data.json")

        _write_storage(imported_storage)

        staged_device_files = os.path.join(stage_root, "device-files")
        if os.path.isdir(DEVICE_FILES_DIR):
            shutil.rmtree(DEVICE_FILES_DIR, ignore_errors=True)
        if os.path.isdir(staged_device_files):
            shutil.copytree(staged_device_files, DEVICE_FILES_DIR)
        else:
            os.makedirs(DEVICE_FILES_DIR, exist_ok=True)

        imported_devices = imported_storage.get("devices")
        imported_device_count = len(imported_devices) if isinstance(imported_devices, list) else 0
        return {"devices": imported_device_count, "files": imported_files}


def _remove_file_and_empty_parents(full_path):
    os.remove(full_path)
    root_dir = os.path.realpath(DEVICE_FILES_DIR)
    parent = os.path.dirname(full_path)
    while parent and parent.startswith(f"{root_dir}{os.sep}"):
        try:
            if os.listdir(parent):
                break
            os.rmdir(parent)
        except OSError:
            break
        parent = os.path.dirname(parent)


def _rename_device_file(relative_path, new_name):
    full_path, _ = _resolve_device_file(relative_path)
    requested_name = os.path.basename(str(new_name or "").replace("\\", "/")).strip()
    if not requested_name:
        raise ValueError("Missing new file name")

    current_dir = os.path.dirname(full_path)
    current_base = os.path.basename(full_path)
    _, current_ext = os.path.splitext(current_base)

    safe_base = _sanitize_file_name(requested_name)
    safe_stem, safe_ext = os.path.splitext(safe_base)
    if not safe_ext and current_ext:
        safe_base = f"{safe_base}{current_ext}"
    if not safe_stem:
        safe_base = f"file{current_ext or ''}"

    target_path = os.path.join(current_dir, safe_base)
    if os.path.realpath(target_path) != os.path.realpath(full_path) and os.path.exists(target_path):
        suffix = secrets.token_hex(2)
        stem, ext = os.path.splitext(safe_base)
        target_path = os.path.join(current_dir, f"{stem}-{suffix}{ext}")

    if os.path.realpath(target_path) != os.path.realpath(full_path):
        os.replace(full_path, target_path)
    file_size = os.path.getsize(target_path)
    relative = os.path.relpath(target_path, DATA_DIR).replace(os.sep, "/")
    return _build_file_reference(relative, requested_name, "", file_size)


def _update_ha_device_name(device_id, device_name):
    normalized_id = str(device_id or "").strip()
    normalized_name = str(device_name or "").strip()
    if not normalized_id:
        raise ValueError("Missing device id")
    if not normalized_name:
        raise ValueError("Missing device name")
    if not os.path.isfile(HA_DEVICE_UPDATE_SCRIPT):
        raise RuntimeError("Home Assistant device update script is missing")

    command = [
        NODE_BIN,
        HA_DEVICE_UPDATE_SCRIPT,
        "--id",
        normalized_id,
        "--name",
        normalized_name,
    ]

    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Timed out while updating Home Assistant device name") from error
    except subprocess.CalledProcessError as error:
        stderr = (error.stderr or "").strip()
        stdout = (error.stdout or "").strip()
        detail = stderr or stdout or str(error)
        raise RuntimeError(detail) from error

    output = (completed.stdout or "").strip()
    if not output:
        return {}
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"raw": output}


def _update_ha_device_area(device_id, area_id):
    normalized_id = str(device_id or "").strip()
    normalized_area = str(area_id or "").strip()
    if not normalized_id:
        raise ValueError("Missing device id")
    if not os.path.isfile(HA_DEVICE_UPDATE_SCRIPT):
        raise RuntimeError("Home Assistant device update script is missing")

    command = [
        NODE_BIN,
        HA_DEVICE_UPDATE_SCRIPT,
        "--id",
        normalized_id,
        "--area-id",
        normalized_area,
    ]

    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Timed out while updating Home Assistant device area") from error
    except subprocess.CalledProcessError as error:
        stderr = (error.stderr or "").strip()
        stdout = (error.stdout or "").strip()
        detail = stderr or stdout or str(error)
        raise RuntimeError(detail) from error

    output = (completed.stdout or "").strip()
    if not output:
        return {}
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"raw": output}


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

        if path == "/api/ha/devices":
            with _lock:
                payload = _read_registry(DEVICES_FILE)
            self._send_json(200, payload)
            return

        if path == "/api/export":
            archive_path = ""
            try:
                with _lock:
                    archive_path, archive_name = _create_export_archive()
                archive_size = os.path.getsize(archive_path)
                self.send_response(200)
                self.send_header("Content-Type", "application/x-tar")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Disposition", f'attachment; filename="{archive_name}"')
                self.send_header("Content-Length", str(archive_size))
                self.end_headers()
                with open(archive_path, "rb") as handle:
                    while True:
                        chunk = handle.read(1024 * 64)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                return
            except Exception as error:
                self._send_json(500, {"error": f"Unable to create export archive: {error}"})
                return
            finally:
                if archive_path:
                    try:
                        os.remove(archive_path)
                    except OSError:
                        pass

        if path == "/api/device-files/content":
            requested_path = (query.get("path") or [""])[0]
            download_mode = ((query.get("download") or [""])[0]).strip().lower() in {"1", "true", "yes"}
            try:
                full_path, safe_path = _resolve_device_file(requested_path)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            except FileNotFoundError:
                self._send_json(404, {"error": "File not found"})
                return

            try:
                file_size = os.path.getsize(full_path)
                file_name = os.path.basename(safe_path).replace('"', "_")
                content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
                disposition = "attachment" if download_mode else "inline"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Disposition", f'{disposition}; filename="{file_name}"')
                self.send_header("Content-Length", str(file_size))
                self.end_headers()
                with open(full_path, "rb") as handle:
                    while True:
                        chunk = handle.read(1024 * 64)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                return
            except OSError as error:
                self._send_json(500, {"error": f"Unable to read file: {error}"})
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

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/import":
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            if content_length <= 0:
                self._send_json(400, {"error": "Missing archive payload"})
                return
            if content_length > MAX_IMPORT_ARCHIVE_BYTES:
                self._send_json(
                    413,
                    {"error": f"Archive is too large. Max allowed is {MAX_IMPORT_ARCHIVE_BYTES} bytes."},
                )
                return

            try:
                body = self.rfile.read(content_length)
                with _lock:
                    result = _import_archive_bytes(body)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            except tarfile.ReadError:
                self._send_json(400, {"error": "Invalid TAR archive"})
                return
            except OSError as error:
                self._send_json(500, {"error": f"Unable to import archive: {error}"})
                return

            self._send_json(200, {"ok": True, "result": result})
            return

        if parsed.path != "/api/device-files/upload":
            self.send_error(404)
            return

        query = parse_qs(parsed.query)
        device_id = (query.get("deviceId") or [""])[0]
        encoded_name = self.headers.get("X-File-Name", "")
        file_name = unquote(encoded_name).strip() or "file"
        content_type = self.headers.get("Content-Type", "").strip() or "application/octet-stream"
        content_length = int(self.headers.get("Content-Length", "0") or "0")

        if content_length <= 0:
            self._send_json(400, {"error": "Missing file payload"})
            return
        if content_length > MAX_UPLOAD_FILE_BYTES:
            self._send_json(413, {"error": f"File is too large. Max allowed is {MAX_UPLOAD_FILE_BYTES} bytes."})
            return

        try:
            body = self.rfile.read(content_length)
            with _lock:
                payload = _save_device_file(device_id, file_name, content_type, body)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self._send_json(500, {"error": f"Unable to save file: {error}"})
            return

        self._send_json(201, payload)

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/device-files/rename":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return

            file_path = str(payload.get("path") or "").strip()
            new_name = str(payload.get("name") or "").strip()
            if not file_path:
                self._send_json(400, {"error": "Missing required field: path"})
                return
            if not new_name:
                self._send_json(400, {"error": "Missing required field: name"})
                return

            try:
                with _lock:
                    result = _rename_device_file(file_path, new_name)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            except FileNotFoundError:
                self._send_json(404, {"error": "File not found"})
                return
            except OSError as error:
                self._send_json(500, {"error": f"Unable to rename file: {error}"})
                return

            self._send_json(200, {"ok": True, "file": result})
            return

        if parsed.path == "/api/ha/device-name":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return

            device_id = str(payload.get("id") or "").strip()
            device_name = str(payload.get("name") or "").strip()
            if not device_id:
                self._send_json(400, {"error": "Missing required field: id"})
                return
            if not device_name:
                self._send_json(400, {"error": "Missing required field: name"})
                return

            try:
                result = _update_ha_device_name(device_id, device_name)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            except RuntimeError as error:
                message = str(error)
                status = 503 if "SUPERVISOR_TOKEN" in message else 502
                self._send_json(status, {"error": message})
                return

            self._send_json(200, {"ok": True, "result": result})
            return

        if parsed.path == "/api/ha/device-area":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return

            device_id = str(payload.get("id") or "").strip()
            area_id = str(payload.get("areaId") or "").strip()
            if not device_id:
                self._send_json(400, {"error": "Missing required field: id"})
                return

            try:
                result = _update_ha_device_area(device_id, area_id)
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            except RuntimeError as error:
                message = str(error)
                status = 503 if "SUPERVISOR_TOKEN" in message else 502
                self._send_json(status, {"error": message})
                return

            self._send_json(200, {"ok": True, "result": result})
            return

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

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/device-files":
            self.send_error(404)
            return

        query = parse_qs(parsed.query)
        requested_path = (query.get("path") or [""])[0]
        try:
            with _lock:
                full_path, _ = _resolve_device_file(requested_path)
                _remove_file_and_empty_parents(full_path)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except FileNotFoundError:
            self._send_json(404, {"error": "File not found"})
            return
        except OSError as error:
            self._send_json(500, {"error": f"Unable to delete file: {error}"})
            return

        self.send_response(204)
        self.end_headers()

    def do_OPTIONS(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-File-Name")
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
