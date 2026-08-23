---
title: Production Deployment and Operations
---

# Run Zhin as a recoverable service

Use this for a single Bot, a team Workroom, or Remote Console. The goal is explicit ownership for process, ingress, secrets, state, monitoring, backup, and recovery.

## 1. Release baseline

- Use Node `^20.19.0 || >=22.12.0` and commit the lockfile.
- Run `zhin doctor`, `pnpm build`, and project tests.
- Run `zhin runtime start --once --mode test` to prove assembly without a long-lived supervisor.
- Record the commit, lockfile hash, configuration version, and data restore point.

The minimum production configuration is an executable fixture:

<<< ../../snippets/production/zhin.config.yml

Inject secrets only through environment variables. The fixture binds to loopback and expects a same-host TLS proxy. Use `0.0.0.0` only when a container or separate gateway must connect directly.

## 2. Network and authentication

```mermaid
flowchart LR
  U[Console / Platform] -->|HTTPS| P[Reverse proxy]
  P -->|HTTP :8068| H[Zhin HTTP Host]
  H --> E[REST / RPC / SSE]
  H --> W[Webhook / Sandbox WS]
```

The proxy must preserve Authorization, raw Webhook bodies, SSE streaming, and WebSocket Upgrade. Never cache `/api/events` or rewrite a body that a platform signature covers.

`GET /pub/health` is the public probe. It proves the HTTP process responds, not that every Endpoint, Database, or Agent provider is ready. Use Dashboard and Runtime Capabilities for full readiness.

Set a full token in production. Use a separate demo token for read-only observation. Platform Webhooks keep their own signing secrets; a Console token cannot replace them.

## 3. Process supervision

```bash
# Container or external supervisor: foreground, logs on stdout
zhin runtime start --mode production --no-watch

# Linux: install a user-level systemd service
zhin service install --user
zhin service status --user
```

On macOS, use the launchd service commands without `--user`. Keep one restart owner: with systemd, launchd, Kubernetes, or PM2, let the external supervisor own a foreground Runtime. Use `--daemon` only for a directly managed bare-metal process.

Exit code 51 means Console requested a restart; 75 means Runtime requires one. An external supervisor should restart both while enforcing a storm limit.

## 4. Durable state and backup

| State | Default location or authority | Backup requirement |
| --- | --- | --- |
| Primary database | `.zhin/data.sqlite` or configured backend | Database-consistent snapshot |
| Workroom Catalog | `workroom_catalog`; file mode `.zhin/workroom-catalog.json` | Same restore point as Journal |
| Workroom Journal | `workroom_events`; file mode `.zhin/workroom-journal` | Copy the full append-only store |
| Scheduled jobs | `data/schedule-jobs.json` | Save with config, timezone, and Endpoint targets |
| Runtime-private state | `.zhin/` | Select by feature; never expose through Agent file tools |
| Secrets | Secret manager / environment injection | Rotate separately; exclude from normal backup archives |

Use a database snapshot or stop writes before copying SQLite. Use the native backup tool for external databases and rehearse restoration regularly.

## 5. Monitoring and alerts

Monitor the HTTP probe, restart count, Endpoint health, SSE recovery gaps, error rate, database capacity, blocked Workroom items, and Agent failure/cancellation ratio.

Logs go to stdout by default; daemon mode writes `.zhin/runtime.log`. Configure host-level rotation. Include Endpoint, Project, runtimeId, or runId in alerts instead of forwarding only an error string.

## 6. Release and rollback

1. Pause ingress that creates new side effects while keeping read-only probes.
2. Back up database, Workroom state, scheduled jobs, configuration, and lockfile.
3. Install locked dependencies, then run doctor, tests, and one-shot startup.
4. Start production and complete [Console acceptance](/en/console/#standard-acceptance-run).
5. Observe one full business window before expiring the previous version and backup.

Rollback restores code, lockfile, configuration, and data from one checkpoint. If the new version wrote a new schema or external side effect, never downgrade packages alone; follow the migration's data recovery plan.

## Incident order

1. Is `/pub/health` reachable?
2. Does Dashboard show the expected Host and version?
3. Is the Endpoint online and receiving inbox events?
4. Did the current generation publish the required capability?
5. Did Database, SSE history, and Workroom Journal recover from one authority?

See [Version compatibility and migration](./upgrades) and the [Console guide](/en/console/).
