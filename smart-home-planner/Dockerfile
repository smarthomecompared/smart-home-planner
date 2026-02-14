# Use the Home Assistant base image (automatically selected for your architecture)
ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Python for the API server
RUN apk add --no-cache python3

# Copy the static website files into the container
# The Python server will serve files from /srv in this setup
COPY src/ /srv/
COPY server.py /app/server.py
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Run the combined static + API server
CMD ["/run.sh"]
