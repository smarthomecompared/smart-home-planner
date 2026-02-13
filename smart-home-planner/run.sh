#!/usr/bin/with-contenv bashio
# =============================================================================
# Entry script for the add-on
# Uses bashio helpers for nice logging inside Home Assistant
# =============================================================================

bashio::log.info "Starting Caddy web server..."
bashio::log.info "Serving static files from /srv on port 80"

# Execute Caddy with the same parameters as in Dockerfile
# Using 'exec' replaces this process with Caddy (cleaner)
exec caddy file-server \
  --browse \
  --root /srv \
  --listen :80