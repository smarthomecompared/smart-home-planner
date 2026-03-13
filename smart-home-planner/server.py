#!/usr/bin/env python3
import datetime
import hashlib
import io
import json
import math
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
from urllib.request import Request, urlopen

DATA_FILE = os.environ.get("SHP_DATA_FILE", "/data/data.json")
DATA_DIR = os.path.dirname(DATA_FILE) or "/data"
DEVICE_FILES_DIR = os.path.join(DATA_DIR, "device-files")
AREAS_FILE = os.path.join(DATA_DIR, "areas.json")
FLOORS_FILE = os.path.join(DATA_DIR, "floors.json")
DEVICES_FILE = os.path.join(DATA_DIR, "devices.json")
LABELS_FILE = os.path.join(DATA_DIR, "labels.json")
BACKUPS_DEBUG_FILE = os.path.join(DATA_DIR, "backups.json")
WEB_ROOT = os.environ.get("SHP_WEB_ROOT", "/srv")
HOST = os.environ.get("SHP_HOST", "")
PORT = int(os.environ.get("SHP_PORT", "80"))
NODE_BIN = os.environ.get("SHP_NODE_BIN", "node")
HA_DEVICE_UPDATE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ha-device-update.js")
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
SUPERVISOR_CORE_URL = os.environ.get("SUPERVISOR_CORE_URL", "http://supervisor/core")
SUPERVISOR_API_URL = os.environ.get("SUPERVISOR_API_URL", "http://supervisor")
HOSTNAME = os.environ.get("HOSTNAME", "unknown")
HOSTNAME_NORMALIZED = HOSTNAME.strip().lower()
IS_LOCAL_RUNTIME = HOSTNAME_NORMALIZED.startswith("local_") or HOSTNAME_NORMALIZED.startswith("local-")
MAX_DEBUG_FILE_BYTES = 1024 * 1024 * 2
MAX_UPLOAD_FILE_BYTES = int(os.environ.get("SHP_MAX_UPLOAD_FILE_BYTES", str(20 * 1024 * 1024)))
MAX_IMPORT_ARCHIVE_BYTES = int(os.environ.get("SHP_MAX_IMPORT_ARCHIVE_BYTES", str(300 * 1024 * 1024)))
FILENAME_SAFE_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")
SMART_HOME_PLANNER_ADDON_SLUG = "1750ef26_smart-home-planner"

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


