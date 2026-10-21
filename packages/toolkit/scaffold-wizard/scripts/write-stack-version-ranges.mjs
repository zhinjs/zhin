#!/usr/bin/env node
/**
 * prepack: write lib/stack-version-ranges.json from the monorepo so the published scaffold
 * writes the versions released together with it (instead of `latest`). postpack: --clean.
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectStackVersionRanges,
  findZhinWorkspaceRoot,
  STACK_VERSION_RANGES_FILE,
} from '../lib/stack-version-ranges.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(packageRoot, 'lib', STACK_VERSION_RANGES_FILE);

if (process.argv.includes('--clean')) {
  await rm(outputFile, { force: true });
} else {
  const workspaceRoot = findZhinWorkspaceRoot(packageRoot);
  if (!workspaceRoot) throw new Error('write-stack-version-ranges: run inside the zhin monorepo');
  const ranges = collectStackVersionRanges(workspaceRoot);
  if (!ranges['zhin.js']) throw new Error('write-stack-version-ranges: zhin.js version not found');
  await writeFile(outputFile, `${JSON.stringify(ranges, null, 2)}\n`);
  console.log(`Wrote ${path.relative(packageRoot, outputFile)} (${Object.keys(ranges).length} packages)`);
}
