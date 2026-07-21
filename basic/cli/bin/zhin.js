#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Suppress Node ExperimentalWarning (type-stripping / node:sqlite) before CLI load.
if (!globalThis.__zhinExperimentalWarningsSuppressed) {
  globalThis.__zhinExperimentalWarningsSuppressed = true;
  const originalEmit = process.emit.bind(process);
  process.emit = /** @type {typeof process.emit} */ ((event, ...args) => {
    if (
      event === 'warning'
      && args[0] instanceof Error
      && args[0].name === 'ExperimentalWarning'
    ) {
      return false;
    }
    return Reflect.apply(originalEmit, process, [event, ...args]);
  });
}

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'cli.js');

if (!existsSync(cliEntry)) {
  console.error(
    '@zhin.js/cli is not built yet. Run: pnpm --filter @zhin.js/cli build',
  );
  process.exit(1);
}

await import(cliEntry);