def _build_storage_etag(payload):
    try:
        canonical = json.dumps(
            payload if isinstance(payload, dict) else {},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    except Exception:
        canonical = "{}"
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"\"{digest}\""


def _if_match_allows_current(if_match_header, current_etag):
    raw_header = str(if_match_header or "").strip()
    if not raw_header:
        return True

    for raw_token in raw_header.split(","):
        token = raw_token.strip()
        if not token:
            continue
        if token == "*":
            return True
        if token.startswith("W/"):
            token = token[2:].strip()
        if token == current_etag:
            return True

    return False


def _parse_optional_float(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _validate_storage_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid storage payload")
    devices = payload.get("devices")
    if not isinstance(devices, list):
        return

    fields = (
        ("idleConsumption", "Idle consumption"),
        ("meanConsumption", "Mean consumption"),
        ("maxConsumption", "Max consumption"),
    )

    for device in devices:
        if not isinstance(device, dict):
            continue
        device_name = str(device.get("name") or "").strip()
        if not device_name:
            device_name = str(device.get("id") or "").strip() or "Unnamed"
        for key, label in fields:
            parsed = _parse_optional_float(device.get(key))
            if parsed is None:
                continue
            if parsed < 0:
                raise ValueError(f"{label} cannot be negative (device: {device_name})")


def _write_backups_debug(payload):
    os.makedirs(os.path.dirname(BACKUPS_DEBUG_FILE), exist_ok=True)
    tmp_path = f"{BACKUPS_DEBUG_FILE}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp_path, BACKUPS_DEBUG_FILE)


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
    archive_name = f"smart-home-planner-{timestamp}.tar"
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


def _update_ha_device_labels(device_id, labels):
    normalized_id = str(device_id or "").strip()
    if not normalized_id:
        raise ValueError("Missing device id")
    if not os.path.isfile(HA_DEVICE_UPDATE_SCRIPT):
        raise RuntimeError("Home Assistant device update script is missing")

    label_list = labels if isinstance(labels, list) else []
    normalized_labels = [str(value or "").strip() for value in label_list]
    normalized_labels = [value for value in normalized_labels if value]

    command = [
        NODE_BIN,
        HA_DEVICE_UPDATE_SCRIPT,
        "--id",
        normalized_id,
        "--labels",
        json.dumps(normalized_labels),
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
        raise RuntimeError("Timed out while updating Home Assistant device labels") from error
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


def _fetch_ha_config():
    if not SUPERVISOR_TOKEN:
        raise RuntimeError("SUPERVISOR_TOKEN is missing")
    base_url = str(SUPERVISOR_CORE_URL or "http://supervisor/core").rstrip("/")
    url = f"{base_url}/api/config"
    request = Request(url, headers={"Authorization": f"Bearer {SUPERVISOR_TOKEN}"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = response.read().decode("utf-8") or "{}"
    except Exception as error:
        raise RuntimeError(f"Failed to load Home Assistant config: {error}") from error
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {"raw": payload}


def _fetch_supervisor_json(path):
    if not SUPERVISOR_TOKEN:
        raise RuntimeError("SUPERVISOR_TOKEN is missing")
    base_url = str(SUPERVISOR_API_URL or "http://supervisor").rstrip("/")
    normalized_path = str(path or "").strip()
    if not normalized_path.startswith("/"):
        normalized_path = f"/{normalized_path}"
    url = f"{base_url}{normalized_path}"
    request = Request(url, headers={"Authorization": f"Bearer {SUPERVISOR_TOKEN}"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = response.read().decode("utf-8") or "{}"
    except Exception as error:
        raise RuntimeError(f"Failed to load Supervisor data from {normalized_path}: {error}") from error
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {"raw": payload}


def _call_ha_service(domain, service, payload):
    if not SUPERVISOR_TOKEN:
        return
    base_url = str(SUPERVISOR_CORE_URL or "http://supervisor/core").rstrip("/")
    url = f"{base_url}/api/services/{domain}/{service}"
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        response.read()


def _send_or_dismiss_notification(notification_id, title, message, active):
    try:
        if active:
            _call_ha_service("persistent_notification", "create", {
                "notification_id": notification_id,
                "title": title,
                "message": message,
            })
        else:
            _call_ha_service("persistent_notification", "dismiss", {
                "notification_id": notification_id,
            })
    except Exception:
        pass


def _notif_check_battery(devices, state):
    """Returns ("send"|"dismiss"|"skip", message, next_state).
    Tracks overdue vs due-soon devices separately. Fires when new devices appear in either
    group, and re-fires when a device graduates from due-soon to overdue (respecting dismiss
    for devices already notified at the same level)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    overdue_devices = {}   # id -> name: days_since > duration (past replacement date)
    soon_devices = {}      # id -> name: 0.8 <= ratio < 1.0 (approaching replacement date)
    for device in devices:
        last_str = device.get("lastBatteryChange")
        if not last_str:
            continue
        try:
            last = datetime.datetime.fromisoformat(str(last_str).replace("Z", "+00:00"))
            if last.tzinfo is None:
                last = last.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            continue
        duration = int(device.get("batteryDuration") or 730)
        if duration <= 0:
            continue
        days_since = (now - last).days
        ratio = days_since / duration
        device_id = str(device.get("id") or "").strip()
        if not device_id:
            continue
        if ratio >= 1.0:
            overdue_devices[device_id] = device.get("name") or "Unnamed"
        elif ratio >= 0.8:
            soon_devices[device_id] = device.get("name") or "Unnamed"

    all_alert_ids = set(overdue_devices) | set(soon_devices)
    prev_overdue = set(state.get("overdueIds") or [])
    prev_soon = set(state.get("soonIds") or [])
    prev_all = prev_overdue | prev_soon

    # Devices still alerting at the same level (or better — keeps tracking)
    clean_prev_overdue = prev_overdue & set(overdue_devices)
    clean_prev_soon = prev_soon & set(soon_devices)

    # New overdue: not yet in overdueIds (includes devices graduating from soonIds)
    new_overdue = set(overdue_devices) - clean_prev_overdue
    # New soon: not yet notified at any level, and not overdue
    new_soon = set(soon_devices) - (prev_soon | prev_overdue)
    new_ids = new_overdue | new_soon

    # Next state: devices that moved to overdue leave soonIds and join overdueIds
    next_overdue = sorted(clean_prev_overdue | new_overdue)
    next_soon = sorted((clean_prev_soon | new_soon) - set(overdue_devices))
    next_state = {"overdueIds": next_overdue, "soonIds": next_soon}

    if not all_alert_ids:
        action = "dismiss" if prev_all else "skip"
        return action, "", {"overdueIds": [], "soonIds": []}
    if new_ids:
        parts = []
        if overdue_devices:
            names = sorted(overdue_devices.values())
            parts.append(f"{len(names)} overdue: {', '.join(names)}")
        if soon_devices:
            names = sorted(soon_devices.values())
            parts.append(f"{len(names)} due soon: {', '.join(names)}")
        msg = "Battery replacement needed — " + "; ".join(parts) + "."
        return "send", msg, next_state
    return "skip", "", next_state


def _notif_check_warranty(devices, state):
    """Tracks per-device IDs. Fires only for newly expiring devices."""
    now = datetime.datetime.now(datetime.timezone.utc).date()
    alert_devices = {}
    for device in devices:
        exp_str = device.get("warrantyExpiration")
        if not exp_str:
            continue
        try:
            exp = datetime.date.fromisoformat(str(exp_str)[:10])
        except Exception:
            continue
        days_until = (exp - now).days
        if 0 <= days_until <= 90:
            device_id = str(device.get("id") or "").strip()
            if device_id:
                alert_devices[device_id] = (device.get("name") or "Unnamed", days_until)
    alert_ids = set(alert_devices)
    prev_notified = set(state.get("notifiedIds") or [])
    clean_prev = prev_notified & alert_ids
    new_ids = alert_ids - clean_prev
    if not alert_ids:
        action = "dismiss" if prev_notified else "skip"
        return action, "", {"notifiedIds": []}
    if new_ids:
        all_sorted = sorted(alert_devices.items(), key=lambda x: x[1][1])
        names = [v[0] for _, v in all_sorted]
        count = len(names)
        msg = f"{count} device{'s' if count != 1 else ''} {'have' if count != 1 else 'has'} warranty expiring within 90 days: {', '.join(names)}."
        return "send", msg, {"notifiedIds": sorted(clean_prev | new_ids)}
    return "skip", "", {"notifiedIds": sorted(clean_prev)}


def _notif_check_backup(state):
    """7-day cooldown after each send. Re-sends after 7 days if warning persists."""
    try:
        status = _build_backup_status_payload(write_debug_dump=False)
    except Exception:
        return "skip", "", state
    stale = not status.get("hasRecentBackup", True)
    missing_addon = not status.get("hasRecentBackupWithRequiredAddon", True)
    stale_days = status.get("staleAfterDays", 7)
    active = stale or missing_addon
    if not active:
        action = "dismiss" if state.get("lastSentAt") else "skip"
        return action, "", {"lastSentAt": None}
    last_sent_str = state.get("lastSentAt")
    if last_sent_str:
        try:
            last_sent = datetime.datetime.fromisoformat(str(last_sent_str).replace("Z", "+00:00"))
            if last_sent.tzinfo is None:
                last_sent = last_sent.replace(tzinfo=datetime.timezone.utc)
            if (datetime.datetime.now(datetime.timezone.utc) - last_sent).days < 7:
                return "skip", "", state
        except Exception:
            pass
    msg = (
        f"Last Home Assistant backup is older than {stale_days} days."
        if stale else
        f"No backup from the last {stale_days} days includes the Smart Home Planner add-on."
    )
    now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return "send", msg, {"lastSentAt": now_str}


def _notif_check_tests(storage, state):
    """Tracks per-test-case IDs. Fires only for newly overdue/due-soon cases."""
    test_cases = [tc for tc in (storage.get("testCases") or []) if tc and tc.get("enabled") is not False]
    test_runs = storage.get("testCaseRuns") or []
    today = datetime.datetime.now(datetime.timezone.utc).date()
    runs_by_case = {}
    for run in test_runs:
        case_id = run.get("testCaseId")
        if not case_id:
            continue
        run_at_str = run.get("runAt") or run.get("createdAt")
        if not run_at_str:
            continue
        try:
            run_at = datetime.datetime.fromisoformat(str(run_at_str).replace("Z", "+00:00"))
            if run_at.tzinfo is None:
                run_at = run_at.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            continue
        existing = runs_by_case.get(case_id)
        if existing is None or run_at > existing["runAt"]:
            runs_by_case[case_id] = {"runAt": run_at}
    alert_cases = {}
    for tc in test_cases:
        tc_id = tc.get("id")
        if not tc_id:
            continue
        frequency = int(tc.get("frequencyDays") or 30)
        latest_run = runs_by_case.get(tc_id)
        if latest_run is None:
            alert_cases[str(tc_id)] = tc.get("name") or "Unnamed"
            continue
        next_due = (latest_run["runAt"] + datetime.timedelta(days=frequency)).date()
        days_until = (next_due - today).days
        if days_until < 0 or days_until <= 7:
            alert_cases[str(tc_id)] = tc.get("name") or "Unnamed"
    alert_ids = set(alert_cases)
    prev_notified = set(state.get("notifiedIds") or [])
    clean_prev = prev_notified & alert_ids
    new_ids = alert_ids - clean_prev
    if not alert_ids:
        action = "dismiss" if prev_notified else "skip"
        return action, "", {"notifiedIds": []}
    if new_ids:
        count = len(alert_ids)
        msg = f"{count} test case{'s' if count != 1 else ''} {'are' if count != 1 else 'is'} overdue or due soon."
        return "send", msg, {"notifiedIds": sorted(clean_prev | new_ids)}
    return "skip", "", {"notifiedIds": sorted(clean_prev)}


NOTIFICATION_CHECK_INTERVAL_SECONDS = 24 * 60 * 60


def _run_notification_checks():
    with _lock:
        storage = _read_storage()
    notif_settings = (storage.get("settings") or {}).get("notifications") or {}
    if not notif_settings.get("enabled", True):
        return {"skipped": True}
    types = notif_settings.get("types") or {}
    prev_state = dict(notif_settings.get("state") or {})
    devices = storage.get("devices") or []
    new_state = dict(prev_state)
    results = {}
    state_changed = False

    checks = [
        ("battery",  "shp_battery",  "Smart Home Planner — Batteries", lambda: _notif_check_battery(devices, prev_state.get("battery") or {})),
        ("warranty", "shp_warranty", "Smart Home Planner — Warranty",  lambda: _notif_check_warranty(devices, prev_state.get("warranty") or {})),
        ("backup",   "shp_backup",   "Smart Home Planner — Backup",    lambda: _notif_check_backup(prev_state.get("backup") or {})),
        ("tests",    "shp_tests",    "Smart Home Planner — Tests",     lambda: _notif_check_tests(storage, prev_state.get("tests") or {})),
    ]
    checks = [(k, n, t, fn) for k, n, t, fn in checks if types.get(k, True)]

    for key, notif_id, title, checker in checks:
        action, msg, next_key_state = checker()
        if action == "send":
            _send_or_dismiss_notification(notif_id, title, msg, True)
            results[key] = True
        elif action == "dismiss":
            _send_or_dismiss_notification(notif_id, title, "", False)
            results[key] = False
        else:
            results[key] = False
        if next_key_state != prev_state.get(key):
            new_state[key] = next_key_state
            state_changed = True

    if state_changed:
        with _lock:
            current = _read_storage()
            s = current.setdefault("settings", {})
            n = s.setdefault("notifications", {})
            n["state"] = new_state
            _write_storage(current)

    return results


def _schedule_notification_check():
    try:
        _run_notification_checks()
    except Exception:
        pass
    t = threading.Timer(NOTIFICATION_CHECK_INTERVAL_SECONDS, _schedule_notification_check)
    t.daemon = True
    t.start()


def _send_ha_test_notification():
    if not SUPERVISOR_TOKEN:
        raise RuntimeError("SUPERVISOR_TOKEN is missing")
    base_url = str(SUPERVISOR_CORE_URL or "http://supervisor/core").rstrip("/")
    url = f"{base_url}/api/services/persistent_notification/create"
    body = json.dumps({
        "title": "Smart Home Planner",
        "message": "Test notification from Smart Home Planner debug settings.",
        "notification_id": "shp_test_notification",
    }).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            response.read()
    except Exception as error:
        raise RuntimeError(f"Failed to send test notification: {error}") from error


def _unwrap_supervisor_data(payload):
    if isinstance(payload, dict) and isinstance(payload.get("data"), (dict, list)):
        return payload.get("data")
    return payload


def _extract_backups_list(payload):
    data = _unwrap_supervisor_data(payload)
    if isinstance(data, dict):
        if isinstance(data.get("backups"), list):
            return data.get("backups")
        if isinstance(data.get("snapshots"), list):
            return data.get("snapshots")
    if isinstance(data, list):
        return data
    return []


def _parse_datetime_utc(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc)


def _to_int_or_none(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _to_float_or_none(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _normalize_backup_type(value):
    normalized = str(value or "").strip().lower()
    if normalized in {"full", "partial"}:
        return normalized
    return ""


def _normalize_addon_slug(value):
    normalized = str(value or "").strip().lower().replace("_", "-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized.strip("-")


def _extract_backup_addons(raw):
    addon_sources = []
    top_level_addons = raw.get("addons")
    if isinstance(top_level_addons, list):
        addon_sources.append(top_level_addons)

    content_payload = raw.get("content")
    if isinstance(content_payload, dict):
        content_addons = content_payload.get("addons")
        if isinstance(content_addons, list):
            addon_sources.append(content_addons)

    if not addon_sources:
        return []

    result = []
    seen = set()
    for addons_raw in addon_sources:
        for item in addons_raw:
            addon_slug = ""
            if isinstance(item, str):
                addon_slug = item
            elif isinstance(item, dict):
                addon_slug = item.get("slug") or item.get("addon") or item.get("name") or ""
            normalized_slug = _normalize_addon_slug(addon_slug)
            if not normalized_slug or normalized_slug in seen:
                continue
            seen.add(normalized_slug)
            result.append(normalized_slug)
    return result


def _addons_include_slug(addons, target_slug):
    normalized_target = _normalize_addon_slug(target_slug)
    if not normalized_target:
        return False
    for addon_slug in addons:
        normalized_addon = _normalize_addon_slug(addon_slug)
        if not normalized_addon:
            continue
        if normalized_addon == normalized_target or normalized_addon.endswith(f"-{normalized_target}"):
            return True
    return False


def _backup_includes_required_addon(backup_entry, required_slug):
    if not isinstance(backup_entry, dict):
        return False
    backup_type = _normalize_backup_type(backup_entry.get("type"))
    if backup_type == "full":
        return True
    if backup_type != "partial":
        return False
    explicit = backup_entry.get("includesSmartHomePlannerAddon")
    if isinstance(explicit, bool):
        return explicit
    addons = backup_entry.get("addons") if isinstance(backup_entry.get("addons"), list) else []
    return _addons_include_slug(addons, required_slug)


def _normalize_location_value(value):
    if value is None:
        return ""
    normalized = str(value).strip()
    if not normalized:
        return ""
    if normalized.lower() in {"none", "null"}:
        return ""
    return normalized


def _normalize_backup_entry(raw):
    if not isinstance(raw, dict):
        return None
    date_value = str(raw.get("date") or "").strip()
    parsed_date = _parse_datetime_utc(date_value)
    size_bytes = _to_int_or_none(raw.get("size_bytes"))
    if size_bytes is None:
        size_mb = _to_float_or_none(raw.get("size"))
        if size_mb is not None:
            # Supervisor backup/snapshot models can report size in MB.
            size_bytes = int(size_mb * 1024 * 1024)
    backup_type = _normalize_backup_type(raw.get("type"))
    addons = _extract_backup_addons(raw)
    includes_smart_home_planner = None
    if backup_type == "full":
        includes_smart_home_planner = True
    elif backup_type == "partial":
        includes_smart_home_planner = _addons_include_slug(addons, SMART_HOME_PLANNER_ADDON_SLUG)
    locations = []
    seen_locations = set()

    def push_location(value):
        normalized = _normalize_location_value(value)
        if not normalized or normalized in seen_locations:
            return
        seen_locations.add(normalized)
        locations.append(normalized)

    push_location(raw.get("location"))
    for location_value in raw.get("locations") or []:
        push_location(location_value)
    location_attributes = raw.get("location_attributes")
    if isinstance(location_attributes, dict):
        for location_key in location_attributes.keys():
            push_location(location_key)

    primary_location = locations[0] if locations else ""
    return {
        "slug": str(raw.get("slug") or "").strip(),
        "name": str(raw.get("name") or "").strip(),
        "type": backup_type,
        "date": date_value,
        "parsedDate": parsed_date,
        "location": primary_location,
        "locations": locations,
        "protected": bool(raw.get("protected", False)),
        "compressed": bool(raw.get("compressed", False)),
        "sizeBytes": size_bytes,
        "addons": addons,
        "includesSmartHomePlannerAddon": includes_smart_home_planner,
    }


def _build_backup_status_payload(write_debug_dump=False):
    if not SUPERVISOR_TOKEN:
        raise RuntimeError("SUPERVISOR_TOKEN is missing")

    first_error = None
    debug_responses = {}

    def safe_fetch(path):
        nonlocal first_error
        try:
            payload = _fetch_supervisor_json(path)
            if write_debug_dump:
                debug_responses[path] = payload
            return payload
        except RuntimeError as error:
            if first_error is None:
                first_error = error
            return None

    info_payload = safe_fetch("/backups/info")
    backups_payload = safe_fetch("/backups")

    backups = _extract_backups_list(backups_payload)
    if not backups:
        backups = _extract_backups_list(info_payload)

    # Legacy fallback for older Supervisor versions that still expose snapshots payloads.
    if not backups:
        legacy_info_payload = safe_fetch("/snapshots/info")
        legacy_backups_payload = safe_fetch("/snapshots")
        backups = _extract_backups_list(legacy_backups_payload)
        if not backups:
            backups = _extract_backups_list(legacy_info_payload)

    if first_error is not None and not backups:
        if write_debug_dump:
            try:
                _write_backups_debug(debug_responses)
            except Exception:
                pass
        raise first_error

    normalized_backups = [_normalize_backup_entry(item) for item in backups]
    normalized_backups = [item for item in normalized_backups if item]

    total_backups = len(normalized_backups)
    total_full_backups = len([item for item in normalized_backups if item.get("type") == "full"])

    normalized_backups.sort(
        key=lambda item: item.get("parsedDate") or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc),
        reverse=True,
    )
    latest_backup = normalized_backups[0] if normalized_backups else None

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    latest_backup_age_days = None
    if latest_backup and latest_backup.get("parsedDate"):
        delta = now_utc - latest_backup.get("parsedDate")
        latest_backup_age_days = max(0, int(delta.total_seconds() // 86400))

    stale_after_days = 7
    has_recent_backup = latest_backup_age_days is not None and latest_backup_age_days <= stale_after_days
    has_recent_backup_with_required_addon = False
    for backup in normalized_backups:
        parsed_date = backup.get("parsedDate")
        if not parsed_date:
            continue
        age_days = max(0, int((now_utc - parsed_date).total_seconds() // 86400))
        if age_days > stale_after_days:
            continue
        if _backup_includes_required_addon(backup, SMART_HOME_PLANNER_ADDON_SLUG):
            has_recent_backup_with_required_addon = True
            break

    unique_locations = []
    seen_locations = set()
    for backup in normalized_backups:
        backup_locations = backup.get("locations") if isinstance(backup.get("locations"), list) else []
        for location_value in backup_locations:
            normalized = _normalize_location_value(location_value)
            if not normalized or normalized in seen_locations:
                continue
            seen_locations.add(normalized)
            unique_locations.append(normalized)

    if not unique_locations and total_backups > 0:
        unique_locations = [".local"]

    has_single_location = total_backups > 0 and len(unique_locations) == 1

    latest_backup_payload = None
    if latest_backup:
        latest_backup_payload = {
            "slug": latest_backup.get("slug"),
            "name": latest_backup.get("name"),
            "type": latest_backup.get("type") or "unknown",
            "date": latest_backup.get("date"),
            "location": latest_backup.get("location"),
            "locations": latest_backup.get("locations") or [],
            "protected": latest_backup.get("protected", False),
            "compressed": latest_backup.get("compressed", False),
            "sizeBytes": latest_backup.get("sizeBytes"),
            "addons": latest_backup.get("addons") or [],
            "includesSmartHomePlannerAddon": latest_backup.get("includesSmartHomePlannerAddon"),
        }

    result = {
        "totalBackups": total_backups,
        "totalFullBackups": total_full_backups,
        "latestBackup": latest_backup_payload,
        "latestBackupAgeDays": latest_backup_age_days,
        "hasRecentBackup": has_recent_backup,
        "hasRecentBackupWithRequiredAddon": has_recent_backup_with_required_addon,
        "uniqueLocations": unique_locations,
        "locationsCount": len(unique_locations),
        "hasSingleLocation": has_single_location,
        "staleAfterDays": stale_after_days,
        "requiredAddonSlug": SMART_HOME_PLANNER_ADDON_SLUG,
    }
    if write_debug_dump:
        try:
            _write_backups_debug(debug_responses)
        except Exception:
            pass
    return result


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        parsed = urlparse(self.path)
        path = parsed.path or ""
        if not path.startswith("/api/"):
            ext = os.path.splitext(path)[1].lower()
            if ext in {".js", ".css"}:
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0, private")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            elif ext == ".html" or path in {"", "/"} or path.endswith("/"):
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0, private")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, status, payload, headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if isinstance(headers, dict):
            for key, value in headers.items():
                if value is None:
                    continue
                self.send_header(str(key), str(value))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/storage":
            with _lock:
                payload = _read_storage()
                etag = _build_storage_etag(payload)
            self._send_json(200, payload, headers={"ETag": etag})
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

        if path == "/api/ha/config":
            try:
                payload = _fetch_ha_config()
            except RuntimeError as error:
                message = str(error)
                status = 503 if "SUPERVISOR_TOKEN" in message else 502
                self._send_json(status, {"error": message})
                return
            self._send_json(200, payload)
            return

        if path == "/api/ha/backups-status":
            debug_dump = ((query.get("debugDump") or [""])[0]).strip().lower() in {"1", "true", "yes"}
            should_write_debug_dump = bool(debug_dump and IS_LOCAL_RUNTIME)
            try:
                payload = _build_backup_status_payload(write_debug_dump=should_write_debug_dump)
            except RuntimeError as error:
                message = str(error)
                status = 503 if "SUPERVISOR_TOKEN" in message else 502
                self._send_json(status, {"error": message})
                return
            self._send_json(200, payload)
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

        if path == "/api/ha/labels":
            with _lock:
                payload = _read_registry(LABELS_FILE)
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

        if parsed.path == "/api/notifications/check":
            try:
                results = _run_notification_checks()
            except Exception as error:
                self._send_json(500, {"error": str(error)})
                return
            self._send_json(200, {"ok": True, "results": results})
            return

        if parsed.path == "/api/debug/test-notification":
            try:
                _send_ha_test_notification()
            except RuntimeError as error:
                self._send_json(500, {"error": str(error)})
                return
            self._send_json(200, {"ok": True})
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

        if parsed.path == "/api/ha/device-labels":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return

            device_id = str(payload.get("id") or "").strip()
            labels = payload.get("labels")
            if not device_id:
                self._send_json(400, {"error": "Missing required field: id"})
                return

            try:
                result = _update_ha_device_labels(device_id, labels)
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
        try:
            _validate_storage_payload(payload)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return

        if_match_header = self.headers.get("If-Match")
        conflict_payload = None
        conflict_etag = None
        next_etag = None
        with _lock:
            current = _read_storage()
            current_etag = _build_storage_etag(current)
            if not _if_match_allows_current(if_match_header, current_etag):
                conflict_payload = current
                conflict_etag = current_etag
            else:
                _write_storage(payload)
                next_etag = _build_storage_etag(payload)
        if conflict_payload is not None:
            self._send_json(
                409,
                {
                    "error": "Storage was modified by another session. Reload and try again.",
                    "code": "storage_conflict",
                    "storage": conflict_payload,
                },
                headers={"ETag": conflict_etag},
            )
            return
        self.send_response(204)
        if next_etag:
            self.send_header("ETag", next_etag)
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
    init_timer = threading.Timer(60, _schedule_notification_check)
    init_timer.daemon = True
    init_timer.start()
    server.serve_forever()


if __name__ == "__main__":
    main()
