#!/bin/sh
# Hugging Face Space entrypoint (docs/operations/demo-deployment.md).
#
# Space secrets:
#   OWNER_PASSWORD      creates the owner account `OWNER_USERNAME` (default `maintainer`) offline,
#                       before the port opens, so no bootstrap token is ever usable on the public
#                       site. At least 10 characters.
#   HTTP_TOKEN          bootstrap token (valid only until the first owner exists). Only needed to
#                       finish setup in the Console without OWNER_PASSWORD. When unset a random one
#                       is generated in memory for this start and never printed.
#   DEMO_PASSWORD       creates the read-only account `demo` (role `DEMO_ROLE`, default `viewer`).
#                       At least 10 characters.
#   OPENROUTER_API_KEY  model key for `ai:` messages.
#
# Without OWNER_PASSWORD and without HTTP_TOKEN nobody could finish setup (the generated token is
# not shown anywhere), so the Space refuses to open its port. Misconfigured secrets exit non-zero
# with a message: Hugging Face then shows "Runtime error" with this log instead of restarting.
set -eu

ZHIN=./node_modules/.bin/zhin
MIN_PASSWORD_LENGTH=10

fail() {
  echo "[zhin-demo] $1" >&2
  exit 1
}

check_password() {
  # $1: secret name, $2: value
  if [ "${#2}" -lt "$MIN_PASSWORD_LENGTH" ]; then
    fail "$1 must be at least $MIN_PASSWORD_LENGTH characters (got ${#2}); update the Space secret and restart."
  fi
}

if [ -z "${OWNER_PASSWORD:-}" ] && [ -z "${HTTP_TOKEN:-}" ]; then
  fail "set the Space secret OWNER_PASSWORD (recommended) or HTTP_TOKEN: without either nobody can finish Console setup, so the port stays closed."
fi
[ -n "${OWNER_PASSWORD:-}" ] && check_password OWNER_PASSWORD "$OWNER_PASSWORD"
[ -n "${DEMO_PASSWORD:-}" ] && check_password DEMO_PASSWORD "$DEMO_PASSWORD"

if [ -z "${HTTP_TOKEN:-}" ]; then
  # The owner is created below before the port opens, so this token is never accepted publicly.
  HTTP_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
fi
export HTTP_TOKEN

if [ -n "${OWNER_PASSWORD:-}" ]; then
  if "$ZHIN" console init --status | grep -q '"setupRequired": true'; then
    printf '%s\n' "$OWNER_PASSWORD" | "$ZHIN" console init --yes --owner "${OWNER_USERNAME:-maintainer}" --password-stdin \
      || fail "creating the owner account failed (see above)."
  fi
  if [ -n "${DEMO_PASSWORD:-}" ] && ! "$ZHIN" console user list | cut -f1 | grep -qx demo; then
    printf '%s\n' "$DEMO_PASSWORD" | "$ZHIN" console user create demo --role "${DEMO_ROLE:-viewer}" --password-stdin \
      || fail "creating the demo account failed (see above)."
  fi
else
  echo "[zhin-demo] OWNER_PASSWORD secret not set: finish setup in the Console with the HTTP_TOKEN secret."
fi

# The account passwords are not needed past this point: keep them out of the gateway and the
# instance (plugins, Agent tools, terminal) environment.
unset OWNER_PASSWORD DEMO_PASSWORD

exec "$ZHIN" start --foreground --mode production --no-watch
