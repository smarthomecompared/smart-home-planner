# Use the Home Assistant base image (automatically selected for your architecture)
ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Python (UI/API server) and Node.js (registry sync worker)
RUN apk add --no-cache python3 nodejs npm

# Install Node dependencies for registry sync worker
COPY package.json /app/package.json
RUN cd /app && npm install --omit=dev

# Copy the static website files into the container
# The Python server will serve files from /srv in this setup
COPY src/ /srv/
COPY server.py /app/server.py
COPY registry-sync.js /app/registry-sync.js
COPY ha-device-update.js /app/ha-device-update.js
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Run the combined static + API server
CMD ["/run.sh"]
