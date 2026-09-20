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

Wait for the `zhin> ` prompt, then type `/hello` or `/card` in the same terminal. Do not use the
`--once` validation command for interactive sessions. `Ctrl+C` drains the active generation and
closes the terminal Endpoint. Editing a file under `adapters/`, `commands/` or `components/`
triggers a generation transaction without rerunning Plugin setup.

On Windows, `pnpm`/`.cmd` wrappers may additionally ask `Terminate batch job (Y/N)?`
(`终止批处理操作吗(Y/N)?`). Enter `Y` and press Enter to finish the wrapper. To run
without that batch wrapper, open a shell in `examples/minimal-bot` and run:

```bash
node ../../basic/cli/bin/zhin.js runtime start
```

Server capabilities are loaded by Node's native TypeScript loader. Keep them erasable:
use explicit class fields and constructor assignments instead of parameter properties.
The example's TypeScript check enforces this with `erasableSyntaxOnly`.

## Project layout

```text
minimal-bot/
├── plugin.ts                 # definePlugin(), Root lifecycle entry
├── schema.json               # Root-owned configuration contract
├── zhin.config.yml           # plugin / plugins hierarchical config document
├── adapters/$terminal.ts      # defineAdapter(), stdin + stdout Endpoint
├── commands/$hello.ts         # /hello
├── commands/$card.ts          # /card -> component("status-card")
├── components/$status-card.ts # defineComponent(), compiler-free Satori h()
└── agent/tools/$echo.ts       # optional defineAgentTool() example
```

`package.json#zhin` is the topology SSOT. It mounts `@zhin.js/adapter`, `@zhin.js/command` and
`@zhin.js/component`; the Feature providers discover the corresponding directories. There are
no module-level registration side effects.

The Tool authoring Feature is mounted for discovery. Install `@zhin.js/agent`,
`@zhin.js/agent-feature`, Zod, AI SDK packages, and a model provider when enabling Agent execution;
the default IM installation stays small. The complete directory-based Agent examples live in
[`multi-agent-room`](../multi-agent-room/) and [`test-bot`](../test-bot/).
See [agent authoring](../../docs/authoring/agent-tools.md).

## Validate

```bash
pnpm --filter minimal-bot build
pnpm --filter minimal-bot test
pnpm --filter minimal-bot start -- --once
pnpm check:stable
```

The runtime test starts a real Root generation and verifies:

```text
Adapter -> outboundMessageToken -> ImRuntime -> Command -> Component
        -> OutboundRenderer -> AdapterIndex.send
```

Platform adapters and the Remote Console remain separate installable plugins. The complete AI
reference is [full-bot](../full-bot/); the maintainer kitchen sink is [test-bot](../test-bot/).
