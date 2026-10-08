import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Exercise the exact pnpm patch before/after installation, without changing node_modules. */
export async function loadPatchedKookFixture() {
  const require = createRequire(import.meta.url);
  const root = dirname(dirname(require.resolve('kook-client')));
  const directory = mkdtempSync(join(tmpdir(), 'zhin-kook-sdk-'));
  cpSync(root, directory, { recursive: true, filter: source => !['.env', 'node_modules'].includes(source.slice(source.lastIndexOf('/') + 1)) });
  if (!readFileSync(join(directory, 'lib/core/receivers/websocket.js'), 'utf8').includes('this.config.socketFactory')) {
    execFileSync('git', ['apply', join(process.cwd(), 'patches/kook-client@1.0.4.patch')], { cwd: directory });
  }
  if (!readFileSync(join(directory, 'lib/client.js'), 'utf8').includes('this.config.handleProcessErrors')) {
    const patch = readFileSync(join(process.cwd(), 'patches/kook-client@1.0.4.patch'), 'utf8');
    const clientDelta = '--- a/lib/client.js' + patch.split('--- a/lib/client.js')[1];
    execFileSync('git', ['apply'], { cwd: directory, input: clientDelta });
  }
  symlinkSync(dirname(root), join(directory, 'node_modules'), 'dir');
  const sdk = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'lib/index.js')).href);
  return { sdk, close: () => {
    rmSync(directory, { recursive: true, force: true });
  } };
}
