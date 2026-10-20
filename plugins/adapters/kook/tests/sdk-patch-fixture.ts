import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Exercise the published SDK in an isolated fixture, without changing node_modules. */
export async function loadPublishedKookFixture() {
  const require = createRequire(import.meta.url);
  const root = dirname(dirname(require.resolve('kook-client')));
  const directory = mkdtempSync(join(tmpdir(), 'zhin-kook-sdk-'));
  cpSync(root, directory, { recursive: true, filter: source => !['.env', 'node_modules'].includes(source.slice(source.lastIndexOf('/') + 1)) });
  symlinkSync(dirname(root), join(directory, 'node_modules'), 'dir');
  const sdk = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'lib/index.js')).href);
  return { sdk, close: () => {
    rmSync(directory, { recursive: true, force: true });
  } };
}
