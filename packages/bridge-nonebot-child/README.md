# Bridge v1 — NoneBot2 reference child (O1)

Python subprocess used by Bridge v1 **end-to-end tracer** tests: NDJSON stdio (`hello` / `dispatch` / `outbound_intent` / `dispatch_result`) plus a real **NoneBot2** runtime with an **O1 plugin allowlist**.

## Q1 — User-provided Python (PRD truth)

The host / operator supplies a **Python ≥ 3.9** interpreter and dependencies. The TypeScript parent does **not** vendor NoneBot2; CI and developers must install Python deps locally or via **`uv`** (recommended).

- **CI / agents**: install with `uv sync` in this directory, or `pip install -r requirements.txt` into a venv, then run `python -m bridge_nonebot_child` with `PYTHONPATH=src` (non-uv) or `uv run python -m bridge_nonebot_child`.
- **Vitest** in this repo skips the NoneBot e2e when `python3` is missing or when `nonebot` / `nonebot.adapters.console` cannot be imported.

## O1 — Plugin allowlist

Set **`ZHIN_BRIDGE_NB_PLUGIN_MODULES`** to a JSON array of importable module names (only these are `load_plugin`’d). Example:

```bash
export ZHIN_BRIDGE_NB_PLUGIN_MODULES='["bridge_nonebot_child.plugins.tracer"]'
```

## Other environment variables

| Variable | Purpose |
|----------|---------|
| `ZHIN_BRIDGE_IPC_TOKEN` | Handshake token (same as parent). |
| `ZHIN_BRIDGE_GLUE_BOT_ID` | Outbound intent `payload.botId`. |
| `ZHIN_BRIDGE_GLUE_ECOSYSTEM` | `payload.ecosystem`. |
| `ZHIN_BRIDGE_GLUE_INSTANCE_ID` | `payload.instanceId`. |
| `ZHIN_BRIDGE_OUTBOUND_CONTEXT` | `payload.context` (default `nonebot-tracer`). |
| `DRIVER` | Forced to `~none` if unset (headless). |
| `CONSOLE_HEADLESS_MODE` | Set to `true` (Console adapter without UI). |

## Run locally

```bash
cd packages/bridge-nonebot-child
uv sync   # or: python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
uv run python -m bridge_nonebot_child
```

## CI

- Default **Vitest** run: the e2e in `@zhin.js/bridge-inbound-glue` uses `it.skipIf` when neither **`uv run`** (from repo root) nor **`packages/bridge-nonebot-child/.venv`** can import `nonebot2` + `nonebot-adapter-console`.
- To **execute** the tracer test in CI: run `uv sync` in `packages/bridge-nonebot-child` before `pnpm test`, or create `.venv` there with `pip install -r requirements.txt` (see Q1).

Stdin: NDJSON lines. After `hello` / `hello_ok`, each `dispatch` runs NoneBot against a synthetic **Console** `MessageEvent` built from the zhin-shaped `payload`, then emits **`outbound_intent`** (shim) and **`dispatch_result`** (`handled` / `shortCircuit` per ADR 0008 defaults).

**Note:** the child rebinds NoneBot’s loguru sink to **stderr** so **stdout stays NDJSON-only** for the Bridge handshake.

## Tracer plugin

`bridge_nonebot_child.plugins.tracer` — minimal `on_message` handler that emits one **`outbound_intent`** per inbound message using the glue env vars above. It does **not** call `bot.send` (Console UI is absent in headless mode); outbound goes through the Bridge IPC shim instead.
