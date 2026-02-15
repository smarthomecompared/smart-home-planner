#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${ROOT_DIR}/smart-home-planner"
PROPERTIES_FILE="${ROOT_DIR}/local.properties"
DEST_ROOT="${DEST_ROOT:-/Volumes}"
SMB_MOUNT="${SMB_MOUNT:-${DEST_ROOT}}"
SMB_URL="${SMB_URL:-}"
DEST_LIST_RAW="${SAMBA_DEST_DIRS:-}"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

if [[ ! -d "$SRC_DIR" ]]; then
  echo "SRC_DIR does not exist: ${SRC_DIR}" >&2
  exit 1
fi

if [[ -z "$DEST_LIST_RAW" && -f "$PROPERTIES_FILE" ]]; then
  DEST_LIST_RAW="$(sed -nE 's/^[[:space:]]*SAMBA_DEST_DIRS[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p' "$PROPERTIES_FILE" | tail -n 1)"
fi

DEST_LIST_RAW="$(trim "$DEST_LIST_RAW")"
if [[ "$DEST_LIST_RAW" == \"*\" && "$DEST_LIST_RAW" == *\" ]]; then
  DEST_LIST_RAW="${DEST_LIST_RAW:1:-1}"
elif [[ "$DEST_LIST_RAW" == \'*\' ]]; then
  DEST_LIST_RAW="${DEST_LIST_RAW:1:-1}"
fi

if [[ -z "$DEST_LIST_RAW" ]]; then
  echo "Missing SAMBA_DEST_DIRS. Set it in ${PROPERTIES_FILE} or env var." >&2
  exit 1
fi

declare -a DEST_DIRS=()
IFS=',' read -r -a DEST_ITEMS <<< "$DEST_LIST_RAW"
for raw_item in "${DEST_ITEMS[@]}"; do
  item="$(trim "$raw_item")"
  [[ -z "$item" ]] && continue
  if [[ "$item" == /* ]]; then
    DEST_DIRS+=("$item")
  else
    DEST_DIRS+=("${DEST_ROOT%/}/$item")
  fi
done

if [[ "${#DEST_DIRS[@]}" -eq 0 ]]; then
  echo "No valid destination directories in SAMBA_DEST_DIRS=${DEST_LIST_RAW}" >&2
  exit 1
fi

if [[ -n "$SMB_URL" ]]; then
  if [[ ! -d "$SMB_MOUNT" ]]; then
    mkdir -p "$SMB_MOUNT"
  fi
  if ! mount | grep -q "on ${SMB_MOUNT} " && ! mount | grep -q " ${SMB_MOUNT} "; then
    echo "Mounting SMB share at ${SMB_MOUNT}..."
    mount_smbfs "$SMB_URL" "$SMB_MOUNT"
  fi
fi

if [[ -n "${SMB_MOUNT:-}" ]]; then
  for DEST_DIR in "${DEST_DIRS[@]}"; do
    case "$DEST_DIR" in
      "$SMB_MOUNT"/*|"$SMB_MOUNT")
        ;;
      *)
        echo "DEST_DIR must be inside SMB_MOUNT (${SMB_MOUNT}): ${DEST_DIR}" >&2
        exit 1
        ;;
    esac
  done
fi

for DEST_DIR in "${DEST_DIRS[@]}"; do
  if [[ "$DEST_DIR" == "/" ]]; then
    echo "DEST_DIR cannot be /" >&2
    exit 1
  fi
  if [[ ! -d "$DEST_DIR" ]]; then
    echo "DEST_DIR does not exist: ${DEST_DIR}" >&2
    exit 1
  fi
done

DEPLOY_TIMESTAMP="$(date +"%Y.%m.%d.%H.%M.%S")"

for DEST_DIR in "${DEST_DIRS[@]}"; do
  echo "Clearing destination: ${DEST_DIR}"
  shopt -s dotglob nullglob
  rm -rf "${DEST_DIR:?}/"*
  shopt -u dotglob nullglob

  echo "Copying ${SRC_DIR} -> ${DEST_DIR}"
  rsync -a --delete \
    --exclude=".*" \
    --exclude="*/.*" \
    "${SRC_DIR}/" "${DEST_DIR}/"

  DEST_DEBUG_SETTINGS_FILE="${DEST_DIR}/src/js/debug-settings.js"
  if [[ -f "$DEST_DEBUG_SETTINGS_FILE" ]]; then
    if grep -Eq '^[[:space:]]*var appBuildDateTime = ".*";?[[:space:]]*$' "$DEST_DEBUG_SETTINGS_FILE"; then
      sed -E -i '' "s|^[[:space:]]*var appBuildDateTime = \".*\";?[[:space:]]*$|var appBuildDateTime = \"${DEPLOY_TIMESTAMP}\";|" "$DEST_DEBUG_SETTINGS_FILE"
      echo "Stamped destination build datetime (${DEST_DIR}): ${DEPLOY_TIMESTAMP}"
    else
      echo "Could not find appBuildDateTime in ${DEST_DEBUG_SETTINGS_FILE}" >&2
    fi
  else
    echo "debug-settings.js not found in destination: ${DEST_DEBUG_SETTINGS_FILE}" >&2
  fi
done

echo "Done."
