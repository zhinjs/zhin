# minimal-bot (Stable golden path)

This is the smallest executable Zhin Plugin Runtime project. It uses the convention-based
Adapter, Command and Component Features and does not initialize the legacy Plugin registry,
Sandbox, Host API, Console or Agent stack.

## Run

Requires Node.js 22.6 or newer. Node 22.6-22.17 is restarted by the CLI with Node's official
`--experimental-strip-types` flag; Node 22.18+ runs TypeScript directly without that flag.

```bash
pnpm install
pnpm --filter minimal-bot dev
```

Type `/hello` or `/card` in the terminal. `Ctrl+C` drains the active generation and closes the
terminal Endpoint. Editing a file under `adapters/`, `commands/` or `components/` triggers a
generation transaction without rerunning Plugin setup.

## Project layout

```text
minimal-bot/
├── plugin.ts                 # definePlugin(), Root lifecycle entry
├── schema.json               # Root-owned configuration contract
├── zhin.config.yml           # plugin / plugins hierarchical config document
├── adapters/terminal.ts      # defineAdapter(), stdin + stdout Endpoint
├── commands/hello.ts         # /hello
├── commands/card.ts          # /card -> component("status-card")
├── components/status-card.ts # defineComponent(), compiler-free Satori h()
├── agents/hello.agent.md     # optional Agent capability authoring example
└── tools/echo.ts             # optional defineAgentTool() example
```

`package.json#zhin` is the topology SSOT. It mounts `@zhin.js/adapter`, `@zhin.js/command` and
`@zhin.js/component`; the Feature providers discover the corresponding directories. There are
no module-level registration side effects.

The Agent and Tool examples are intentionally not mounted by Stable. Add `@zhin.js/agent`, Zod
and the Agent/Tool Feature providers when enabling AI; the default IM installation stays small.
See [agent authoring](../../docs/advanced/agent-authoring.md).

## Validate

```bash
pnpm --filter minimal-bot build
pnpm --filter minimal-bot test
pnpm --filter minimal-bot start -- --once
pnpm check:stable
```

The runtime test starts a real Root generation and verifies:

```text
Adapter -> messageGatewayToken -> ImRuntime -> Command -> Component
        -> OutboundRenderer -> AdapterIndex.send
```

Platform adapters and the Remote Console remain separate installable plugins. The complete AI
reference is [full-bot](../full-bot/); the maintainer kitchen sink is [test-bot](../test-bot/).
