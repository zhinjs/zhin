---
title: Message Scenario Lab
description: Preview expected messages locally in Console, then explicitly run exported PluginTestKit regressions in a trusted, independent test project.
---

# Message Scenario Lab

## Want to see a message before running a plugin?

Open **Message Scenario Lab** (`/scenario-lab`) in Console and provide the source, sender, future input and authored expected output. Text displays directly. The Markdown subset supports headings, paragraphs, lists, quotes, fenced code and simple tables; unsupported syntax falls back to source text.

The page does not execute plugins, components or business tools, call Host render APIs, send or replay messages, or register button callbacks. HTML remains source text without Shotium. Media uses placeholders without reading local files or fetching remote resources. Buttons are disabled displays.

The **text endpoint** and **HTML / Markdown preservation** profiles describe synthetic endpoint capabilities, not a platform's appearance. Readable Markdown is not proof of native platform rendering; HTML source is not a rendered image. Verify final conversion and delivery separately.

You explicitly supply the full endpoint identity, conversation kind/ID, optional parent and thread. Example identities do not represent logged-in accounts on the current Host. The page neither reads production configuration nor persists drafts. Export `scenario.json` before leaving, and do not enter credentials.

## Why is executable export still disabled?

`preview` describes the **author's expected appearance**. `assertions` separately specifies **final dispatch and delivery expectations**. Neither is inferred from the other.

| Field | Purpose |
| --- | --- |
| `sourceTarget` | Full source identity: `endpoint.id`, `endpoint.adapter`, `kind`, `id`, optional `parent` and `threadId` |
| `sender` | Test sender; omitted `roles` and explicit `roles: []` remain distinct, neither proves actual platform roles |
| `input` | Text for a future real `PluginTestKit.receive()` call, never dispatched in the page |
| `preview` | Authored native JSON `Segment[]`; no JSX source, functions, component calls or `raw` |
| `fixture` | Explicit synthetic endpoint alias and independent `configVersion: 2` test configuration |
| `assertions.dispatchStatus` | Explicit `executed`, `invalid`, `denied`, `unmatched` or `limited`; `limited` requires a Runtime supporting that state |
| `assertions.deliveries` | One final payload per item, as a string or native segment array; `[]` explicitly expects no delivery |

Executable export requires test configuration, endpoint mapping, nonempty input and explicit assertions. Otherwise you can still export valid scenario JSON. The page does not create skipped tests, empty assertions or purported passing results.

A permission denial can send a reply. Do not infer zero deliveries from `denied`: the test project below replies with `没有权限执行此指令。`, so a denial scenario must include that final payload in its assertion.

## How do I create a runnable independent fixture?

Use Node.js `>=22.19.0` and a new **trusted directory without production configuration or credentials**. Do not point it at a running Bot project or mount real adapters.

Create `package.json`:

```json
{
  "name": "message-scenario-fixture",
  "private": true,
  "type": "module",
  "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts" }
}
```

Install the actual dependencies in that directory:

```bash
pnpm add zhin.js @zhin.js/command
pnpm add -D @zhin.js/testing @zhin.js/plugin-runtime @zhin.js/adapter tsx
```

`plugin.ts`:

```ts
import { definePlugin, Schema } from 'zhin.js';

export default definePlugin({
  name: 'scenario-fixture',
  config: Schema.object({ commandPrefix: Schema.string().default('') }),
});
```

`commands/hello/index.ts`:

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  permit: ['role(admin)'],
  execute: ({ input }) => [{
    type: 'text',
    data: { text: '你好，' + (input.sender?.name ?? input.sender?.id ?? '访客') },
  }],
});
```

Fill in this scenario or import it as JSON. The independent configuration declares only `configVersion: 2`, without production plugin mounts or credentials:

```json
{
  "schemaVersion": 1,
  "name": "完整来源身份与原生文本回复",
  "sourceTarget": {
    "endpoint": { "id": "root/source\u0000zhin.adapter\u0000example", "adapter": "example" },
    "kind": "channel",
    "id": "test-room",
    "parent": { "kind": "channel", "id": "test-workspace" },
    "threadId": "test-thread"
  },
  "sender": { "id": "test-author", "name": "测试成员", "roles": ["admin"] },
  "input": "hello",
  "preview": [{ "type": "text", "data": { "text": "你好，测试成员" } }],
  "profile": "text",
  "fixture": { "syntheticEndpoint": "scenario", "config": { "configVersion": 2 } },
  "assertions": {
    "dispatchStatus": "executed",
    "deliveries": [[{ "type": "text", "data": { "text": "你好，测试成员" } }]]
  }
}
```

Download `scenario.json`, `scenario.test.mjs` and `README.md` separately into that test project root. Explicitly run in a Linux/macOS terminal:

```bash
ZHIN_SCENARIO_FIXTURE_ROOT=/absolute/path/to/test-app node --conditions=development --import tsx --test scenario.test.mjs
```

PowerShell:

```powershell
$env:ZHIN_SCENARIO_FIXTURE_ROOT = 'C:\path\to\test-app'
node --conditions=development --import tsx --test scenario.test.mjs
```

The test project path must be absolute. There is no current-directory or production-config fallback, automatic dependency installation or automatic execution. The kit and fixture must use the same physical Feature Provider package instances: do not mix Vite-loaded and independently Node-loaded copies. See [Testing Plugins](./testing.md) for the full kit contract.

## Will the source account actually be called?

No. `sourceTarget.endpoint` is provenance only. The exported test explicitly maps it to `fixture.syntheticEndpoint`. The synthetic full identity comes from the public `capabilityId(rootPluginId(), adapterFeatureId, alias)` function, never by impersonating the production endpoint ID.

Conversation `kind`, `id`, `parent`, `threadId` and sender remain unchanged. Missing parent/thread fields do not mean wildcards. The test compares every captured full target and final payload. The initial exporter requires all outputs to return to the source conversation through its synthetic endpoint mapping; write a separate test for proactive cross-conversation sends.

`PluginTestKit` runs real discovery, command parsing, permissions and the outbound chain, with synthetic endpoints recording final payloads. It is **not a security sandbox**: plugin imports, `setup()` and custom logic can access host files, use the network or start real adapters. A separate directory and credential-free configuration cannot prevent arbitrary code from accessing the host. Run only trusted fixtures with independent test data and a runtime environment without production credentials. This feature does not provide a remote isolated runner.

## What does a passing result establish?

Exporting does not establish that a plugin passes. A successful run establishes Runtime behavior for that fixture, test roles, capability profile and explicit assertions. It does not establish real platform login, role projection, image fidelity or delivery.

The repository [integration acceptance script](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/testing/tests/run-scenario.mjs) executes files actually exported by Console. It checks successful replies, full parent/thread identity, denied requests with empty/omitted roles, unmatched input, prefix mismatch, and a deliberate wrong-output failure. Keep browser previews, synthetic-endpoint regressions and real-platform sending as separate evidence.
