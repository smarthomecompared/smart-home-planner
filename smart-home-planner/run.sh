#!/usr/bin/with-contenv bashio
# =============================================================================
# Entry script for the add-on
# Uses bashio helpers for nice logging inside Home Assistant
# =============================================================================

bashio::log.info "Starting Smart Home Planner server..."
bashio::log.info "Serving UI from /srv and data from /data on port 80"

exec python3 /app/server.py
