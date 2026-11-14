---
title: Troubleshooting Center
outline: [2, 3]
---

# Troubleshooting Center

> This page is generated from a structured incident catalog. Every issue follows “Symptom → Cause → Action → Verification”; do not skip verification.

Start from the symptom. Change one condition at a time and retain startup logs, Trace, and generation details.

## Quick index

- [Console cannot connect to the Runtime](#console-cannot-connect)
- [Console returns 401 or 403](#console-auth-failed)
- [Endpoint remains offline](#endpoint-offline)
- [Messages or notices are missing after refresh](#messages-missing-after-refresh)
- [Configuration is rejected at startup](#configuration-rejected)
- [Startup fails with configVersion must be 2 after an upgrade](#config-v1-rejected)
- [Multiple package locations for one package](#multiple-package-locations)
- [Agent has no available model or provider](#agent-provider-unavailable)
- [Tool is awaiting approval or denied by policy](#tool-approval-stuck)
- [Container restarts or health checks fail](#container-not-healthy)

<section id="console-cannot-connect">

## Console cannot connect to the Runtime

### Symptom

Console remains offline or reconnecting and page data stops updating.

### Cause

- The Runtime is stopped, or Console uses a different host, port, or base path.
- The reverse proxy does not forward SSE or buffers the event stream.

### Action

- Run `npx zhin doctor`, then inspect the HTTP listen address in startup logs.
- Ensure the proxy disables buffering and keeps `/api/events` connections open.

### Verification

- `curl -i http://127.0.0.1:8068/pub/health` should succeed, and the Console header should return to Connected.

</section>

<section id="console-auth-failed">

## Console returns 401 or 403

### Symptom

Requests remain rejected after login, or write actions report insufficient permissions.

### Cause

- The session expired or was revoked (a password change or disabling the user revokes every session), or the API token was revoked.
- The account's roles lack the permission the operation needs (the 403 response names it), or `http.token` is still used after setup; it is only valid until the first owner exists.

### Action

- Sign in again; give automation a newly issued API token, or ask an owner to bind a suitable role under Access.
- If no owner can sign in, stop the Host and recover offline with `zhin console user passwd <username>` or `zhin console user enable <username>`.

### Verification

- Check which principal and permissions a credential resolves to with `curl -H "Authorization: Bearer $ZHIN_CONSOLE_TOKEN" http://127.0.0.1:8068/api/auth/me`.

</section>

<section id="endpoint-offline">

## Endpoint remains offline

### Symptom

The adapter is installed, but its Endpoint is offline and cannot receive or send messages.

### Cause

- The instance configuration fails its plugin Schema or credentials are empty.
- The platform is unreachable, the webhook URL is wrong, or the account is rejected.

### Action

- Inspect the connection state and latest error in the account page's Access and Overview tabs, then compare it with the [generated configuration fields](/en/configuration/generated).
- Revalidate credentials, callback URLs, and network egress against the platform guide.

### Verification

- After reload, the Endpoint should become online; send a real direct-message probe to verify both directions.

</section>

<section id="messages-missing-after-refresh">

## Messages or notices are missing after refresh

### Symptom

Live messages appear, but history is incomplete after refresh, reconnect, or SSE recovery.

### Cause

- The selected Endpoint or Channel differs from the message's interaction space.
- The server event journal has a gap and the client must rebuild from authoritative HTTP APIs.

### Action

- Reselect the target Endpoint and Channel and wait for recovery to finish.
- Confirm the database persistence directory is writable and the proxy does not cache history APIs.

### Verification

- Send a uniquely worded message, refresh, and restart the Runtime; the HTTP history API should restore it.

</section>

<section id="configuration-rejected">

## Configuration is rejected at startup

### Symptom

Startup reports `Invalid Plugin config`, an unknown top-level field, or environment expansion failure.

### Cause

- A field name, type, or enum value differs from the installed version's Schema.
- `${VAR}` is unset and expands to an empty value that fails validation.

### Action

- Run `npx zhin doctor` and fix the field at the reported path.
- Check the current source and Schema in the [generated configuration fields](/en/configuration/generated).

### Verification

- `npx zhin doctor` should pass, followed by `npx zhin start --foreground` without validation errors.

</section>

<section id="config-v1-rejected">

## Startup fails with configVersion must be 2 after an upgrade

### Symptom

After upgrading to 1.1.14 or later the Bot refuses to start with `configVersion must be 2`, `Legacy package.json zhin.plugins detected`, or "Detected a v1 configuration".

### Cause

- The project still uses the v1 layout: the main config has no `configVersion: 2`, or `package.json#zhin.plugins` still declares mounts.
- The CLI is 1.1.13 or earlier and has no `zhin migrate instances`.

### Action

- Stop the Bot, upgrade `zhin.js` and `@zhin.js/cli` to the latest, preview with `zhin migrate instances`, then run `zhin migrate instances --apply`.
- Follow [Upgrading to configVersion 2](/en/operations/upgrades#configversion-2) for cases the tool will not convert; undo with `zhin migrate instances --recover rollback`.

### Verification

- `zhin config check` no longer reports `config.legacy_v1` or `plugins.invalid`, and the Bot starts.

</section>

<section id="multiple-package-locations">

## Multiple package locations for one package

### Symptom

Startup fails with `Multiple package locations for @zhin.js/... are not supported in one generation`.

### Cause

- The project mixes npm dependencies with a `link:`/`workspace:` plugin from a zhin source checkout, so one zhin package resolves to two directories.
- Hand-written `pnpm.overrides` cover only some zhin packages.

### Action

- Diagnose with the [local development guide](/en/authoring/local-dev): find both resolved paths with `pnpm why` and `readlink -f`.
- Switch the external project consistently with `zhin dev link <zhin-path>`, or move everything back to npm versions.
- Duplicates from adding a standalone plugin with `pnpm add <plugin-dir>`: `pnpm remove` it and use `zhin dev link <plugin-dir>` instead (see [hot-reload a standalone plugin](/en/authoring/local-dev#dev-link-plugin)).

### Verification

- After `pnpm install`, each zhin package has a single resolved path and `zhin start --once` prints `"started": true`.

</section>

<section id="agent-provider-unavailable">

## Agent has no available model or provider

### Symptom

An Agent session in **Try a conversation** cannot start a turn and reports an unavailable provider, model, or API key.

### Cause

- The provider environment variable is empty and the Runtime soft-prunes it.
- The Agent's model is not published by any provider in the active generation.

### Action

- Confirm the provider and model are published in Console, then check the deployment API key.
- Fix the Agent binding and publish a new generation instead of only editing disk config.

### Verification

- Run a minimal text turn in the playground; Trace should show turn start, model response, and completed.

</section>

<section id="tool-approval-stuck">

## Tool is awaiting approval or denied by policy

### Symptom

An Agent turn stops at a tool step marked pending approval, denied, or cancelled.

### Cause

- The working directory or tool is outside the active security policy.
- The approval was not handled, or a cancellation signal already ended the turn.

### Action

- Inspect cwd, security policy, and approval details in the **Try a conversation** Agent session and **Bot status**; approve only understood side effects.
- After cancellation, start a new turn rather than replaying a tool call that may have produced side effects.

### Verification

- Run a read-only probe; the tool and turn terminal states should agree and the approval record should be traceable.

</section>

<section id="container-not-healthy">

## Container restarts or health checks fail

### Symptom

Compose or Kubernetes reports unhealthy, CrashLoopBackOff, or persistence permission errors.

### Cause

- The node user cannot write the `.zhin` or `data` mount.
- A required Secret, project config, or image tag was not deployed correctly.

### Action

- Inspect the first error from `docker compose logs zhin` or `kubectl logs deploy/zhin`.
- Follow [Production Deployment](/en/operations/production) to verify ownership, Secrets, and immutable image tags.

### Verification

- `docker compose ps` or `kubectl rollout status deploy/zhin` should remain successful and the health endpoint should pass.

</section>
