#!/usr/bin/env node
/**
 * Build the official Console against packed workspace artifacts.
 *
 * This deliberately crosses the publish seam: the Console never sees workspace
 * source or a manually replaced node_modules directory.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleSource = process.env.ZHIN_CONSOLE_DIR
  ? path.resolve(process.env.ZHIN_CONSOLE_DIR)
  : null;

if (!consoleSource) {
  console.error('ZHIN_CONSOLE_DIR must point to a checkout of github.com/zhinjs/console');
  process.exit(2);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zhin-console-contract-'));
const packDir = path.join(tempRoot, 'packs');
const consoleDir = path.join(tempRoot, 'console');

function pnpm(args, cwd) {
  execFileSync('pnpm', args, { cwd, stdio: 'inherit', env: process.env });
}

function readPackedManifest(tarball) {
  return JSON.parse(execFileSync(
    'tar',
    ['-xOf', tarball, 'package/package.json'],
    { encoding: 'utf8' },
  ));
}

async function singlePack(prefix) {
  const names = (await readdir(packDir)).filter((name) =>
    name.startsWith(prefix) && name.endsWith('.tgz'));
  if (names.length !== 1) {
    throw new Error(`Expected one ${prefix} tarball, found: ${names.join(', ') || 'none'}`);
  }
  return path.join(packDir, names[0]);
}

try {
  await mkdir(packDir, { recursive: true });
  pnpm([
    '--filter', '@zhin.js/console-protocol',
    '--filter', '@zhin.js/client',
    'build',
  ], repoRoot);
  pnpm(['pack', '--pack-destination', packDir], path.join(repoRoot, 'packages/console/protocol'));
  pnpm(['pack', '--pack-destination', packDir], path.join(repoRoot, 'packages/console/client'));

  await cp(consoleSource, consoleDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(consoleSource, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== '.git' && first !== 'node_modules' && first !== 'dist';
    },
  });

  const protocolPack = await singlePack('zhin.js-console-protocol-');
  const clientPack = await singlePack('zhin.js-client-');
  const protocolManifest = readPackedManifest(protocolPack);
  const clientManifest = readPackedManifest(clientPack);
  if (clientManifest.dependencies?.['@zhin.js/console-protocol'] !== protocolManifest.version) {
    throw new Error(
      'Packed @zhin.js/client must depend on the packed @zhin.js/console-protocol version',
    );
  }
  pnpm(['install', '--frozen-lockfile'], consoleDir);
  pnpm([
    'add', '--save-prod', '--save-exact',
    `file:${protocolPack}`,
    `file:${clientPack}`,
  ], consoleDir);
  pnpm(['build'], consoleDir);
  console.log('Console publish-contract check passed.');
} finally {
  if (process.env.KEEP_CONSOLE_CONTRACT_TEMP === '1') {
    console.log(`Preserved contract workspace: ${tempRoot}`);
  } else {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
