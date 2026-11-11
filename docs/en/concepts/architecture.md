---
title: "Layered Architecture"
description: "Which packages make up Zhin.js, how they are layered, and what plugin authors and contributors each need to respect"
---

# Layered architecture

Zhin.js is made of dozens of small packages, but **to write bots and plugins you almost only install and import `zhin.js`**. This page explains how the packages are layered and why — for readers who want to understand the internals or contribute.

## Three things to remember

1. **There is one public entry.** `zhin.js` re-exports what plugin authors need: `definePlugin` from `zhin.js`, `defineCommand` and friends from subpaths such as `zhin.js/command` and `zhin.js/middleware`.
2. **AI is optional.** The default install is the IM core only (under 10MB); `@zhin.js/agent` and `@zhin.js/ai` are optional and used through `zhin.js/agent` / `zhin.js/ai`.
3. **Dependencies only point down.** Upper packages may depend on lower ones; lower packages never know upper ones exist. `pnpm check:architecture` enforces this in CI — it isn't just a convention.

| You are… | Depend on |
| --- | --- |
| Writing a bot or a regular plugin | `zhin.js` only |
| Writing AI tools | plus `@zhin.js/tool` (`npx zhin setup --ai` handles it) |
| Writing a new kind of capability (a Feature) | only `@zhin.js/feature-kit` / `@zhin.js/plugin-runtime` — not `@zhin.js/core` |
| Contributing to the framework itself | the layering rules below |

## Layer overview

```mermaid
flowchart BT
    subgraph basic["basic/ Foundation layer"]
        logger["@zhin.js/logger"]
        schema["@zhin.js/schema"]
        schedule["@zhin.js/schedule"]
        database["@zhin.js/database"]
    end
    subgraph runtime["Runtime base"]
        imc["@zhin.js/im-contract<br/>IM transport & interaction contract"]
        pr["@zhin.js/plugin-runtime<br/>generation / snapshot / handoff"]
        fk["@zhin.js/feature-kit<br/>Feature discovery & projection"]
        rt["@zhin.js/runtime<br/>RootRuntime / ProjectGraph / HMR"]
    end
    subgraph kernel["Kernel"]
        k["@zhin.js/kernel"]
    end
    subgraph features["Feature layer (composable capabilities)"]
        ad["@zhin.js/adapter"]
        cmd["@zhin.js/command"]
        comp["@zhin.js/component"]
        mw["@zhin.js/middleware"]
        tool["@zhin.js/tool · skill · agent-feature · mcp-feature"]
    end
    subgraph im["IM & AI"]
        ai["@zhin.js/ai"]
        core["@zhin.js/core"]
        agent["@zhin.js/agent"]
    end
    zhin["zhin.js (facade)"]
    host["packages/host/* (http / mcp / a2a)"]
    gateway["@zhin.js/gateway (management gateway)"]
    instance["zhin.js/instance (instance composition root)"]
    cli["@zhin.js/cli"]

    pr --> fk --> ad & cmd & comp & mw & tool
    imc --> ad & cmd & core & agent
    logger & schema & schedule --> k
    logger --> database
    logger --> ai
    ad & cmd & comp & mw & k & database --> core
    ai & core --> agent
    core --> zhin
    agent -. peer .-> zhin
    pr & fk --> rt
    zhin --> host
    rt & core & host & gateway --> instance
    rt --> gateway --> cli
```

Dependencies are defined by each package's `package.json`. Read the diagram from the bottom up:

The foundation consists of two independent zero-dependency contracts: `@zhin.js/plugin-runtime` owns generation, snapshots, disposal, and tokens; `@zhin.js/im-contract` (including `/interaction`) owns transport-neutral identities, segments, conversation events, delivery semantics, and typed user-interaction requests and conclusions. One layer up, `@zhin.js/feature-kit` depends only on the runtime base and provides the registration, discovery, and projection mechanism for Feature providers. Feature-layer packages (adapter / command / component / middleware / handler / tool / skill / ...) depend only on these foundation contracts and do not depend on each other.

