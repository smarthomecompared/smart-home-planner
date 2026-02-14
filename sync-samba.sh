#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${ROOT_DIR}/smart-home-planner"
DEST_DIR="/Volumes/addons"
SMB_MOUNT="/Volumes/addons"
SMB_URL="${SMB_URL:-}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "SRC_DIR does not exist: ${SRC_DIR}" >&2
  exit 1
fi

if [[ "${DEST_DIR}" == "/" ]]; then
  echo "DEST_DIR cannot be /" >&2
  exit 1
fi

if [[ -n "${SMB_URL:-}" ]]; then
  if [[ ! -d "$SMB_MOUNT" ]]; then
    mkdir -p "$SMB_MOUNT"
  fi
  if ! mount | grep -q "on ${SMB_MOUNT} " && ! mount | grep -q " ${SMB_MOUNT} "; then
    echo "Mounting SMB share at ${SMB_MOUNT}..."
    mount_smbfs "$SMB_URL" "$SMB_MOUNT"
  fi
fi

if [[ -n "${SMB_MOUNT:-}" ]]; then
  case "$DEST_DIR" in
    "$SMB_MOUNT"/*|"$SMB_MOUNT")
      ;;
    *)
      echo "DEST_DIR must be inside SMB_MOUNT (${SMB_MOUNT})" >&2
      exit 1
      ;;
  esac
fi

if [[ ! -d "$DEST_DIR" ]]; then
  echo "DEST_DIR does not exist: ${DEST_DIR}" >&2
  exit 1
fi

echo "Clearing destination: ${DEST_DIR}"
shopt -s dotglob nullglob
rm -rf "${DEST_DIR:?}/"*
shopt -u dotglob nullglob

echo "Copying ${SRC_DIR} -> ${DEST_DIR}"
rsync -a --delete \
  --exclude=".*" \
  --exclude="*/.*" \
  "${SRC_DIR}/" "${DEST_DIR}/"

DEST_METADATA_FILE="${DEST_DIR}/src/js/metadata.js"
DEPLOY_TIMESTAMP="$(date +"%Y.%m.%d.%H.%M.%S")"

if [[ -f "$DEST_METADATA_FILE" ]]; then
  CURRENT_VERSION="$(sed -nE 's/^var appVersion = "([^"]+)".*/\1/p' "$DEST_METADATA_FILE" | head -n 1)"
  if [[ -n "$CURRENT_VERSION" ]]; then
    BASE_VERSION="$(echo "$CURRENT_VERSION" | sed -E 's/-[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.?$//')"
    NEW_VERSION="${BASE_VERSION}-${DEPLOY_TIMESTAMP}"
    sed -E -i '' "s|^var appVersion = \".*\"$|var appVersion = \"${NEW_VERSION}\"|" "$DEST_METADATA_FILE"
    echo "Stamped destination version: ${NEW_VERSION}"
  else
    echo "Could not read appVersion from ${DEST_METADATA_FILE}" >&2
  fi
else
  echo "metadata.js not found in destination: ${DEST_METADATA_FILE}" >&2
fi

echo "Done."
