import { describe, expect, it } from 'vitest';
import {
  typeScriptModules,
  type DirectoryEntry,
  type DiscoveryHost,
} from '../src/index.js';

describe('typeScriptModules runtime extensions', () => {
  it('prefers TypeScript in a workspace even when build output exists', async () => {
    const sources = await discover('/workspace/plugin', [
      { name: 'status.js', kind: 'file' },
      { name: 'status.ts', kind: 'file' },
    ]);

    expect(sources).toEqual(['/workspace/plugin/tools/status.ts']);
  });

  it('discovers snake_case filenames matching capability local names', async () => {
    const sources = await discover('/workspace/plugin', [
      { name: 'send_user_like.ts', kind: 'file' },
      { name: 'friend-list.ts', kind: 'file' },
      { name: 'IgnoreMe.ts', kind: 'file' },
    ]);

    expect(sources).toEqual([
      '/workspace/plugin/tools/friend-list.ts',
      '/workspace/plugin/tools/send_user_like.ts',
    ]);
  });

  it('prefers JavaScript under node_modules and accepts mjs/cjs', async () => {
    const root = '/workspace/node_modules/@test/plugin';
    const sources = await discover(root, [
      { name: 'alpha.ts', kind: 'file' },
      { name: 'alpha.js', kind: 'file' },
      { name: 'beta.mjs', kind: 'file' },
      { name: 'gamma.cjs', kind: 'file' },
    ]);

    expect(sources).toEqual([
      `${root}/tools/alpha.js`,
      `${root}/tools/beta.mjs`,
      `${root}/tools/gamma.cjs`,
    ]);
  });
});

async function discover(
  packageRoot: string,
  entries: readonly DirectoryEntry[],
): Promise<string[]> {
  const host: DiscoveryHost = {
    async list(directory) {
      return directory === `${packageRoot}/tools` ? entries : [];
    },
    async loadModule<T>() {
      return {} as T;
    },
    async readText() {
      return '';
    },
  };
  const convention = typeScriptModules({
    id: 'tools',
    directory: 'tools',
  });
  const sources: string[] = [];
  for await (const source of convention.discover({
    owner: 'root' as never,
    packageRoot,
    host,
  })) {
    sources.push(source.source);
  }
  return sources;
}
