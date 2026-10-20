#!/usr/bin/env node
// `zhin` on npm is an alias of @zhin.js/cli (4.0 and later): `npx zhin <args>`
// behaves exactly like `npx @zhin.js/cli <args>`.
//
// The CLI runs in this same process rather than a child, so argv, stdio,
// exit codes and signals (Ctrl-C, SIGTERM, …) reach it unchanged, and the
// CLI's own supervisor keeps working when it re-spawns `process.argv[1]`.
import { pathToFileURL } from 'node:url';
import { findCliBin } from './resolve-cli.js';

let cliBin;
try {
  cliBin = findCliBin();
} catch (error) {
  console.error(`zhin: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Install it with: npm install @zhin.js/cli  (or run: npx @zhin.js/cli)');
  process.exit(1);
}
process.argv[1] = cliBin;
await import(pathToFileURL(cliBin).href);