Moving further up, `@zhin.js/core` assembles the adapter / command / component / middleware Features together with the kernel into the IM layer (Plugin, Adapter, Endpoint, message send/receive). The facade package `zhin.js` re-exports core packages as a unified entry -- plugin authors only need `import { ... } from 'zhin.js'`. `@zhin.js/agent`, `@zhin.js/ai`, etc. are optional peer dependencies, so the default installation contains only the IM core, with AI added on demand.

## Layer responsibilities

| Layer | Package | Responsibility |
|-------|---------|---------------|
| Foundation | `basic/logger` `schema` `schedule` `database` (also re-exported by `@zhin.js/kernel`) | Logging, config validation, scheduling, database -- zero/near-zero dependencies |
| Runtime base & IM contract | `@zhin.js/plugin-runtime` (including `/im-contract` and `/interaction`, imported from `zhin.js`) | Generation transactions, snapshot leases, handoff, explicit capability graphs (`definePluginCapabilityGraph`), plus Endpoint, conversation, segment, and structured user-interaction contracts |
| Feature mechanism | `@zhin.js/feature-kit` | Declare Feature providers, discover capabilities by convention, project into runtime indexes |
| Kernel | `@zhin.js/kernel` | Plugin system, error hierarchy, and foundation re-exports -- no IM concepts |
| Feature layer | `@zhin.js/adapter` `command` `component` `middleware` ... | Contract for a capability type (e.g. `defineAdapter`) + projection index (e.g. `AdapterIndex`) |
| AI engine | `@zhin.js/ai` (including provider-auth & model-registry) | Provider, auth, model registry, agentLoop, sessions, memory -- no IM concepts |
| Agent Harness | `@zhin.js/harness` | Multi-agent collaboration microkernel: per-actor serial Mailbox, Authority attenuation, conserved BudgetLedger, deterministic GuardKernel, shared Blackboard, and single-authority `engagement_events` Journal |
| IM layer | `@zhin.js/core` (including handler, actor, and `@zhin.js/core/runtime` IM Host installers) | Plugin, inbound spine (`inbound-spine`), outbound pipeline, command dispatch, multi-bot collaboration Venues, and Database/Outbound/Inbox Host implementations |
| Agent | `@zhin.js/agent` (including the `@zhin.js/agent/runtime` Agent/Inference Host runtime) | Unified mailbox ingress spine (`unified-mailbox-spine`), multi-model orchestration, collaboration tools, tool security policies, MCP client |
| Console | `@zhin.js/console-protocol` (including contract / review-kit), `@zhin.js/pagemanager`, `@zhin.js/client` | Server-Driven Blueprints (`definePageBlueprint`), multi-surface projection (Web / IM Card / CLI TUI), Console shell rendering (`renderConsoleShell`), and browser SDK |
| Facade | `zhin.js` | Re-exports the core authoring surface; `zhin.js/agent`, `zhin.js/ai` sub-paths exposed on demand |
| Runtime | `@zhin.js/runtime` (including the `/config-file` and `/isolate` subpaths) | `RootRuntime`: scans the project graph, composes configuration, executes generation transactions, HMR, and shared Host lifecycle |
| Assembly | `zhin.js/instance` | Instance composition root (ADR 0054 §0) -- wires domain Hosts into a runnable process and owns the installers for the generic HTTP/Protocol (MCP, A2A)/Speech/HTML-Renderer/Schedule Hosts (`packages/im/zhin/src/instance/*-host-installer.ts`) and the runtime-side Console backend |
| Management | `@zhin.js/gateway`, `@zhin.js/cli` | Management gateway: the HTTP port, Console accounts and permissions, terminal, project configuration and package transactions, instance supervision and logs; the CLI manages the project and talks to the gateway over the local control socket. Neither depends on `zhin.js` or IM layers (see [Four packages, two processes](#gateway-and-instance)) |

## Four packages, two processes {#gateway-and-instance}

A running Zhin project is made of four public packages working together ([ADR 0054](../../adr/0054-management-gateway.md)):

| Package | What it is | Dependency boundary |
| --- | --- | --- |
| `create-zhin-app` | Creates a project; asks only for language, project name and bootstrap token (ADR 0053) | Depends only on `@zhin.js/scaffold-wizard` |
| `@zhin.js/cli` (the `zhin` command) | Manages the project: `start / stop / restart / status / logs`, `install / uninstall / update`, `console init / user`, `setup`, plugin tooling | Depends on `@zhin.js/gateway`, **never on `zhin.js` or IM layers** |
| `@zhin.js/gateway` | The management gateway process: HTTP server, authentication and permissions, setup and onboarding, instance supervision, dependency transactions, terminal, logs, local control socket | Depends on `host-http`, `database`, `console-protocol`, `runtime` (config and project-file tools only), `scaffold-wizard`; **never on `zhin.js` or IM layers, and loads no plugins** |
| `zhin.js` | The Zhin instance: IM Runtime, plugins, adapters, Agent; instance composition root `zhin.js/instance` | The IM layers; HTTP only through `BridgedHttpHost` (`@zhin.js/host-http/bridge`) |

New projects depend on `zhin.js`, `@zhin.js/gateway` and `@zhin.js/cli`. `pnpm check:architecture` enforces that the CLI and the gateway import no IM layer.

```mermaid
flowchart LR
  subgraph clients[Callers]
    B[Browser Console]
    W[Platform webhooks / reverse WS]
    C[zhin CLI]
  end
  subgraph gw[Gateway process · @zhin.js/gateway]
    HS[HTTP server<br/>http.port]
    AU[Authentication: sessions / API tokens / bootstrap token]
    OWN[Own routes: /auth/*, iam.*, /gateway/*,<br/>terminal, /pub/health, Console assets]
    SUP[InstanceSupervisor<br/>start / stop, crash restarts, logs, dependency transactions]
    LS[Local control socket<br/>.zhin/gateway.sock]
  end
  subgraph inst[Instance process · zhin.js/instance]
    BR[BridgedHttpHost<br/>route table]
    RT[RootRuntime: plugins, adapters, Agent]
    CB[Console backend: RPC authorization, SSE, REST]
  end
  DB[(Project database)]
  LOG[.zhin/logs/]
  B --> HS
  W --> HS
  C --> LS --> SUP
  HS --> AU --> OWN
  HS -->|"{base}/*: forwarded with the principal after authentication"| BR
  HS -->|"other routes: forwarded unchanged"| BR
  SUP <-->|"IPC control channel<br/>ready / routes / http.* / ws.* /<br/>restart-request / shutdown / catalog / audit"| BR
  BR --> CB --> RT
  AU --- DB
  RT --- DB
  SUP --> LOG
```

### Who owns what {#ownership}

| Responsibility | Owner | Notes |
| --- | --- | --- |
| Public ports (`http.port`, additional listeners) | Gateway | The instance listens on no port and loads neither `node:http` nor `ws` |
| Authentication (sessions, API tokens, bootstrap token) | Gateway | The instance parses no Bearer credential; it only receives the principal forwarded with each request |
| Authorization | Both | The gateway checks its own routes; the instance's Console RPC dispatcher checks the forwarded principal against `CONSOLE_RPC_PERMISSIONS` (only it knows the RPC type and the scope target in the payload). Both use the same permission map |
| `console_*` tables (users, roles, sessions, tokens, audit) | Gateway | Instance-side denials and writes are sent to the gateway as `audit` messages |
| Business data | Instance | Plugin tables, journals, conversations, usage |
| Database connections | One each | Same `database` configuration; SQLite uses WAL |
| Setup, onboarding, terminal | Gateway | Available while the instance is crashed |
| Dependency install / uninstall / update | Gateway | Stop instance → package manager → start instance, rollback on failure |
| Raw configuration file and `.env` | Gateway (instance offline) / instance | Both write through the same revisioned atomic path |
| Logs | Gateway | Collects instance stdout / stderr into `.zhin/logs/instance.log` (rotated) and an in-memory ring buffer |
| Plugins, adapters, Agent, schedules, most Console APIs | Instance | They need the runtime snapshot |
| Plugin-owned HTTP / WS routes | Declared by the instance, served by the gateway | Webhooks and reverse WS skip gateway authentication; the plugin authenticates them itself |

The IPC protocol between gateway and instance (message types, version) is defined in `@zhin.js/host-http/bridge` and shared by both; on a version mismatch the gateway rejects the instance. The gateway resolves `zhin.js/instance` from the project's `node_modules` and starts it as a child process; it bundles no instance code. One instance per project is supported (modelled internally as `instanceId = 'default'`).

### Instance composition root: `zhin.js/instance` {#composition-root}

The framework itself does not "start" anything -- each layer only provides mechanisms. The entry that wires them into a runnable instance is `zhin.js/instance` (`packages/im/zhin/src/instance/`), the only composition root in the repository allowed to combine every IM package. IM and Agent domain Host implementations live in their domain packages (`@zhin.js/core/runtime`, `@zhin.js/agent/runtime` and `@zhin.js/pagemanager`); installers for the generic HTTP, Protocol, Speech and HTML-Renderer Hosts live in `packages/im/zhin/src/instance/`.

When the instance starts it:

1. wraps the single YAML/JSON Root configuration in a transactional `ConfigDocumentPort` with `createConfigDocument` (`@zhin.js/runtime`);
2. creates a `RootRuntime` (`@zhin.js/runtime`) with the module loader, configuration port and Root resource installers;
3. assembles Host-level resources through `installResources`: HTTP (`BridgedHttpHost`) / Protocol / Speech / HTML-Renderer Hosts, Database / Outbound / Inbox / IM Hosts (`@zhin.js/core/runtime`), Agent / Inference Hosts (`@zhin.js/agent/runtime`), Console shell and Blueprint routes (`@zhin.js/pagemanager`);
4. after the first generation commits, sends `ready` (with protocol version and route table) to the gateway, then attaches the `HmrCoordinator`: file changes trigger generation reloads, and a whole-process restart is requested with `restart-request`.

Without a control channel `zhin.js/instance` refuses to start; `zhin start --standalone` is for development and tests only, and then the instance runs its own Node HTTP server and assembles sign-in and the terminal in-process.

So the user project's entry can be tiny. The scaffolded `package.json` (excerpt, dependencies omitted — the runtime dependency is `zhin.js`, the dev dependency `@zhin.js/cli`, which brings `@zhin.js/gateway`):

```json
{
  "type": "module",
  "scripts": {
    "dev": "zhin start --foreground --watch source config",
    "start": "zhin start --foreground --mode production --no-watch",
    "stop": "zhin stop"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [],
    "plugins": []
  }
}
```

The project itself is a plugin (the Root Plugin); the instance launched by the gateway discovers and starts it. Start commands in full: [zhin start](../cli/runtime.md); manifest fields: [Plugin model](./plugin-model.md); configuration declaration and validation: [Config as data](./config-as-data.md).

## Corollaries of the layering rules

When writing a Feature (a new capability type), depend only on `feature-kit` / `plugin-runtime` -- do not import `core`. `kernel` and `ai` know nothing about IM concepts like "group" or "direct message"; IM concepts only appear in `core` and above. Host packages (`packages/host/http`, `mcp`, `a2a`) sit above `core` and are assembled by the instance composition root `zhin.js/instance`; plugins do not depend on Host processes directly.

## JSX and visual components

`@zhin.js/jsx` owns lazy JSX trees and an HTML serializer, depending only on the canonical IM contract types. Core lays out JSX as ordered Segments; only `<html>` / `<Html>` children become `segment.html`. Native lowercase tags are typed without imports, and registered components can be used as named tags; `zhin.js/jsx` is the authoring facade. Optional `@zhin.js/components` uses this base plus Markdown parsing and syntax highlighting dependencies, accepts `JSXRenderable` display props and does not depend on Core, React or image engines. Render tools consume HTML; adapters declare platform policies.

```tsx
// 1. Native message JSX (auto-degrades to platform cards/buttons or numbered menus)
<card title="Build Status">
  <text>All checks passed</text>
  <button onClick={async () => 'Release triggered'}>Deploy to Production</button>
</card>

// 2. HTML subtree (rendered into an image segment via @zhin.js/html-renderer)
<html>
  <div style={{ padding: '24px', background: '#0f172a', color: '#f8fafc' }}>Status Board</div>
</html>
```
