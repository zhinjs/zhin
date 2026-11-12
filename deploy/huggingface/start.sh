#!/bin/sh
# Hugging Face Space entrypoint (docs/operations/demo-deployment.md).
#
# Space secrets:
#   HTTP_TOKEN          bootstrap token (valid only until the first owner exists). When unset a
#                       random one is generated and printed to the container log only.
#   OWNER_PASSWORD      creates the owner account `OWNER_USERNAME` (default `maintainer`) offline,
#                       before the port opens, so the bootstrap token never reaches the public site.
#   DEMO_PASSWORD       creates the read-only account `demo` (role `DEMO_ROLE`, default `viewer`).
#   OPENROUTER_API_KEY  model key for `ai:` messages.
set -eu

ZHIN=./node_modules/.bin/zhin

if [ -z "${HTTP_TOKEN:-}" ]; then
  HTTP_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
  echo "[zhin-demo] HTTP_TOKEN secret not set; generated a one-time bootstrap token (log only): ${HTTP_TOKEN}"
fi
export HTTP_TOKEN

if [ -n "${OWNER_PASSWORD:-}" ]; then
  if "$ZHIN" console init --status | grep -q '"setupRequired": true'; then
    printf '%s\n' "$OWNER_PASSWORD" | "$ZHIN" console init --yes --owner "${OWNER_USERNAME:-maintainer}" --password-stdin
  fi
  if [ -n "${DEMO_PASSWORD:-}" ] && ! "$ZHIN" console user list | cut -f1 | grep -qx demo; then
    printf '%s\n' "$DEMO_PASSWORD" | "$ZHIN" console user create demo --role "${DEMO_ROLE:-viewer}" --password-stdin
  fi
else
  echo "[zhin-demo] OWNER_PASSWORD secret not set: finish setup in the Console with the bootstrap token from this log."
fi

exec "$ZHIN" start --foreground --mode production --no-watch
