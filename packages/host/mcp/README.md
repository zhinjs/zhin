# @zhin.js/mcp

`@zhin.js/mcp` exposes the current Zhin Bot's **Tools** to external MCP clients over stateless Streamable HTTP. `@zhin.js/cli` mounts the Host when the project has a top-level `mcp:` configuration. Importing this package by itself does not start a server or register a plugin.

This is the MCP **server**. To let a Zhin Agent consume tools from another server, configure the separate [`ai.mcpServers`](../../../docs/ai/index.md#ai-mcpservers) client connection.

## Install and enable

In a project that already uses `zhin runtime start`:

```bash
pnpm add @zhin.js/mcp @zhin.js/agent zod ai
```

The CLI's MCP Host uses the optional Agent runtime to obtain a generation-bound Tool snapshot. Add the following to `zhin.config.yml`:

```yaml
http:
  port: 8068
  token: ${HTTP_TOKEN}

mcp:
  enabled: true
  path: /mcp
  token: ${HTTP_TOKEN}                  # optional; falls back to http.token
  allowUnauthenticatedLocalhost: false  # require Bearer even in development
```

Start the project with `pnpm dev` or `zhin runtime start`. Use the HTTP address printed at startup: new scaffolded projects currently use port **8068**, while the Runtime fallback without an `http:` configuration is **8086**. The MCP endpoint uses `mcp.path` (default `/mcp`). Omitting `mcp:` does not enable it.

## Connect a client

Configure an MCP client for Streamable HTTP at the Host's URL, for example `http://127.0.0.1:8068/mcp`. Send `Authorization: Bearer <HTTP_TOKEN>` when using the configuration above. Keep the token in the client's secret store rather than committing it to a config file.

For a direct protocol smoke test:

```bash
curl -sS -X POST http://127.0.0.1:8068/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $HTTP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

The endpoint accepts **POST** requests; GET and DELETE return 405. Each request has its own transport and execution context. A configured token is checked using Bearer authentication. Production requests always require authentication; development requests from localhost can omit it only when `allowUnauthenticatedLocalhost` is not `false`.

## What the server exposes

`tools/list` returns Tools currently visible through the active generation's governed capability snapshot. `tools/call` executes them through the same permission, safety, approval, and cancellation authority used by Agent turns. MCP calls are unattended: a Tool that needs interactive approval cannot obtain it from this endpoint and must fail rather than silently run.

The current Runtime Host registers **Tools only**. It does not register the legacy `create_plugin` / `create_command` generators, documentation Resources, or workflow Prompts described in older versions of this README. Use [`zhin new`](../../../docs/cli/index.md) for project scaffolding.

Source of truth: [`src/runtime.ts`](./src/runtime.ts) for transport and Tool projection, [`src/mesh-auth.ts`](./src/mesh-auth.ts) for authentication, and [`protocol-host-installer.ts`](../../../basic/cli/src/plugin-runtime/protocol-host-installer.ts) for CLI assembly.
