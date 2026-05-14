# @zhin.js/bridge-supervisor

Supervisor for **Bridge v1** glue children: **N3** (one managed child per Bot + ecosystem + named instance), **S1** (after a fatal handshake or IPC failure the instance is **disabled** with **no background retry** until `BridgeSupervisor#restart` or process restart), and **structured log hooks** plus `BridgeGlueHealth` (alive, last error, disabled reason).

Uses `@zhin.js/bridge-ipc` `BridgeParentSession.spawn` for J2/R1 handshake and NDJSON stdio.

## API

See `src/index.ts` — `BridgeSupervisor`, `readTokenFromEnv`, `formatGlueInstanceKey`.

## Secrets

Pass a **resolved** `token` string into `BridgeGlueStartSpec` (for example read from `process.env` with `readTokenFromEnv`, or from your config loader after `${VAR}` interpolation). Do not commit tokens.

## Primary config (follow-up)

Until `zhin.config.yml` is extended, wire the supervisor in code with an in-memory `BridgeGlueStartSpec` per `BridgeGlueInstanceKey`. Planned YAML shape for a later PR:

```yaml
bridge_glue:
  instances:
    - bot_id: "main"
      ecosystem: "wechat-mp"
      instance_id: "default"
      command: "node"
      args: ["./dist/glue.mjs"]
      # Token: env name to read at runtime (resolved before start — same as other zhin env refs)
      token_env: "ZHIN_BRIDGE_GLUE_TOKEN"
      cwd: "."
      # Optional: forwarded to child env for temp files
      tmpdir_env: "BRIDGE_GLUE_TMPDIR"
```

Each tuple `(bot_id, ecosystem, instance_id)` maps to one `BridgeGlueInstanceKey`; multiple rows are isolated (no cross-wiring).

## Scripts

```bash
pnpm --filter @zhin.js/bridge-supervisor test
pnpm --filter @zhin.js/bridge-supervisor build
```
