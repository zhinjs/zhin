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
- [Agent has no available model or provider](#agent-provider-unavailable)
- [Tool is awaiting approval or denied by policy](#tool-approval-stuck)
- [A chat, channel, or repository does not route to a Workroom](#workroom-not-routing)
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

- `curl -i http://127.0.0.1:8086/pub/health` should succeed, and the Console header should return to Connected.

</section>

<section id="console-auth-failed">

## Console returns 401 or 403

### Symptom

Requests remain rejected after login, or write actions report insufficient permissions.

### Cause

- The Console token differs from the active generation's `http.token`.
- The session is read-only Demo mode, or its token lacks the required scope.

### Action

- Reload `HTTP_TOKEN` from the deployment environment rather than browser history or stale config.
- After changing the production token, publish a new generation and sign in again.

### Verification

- Verify the same token with `curl -H "Authorization: Bearer $HTTP_TOKEN" http://127.0.0.1:8086/api/system/stats`.

</section>

<section id="endpoint-offline">

## Endpoint remains offline

### Symptom

The adapter is installed, but its Endpoint is offline and cannot receive or send messages.

### Cause

- The instance configuration fails its plugin Schema or credentials are empty.
- The platform is unreachable, the webhook URL is wrong, or the account is rejected.

### Action

- Inspect the latest error in Endpoint details, then compare it with the [generated configuration fields](/en/configuration/generated).
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

- `npx zhin doctor` should pass, followed by `npx zhin runtime start` without validation errors.

</section>

<section id="agent-provider-unavailable">

## Agent has no available model or provider

### Symptom

Agent Studio cannot start a turn and reports an unavailable provider, model, or API key.

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

- Inspect cwd, security policy, and approval details in Agent Studio; approve only understood side effects.
- After cancellation, start a new turn rather than replaying a tool call that may have produced side effects.

### Verification

- Run a read-only probe; the tool and turn terminal states should agree and the approval record should be traceable.

</section>

<section id="workroom-not-routing">

## A chat, channel, or repository does not route to a Workroom

### Symptom

A message falls back to normal chat, or a task does not appear on the expected Workroom board.

### Cause

- The Catalog lacks an exact interaction-space binding or still points to an old Agent.
- One Bot may serve multiple Workrooms, but the chat, channel, or repository identity is wrong or conflicting.

### Action

- Check Bot, Endpoint, space ID, member roles, and Agent binding in Console Workroom configuration.
- After saving the Catalog, send a new message; historical messages are not reinterpreted.

### Verification

- A new message should create a task/run in the target Workroom and show the matched space and Agent in details.

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
