# Use the Home Assistant base image (automatically selected for your architecture)
ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Caddy from the Alpine package repository
RUN apk add --no-cache caddy

# Copy the static website files into the container
# Caddy will serve files from /srv by default in this setup
COPY src/ /srv/

# Run Caddy to serve static files on port 80
# --browse enables directory listing (optional, remove if not wanted)
# --root specifies where the files are
# --listen makes it bind to all interfaces on port 80
CMD ["caddy", "file-server", "--browse", "--root", "/srv", "--listen", ":80"]