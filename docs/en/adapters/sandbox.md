---
title: "@zhin.js/adapter-sandbox"
package: "@zhin.js/adapter-sandbox"
tier: Stable
---

::: info Documentation Sync
This page translates [`plugins/adapters/sandbox/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/sandbox/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=a6fa99a21ab163aa -->

# @zhin.js/adapter-sandbox

Zhin.js Sandbox adapter — a WebSocket-based local testing adapter. The browser-side chat UI opens a Sandbox window for debugging in the **[Remote Console](https://console.zhin.dev)** (Host exposes only the Console API).

## Features

- **Node Host**: WebSocket `/sandbox`
- Browser-side React chat UI
- Supports multiple simultaneous client connections
- No third-party platform account required — works out of the box
- Ideal for local development and plugin debugging

## Installation

```bash
pnpm add @zhin.js/adapter-sandbox
```

## Prerequisites

Sandbox needs no external account. Start the project with `zhin start` (the management gateway serves HTTP and forwards the instance's routes) and ensure the browser can reach the Host address printed at startup.

## Dependencies

### Plugin Runtime (`zhin start`)

- `@zhin.js/adapter` — convention-based `adapters/sandbox/index.ts`
- `@zhin.js/host-http` — `httpHostToken` provided by Root (WebSocket `/sandbox` + Console HTTP)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/page` + `pages/index/index.tsx` — ADR 0046 convention page (`definePage`; route `/sandbox`)

The instance `zhin start` launches loads `@zhin.js/host-http`, `ConsoleRuntime`, and `ClientBuildModuleRuntime` (the management gateway listens for HTTP and forwards). Open `http://<host>:<port>/console` to browse pages. The Sandbox page (route `/sandbox`, sharing the same path as WebSocket `/sandbox`: GET opens the page, Upgrade goes to WS) has a built-in chat shell.

The old `client/` (`register(api)` / `pageManager.addEntry`) is kept only as a reference for the legacy Host stack and is **not** the Plugin Runtime production entry point.

### Legacy Host Stack (removed)

The original legacy plugin packages `@zhin.js/host-router` (HTTP service) and `@zhin.js/host-api` (Host-side Console API, `addEntry` to register Sandbox extensions) have been removed. `zhin dev` now auto-assembles the Console/HTTP Host via `@zhin.js/cli` (`@zhin.js/host-http` + `@zhin.js/pagemanager`), so no Host plugins need to be installed.

- `@zhin.js/client` — Remote Console client SDK (UI lives in the zhin-console repo)

The outbound wire only does JSON wrapping; the old `segment-mapper` (canonical segments) normalization has been lifted to the gateway/core render chain.

## Configuration

**Recommended (consistent with [minimal-bot](/getting-started/))**: `sandbox.endpoints: []` creates the stable default endpoint `sandbox-bot` when the plugin starts.

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  sandbox: "@zhin.js/adapter-sandbox"
sandbox:
  endpoints: []
```

Optional: if you want a **fixed-name** offline placeholder bot to appear in the bot list on startup, configure it explicitly:

```yaml
configVersion: 2
plugins:
  sandbox: "@zhin.js/adapter-sandbox"
sandbox:
  endpoints:
    - id: sandbox-bot
      owner: sandbox-user
```


## Managing accounts in the Console

Like other adapters, Sandbox accounts can be added, stopped, started and removed on the account Access tab in the Console (fields: `owner`, `nickname`, `commandPrefix`). A new account is saved stopped; start it explicitly. Viewing needs `sandbox:read`; adding, removing, starting and stopping need `sandbox:write`.

## Usage

1. Start the Zhin instance: `pnpm dev` (the terminal will print the Host address, typically `http://127.0.0.1:8068`)
2. Open the **[Remote Console](https://console.zhin.dev)**, set the API Base to match the Host address, and sign in with a Console account (on the first connection, use `http.token` / `HTTP_TOKEN` to create the owner)
3. Send messages for testing on the Console **Try a conversation** page (`/sandbox`) after connecting

The Sandbox plugin creates one endpoint from each configured entry. With an empty endpoint list, it creates the stable `sandbox-bot` default.

Each endpoint mounts one WebSocket path on the HTTP Host provided by the Root (`httpHostToken`); the protocol is described under "Message Format (wire protocol)" below.

## Message Format (wire protocol)

The Console Sandbox page and any test client you write use this protocol. Every WebSocket text frame is one UTF-8 JSON object.

### Connecting

- **URL**: `ws://<host>:<port>/sandbox`. On one HTTP Host the first Sandbox endpoint mounts `/sandbox`; the others mount `/sandbox/<endpoint id>` (with `-2`, `-3`… on a name clash). The startup log prints `ws mounted <path>`.
- **Auth**: when the Host requires credentials (`http.token` is set or setup is done), the handshake must carry a Console credential, `Authorization: Bearer <session or API token>` or `?token=`, for an account holding `endpoint.operate` (owners, admins, operators); otherwise it gets `401`. The bootstrap token cannot connect.
- **Concurrent connections**: pages sharing an endpoint keep separate `connectionId`s and the configured `owner`. The connection ID does not change the Bot or Agent session identity. Closing a page removes only that connection, without cancelling or restarting a task. Endpoint stop closes all connections with `1001`; generation retirement still closes them through the Host with `1012`.
- **Conversation delivery**: each connection subscribes to one `type` + `id`, initially `private` + `owner`. Sending a normal input also selects its conversation. Replies reach matching connections only. No matching connection means `not_sent`; all send attempts failing leaves delivery `unknown`. There is no automatic retry.

### Client → server: subscribe to a conversation

Send this only after the current connection advertises `ready.protocol: "scoped-conversations-v1"`:

```json
{"op":"subscribe","conversation":{"type":"group","id":"test-group"}}
```

The type is `private`, `group`, or `channel`. This replaces the connection's subscription; the server acknowledges with `type: "subscribed"` and the same `conversation`. Control frames never enter commands, the Agent, or platform message hooks.

Subscribed pages receive user-input echoes marked `direction: "inbound"`, with the configured `senderId` and the original `messageId`. These update the view without submitting another input. Legacy clients still send their existing message format and receive replies but do not receive input echoes. New pages connected to an older Host keep the original send path and do not send unsupported control frames. Reconnection restores the subscription without resubmitting messages.

### Client → server: send a message

```json
{
  "type": "group",
  "id": "test-group",
  "content": [{ "type": "text", "data": { "text": "/hello" } }],
  "messageId": "client-msg-001",
  "timestamp": 1700000000000
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `private` \| `group` \| `channel` \| `direct` \| `guild` | Conversation kind, default `private`. `direct` is treated as `private`, `guild` as `channel` |
| `id` | string | Conversation id; defaults to the endpoint `owner` (default `sandbox-user`) |
| `content` | string or segment array | Segments are `{ "type": string, "data": object }`; a string equals one `text` segment |
| `text` | string | Optional. Plain text when `content` is missing; also used as the message text when `content` has no text segment |
| `messageId` | string | Optional client-generated id matching `^[A-Za-z0-9._:-]{1,160}$` (ignored otherwise). It becomes the id of this inbound message, so a quoted reply can find it |
| `timestamp` | number | Optional. Milliseconds; defaults to the time the server received it |
| `agentRun` | object | Optional **Conversations** run config, see below |

- A frame that is not JSON is handled as one plain-text message.
- The sender is always the endpoint `owner`.
- **Button callbacks**: an `{ "type": "action", "data": { "id": "...", "payload": "..." } }` segment in `content` reaches commands or the Agent as an interaction; if only `id` or `payload` is set, the other takes the same value. When the message has no text, `payload` becomes the message text.

`agentRun` fields:

| Field | Values | Default |
| --- | --- | --- |
| `workingDirectory` | string, up to 4096 characters | `""` |
| `safetyMode` | `read-only` \| `workspace-write` \| `danger-full-access` | `workspace-write` |
| `approvalMode` | `ask` \| `auto` \| `bypass` | `ask` |
| `networkAccess` | boolean | `false`; always `true` when `safetyMode` is `danger-full-access` |

Unrecognised values fall back to the defaults.

### Server → client

**Ready**: sent once after every successful connection.

```json
{
  "type": "ready",
  "protocol": "scoped-conversations-v1",
  "connectionId": "connection-uuid",
  "id": "sandbox-user",
  "endpoint": "sandbox-bot",
  "workingDirectory": "/path/to/bot",
  "canExecute": true,
  "shellIsolation": { "available": false, "provider": "docker", "message": "Docker daemon is unavailable" },
  "content": [{ "type": "text", "data": { "text": "已连接 Sandbox「sandbox-bot」…" } }],
  "timestamp": 1700000000000
}
```

`canExecute` tells whether the connection can run commands and Agent tasks (every authenticated connection can); `shellIsolation` is the Docker isolation probe result, for display only. Ready and subscription acknowledgements do not confirm task completion or approval.

**Replies**:

```json
{
  "type": "group",
  "id": "test-group",
  "bot": "sandbox-bot",
  "endpoint": "sandbox-bot",
  "content": [{ "type": "text", "data": { "text": "Hello!" } }],
  "timestamp": 1700000000001
}
```

- `conversation: { type, id }` identifies the canonical conversation from the framework's send request. New clients use it even if a legacy envelope supplies conflicting `type` / `id` fields. `bot` and `endpoint` are the configured endpoint ID; the original address fields remain readable by older clients.
- `messageId` is shared by the live frame and canonical delivery receipt; valid explicit IDs from legacy envelopes remain unchanged.
- `content` is a segment array. Text, `html` (JSX cards, see `html: direct` above), buttons and other segments pass through unchanged.
- `image` / `audio` / `video` / `file` segments read only `data.media` (MediaRef): `url` passes through; `base64` is inlined with a `base64://` prefix; `path` is read by the server and inlined as `base64`; other kinds and media segments without `data.media` are dropped and logged as `sandbox_outbound_media_dropped`.
- When a plugin sends a complete message object, its other fields are kept as they are.

Clients merge optimistic messages and input echoes by conversation, direction, and `messageId`. Approval decisions remain on the existing server interaction path; submitting a button does not mean approval succeeded. This change does not add offline result storage, cross-browser history restoration, or multiple operator accounts.

## Use Cases

- Local development and debugging of plugin logic
- Testing commands and AI tool invocations
- Feature verification without depending on external platforms

## AI Tools

See `skills/sandbox/SKILL.md` for skill documentation (local sandbox debugging constraints).


## Troubleshooting

| Symptom | Check |
| --- | --- |
| Console cannot connect | Host, port, and token printed at startup |
| Sandbox is blank | HTTP Host port degradation and browser authentication/CORS errors |
| History is missing after refresh | Current Endpoint/channel, history RPC, and recovery-gap logs |
| Command or Tool is absent | Publication in the current generation under Runtime Capabilities |

## License

MIT License
