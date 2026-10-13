# @zhin.js/plugin-test-kit

Test a disposable Plugin Runtime application through real module discovery, configuration validation,
command parsing, permissions, generation admission and the unified outbound chain. Synthetic endpoints
capture the final negotiated platform payload without a platform SDK.

Install the kit as a development dependency. Prepare a separate test application with a real
`package.json#zhin` manifest, `plugin.ts` and the dependencies/features used by its mounted plugins.
The kit neither installs packages nor replaces module resolution. Feature providers must be the same
physical package instance used by the host, as in a normal application.

```ts
import { PluginTestKit } from '@zhin.js/plugin-test-kit';

const kit = await PluginTestKit.create({
  projectRoot: '/absolute/path/to/disposable-test-app',
  endpoints: ['test', 'second'],
  config: { plugins: { suite: { commandNamespace: 'suite' } } },
});
try {
  await kit.start();
  const result = await kit.receive({
    endpoint: 'test',
    conversation: { kind: 'group', id: 'test-group' },
    sender: { id: 'test-member', name: 'Alice', roles: ['admin'] },
    content: 'suite checkin',
  });
  console.log(result?.status, kit.deliveries);
} finally {
  await kit.close();
}
```

The example requires the mounted plugin to provide `suite checkin`. Roles are supplied explicitly by
the fixture; this verifies command admission, not a platform's real role projection. `permissions` is
the real PermissionHost used by the IM runtime.

The test application must contain only trusted test plugins and synthetic endpoints. **This kit is not
a sandbox:** discovered adapters and `setup()` functions execute normally and can open connections,
write files or send real messages. Never point it at a production app or include live credentials.
`emit()` similarly injects an explicit synthetic event; it does not verify an adapter's event contract.

## Operations and lifecycle

- `receive()` enters the synthetic Endpoint event sink, then real ingress/middleware/command dispatch.
- `send()` runs the real renderer, outbound middleware and segment negotiation; terminal captures are
  detached, readonly metadata snapshots in `deliveries`. Node/Web streams remain opaque references: captures do not consume or freeze them, so tests may inspect identity and subsequently read the stream. Byte buffers are copied. `clearDeliveries()` clears captures without reusing message IDs.
- `reloadSource(absolutePath)` submits a changed file to the real HMR coordinator and reports `reloaded`,
  `unchanged`, `failed` or `restart-required`, with the committed generation. Edit the test app first.
  A process restart requirement latches the native coordinator; close this kit and create a new one.
- `patchConfig()` uses normal composition/validation. Invalid patches reject and keep the prior generation.
- `installResources()` installs host-owned public resources, such as a Database Host, Schedule Host or
  a test HTML renderer. The library does not invent storage or a scheduler implementation.
- `close()` is idempotent and must also run after a failed `start()`. Each kit owns its endpoints,
  runtime, caches and captures; there is no global active fixture.

Native Node loading is the default. TypeScript/TSX fixtures require the same process loader as the
application; for example, run the test entry in Node with `--import tsx`. A runner that owns module
loading may provide its public `ModuleRuntime` via `modules`. Do not mix Vite-loaded and Node-loaded
copies of a Feature provider: run native integration fixtures in a child Node process.

## Evidence boundary

The repository fixture mounts two real Group Suite instances, uses real Native module loading and
HMR, and runs the real PluginStateStore over a SQLite compare-exchange test port. It verifies permission
rejection, invalid configuration rollback, exact endpoint/group isolation, persistent keywords after
command HMR, plugin HMR and a fresh Node process, welcome messages and HTML rendering/text fallback.
Its manual clock drives real PluginScheduleHost callbacks and checks retired-generation rejection.

SQLite test-state persistence is real; the fixture's statistics/check-in/teaching model port is volatile.
The HTML renderer is a stub. These tests do **not** prove browser screenshot fidelity, platform
login, delivery, role mapping or production database portability. Real-platform acceptance remains a
separate, explicitly authorized test with an adapter account and harmless target conversation.

## SQLite fixture compatibility

The kit itself supports Node 20.19+ and does not require SQLite. Its base native integration test
runs without importing `node:sqlite`. SQLite-specific repository acceptance requires Node 22.5+;
Node 22.5–22.12 child processes include `--experimental-sqlite`, and Node 20 explicitly skips those
optional persistence cases. They never substitute memory storage while claiming durable persistence.
The selected flags also propagate into the fresh-process restart probe.
