#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'cli.js');

if (!existsSync(cliEntry)) {
  console.error(
    '@zhin.js/cli is not built yet. Run: pnpm --filter @zhin.js/cli build',
  );
  process.exit(1);
}

await import(cliEntry);
