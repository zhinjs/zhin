# Docker Official Image index digest verified from Docker Hub 2026-09-07.
# https://hub.docker.com/layers/library/node/24-bookworm-slim/images/sha256-ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/* && npm install --global pnpm@9.0.2
ENV HOME=/tmp/home CI=true
RUN npm install --global turbo@2.10.7
