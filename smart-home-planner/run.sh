#!/usr/bin/with-contenv bashio
# =============================================================================
# Entry script for the add-on
# Uses bashio helpers for nice logging inside Home Assistant
# =============================================================================

bashio::log.info "Starting Smart Home Planner server..."
bashio::log.info "Serving UI from /srv and data from /data on port 80"

# The server owns data.json: the sync worker writes through its API, so it is
# started first to avoid a burst of retries while the worker waits for it.
python3 /app/server.py &
SERVER_PID=$!

bashio::log.info "Starting Home Assistant registry sync worker..."

node /app/registry-sync.js &
SYNC_PID=$!

bashio::log.info "Processes started (sync PID=${SYNC_PID}, server PID=${SERVER_PID})"

wait -n "${SYNC_PID}" "${SERVER_PID}"
EXIT_CODE=$?

bashio::log.error "A process exited (code=${EXIT_CODE}). Stopping add-on..."
kill "${SYNC_PID}" "${SERVER_PID}" >/dev/null 2>&1 || true
wait "${SYNC_PID}" "${SERVER_PID}" >/dev/null 2>&1 || true

exit "${EXIT_CODE}"
