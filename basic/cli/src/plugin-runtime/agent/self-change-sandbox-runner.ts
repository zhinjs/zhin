/**
 * ADR 0040 §3.3 trial runtime. Runs in a disposable child process, never in the Host realm.
 *
 * argv[2] is a temporary copy of one plugin root with the draft applied. The runtime installs only
 * the IM runtime and no configured plugin instances or endpoints, so nothing can reach a real
 * platform, and no model is configured. Prints one JSON line on stdout:
 * `{ ok: true, capabilities: [{ feature, localName, source }] }` (source relative to the root) or
 * `{ ok: false, error }`.
 */
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { ImRuntime } from '@zhin.js/core/runtime';
import { NativeDevelopmentModuleRuntime, RootRuntime } from '@zhin.js/runtime';
import { createTsxModuleLoader } from '../start/tsx-module-loader.js';

const MAX_ERROR_CHARS = 2_000;

async function main(projectRoot: string | undefined): Promise<void> {
  if (!projectRoot) throw new Error('missing trial project root');
  const root = realpathSync(projectRoot);
  const im = new ImRuntime({});
  const modules = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false, tsxLoader: createTsxModuleLoader(root) });
  const runtime = new RootRuntime({
    projectRoot: root,
    modules,
    config: { configVersion: 2, plugins: {} },
    environment: { name: 'trial', mode: 'test', platform: 'node' },
    installResources: context => { im.install(context.resources); },
  });
  im.attach(runtime.snapshots);
  try {
    const snapshot = await runtime.start();
    const capabilities = [...snapshot.capabilities.values()].map(slot => ({
      feature: String(slot.feature),
      localName: slot.localName,
      source: toLocal(root, projectRoot, slot.source),
    }));
    process.stdout.write(`${JSON.stringify({ ok: true, capabilities })}\n`);
  } finally {
    await runtime.stop().catch(() => undefined);
  }
}

function toLocal(root: string, given: string, source: string): string {
  const base = source.startsWith(root + sep) ? root : given;
  return relative(base, source).split(sep).join('/');
}

main(process.argv[2]).then(() => process.exit(0), (error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message.slice(0, MAX_ERROR_CHARS) })}\n`);
  process.exit(1);
});
