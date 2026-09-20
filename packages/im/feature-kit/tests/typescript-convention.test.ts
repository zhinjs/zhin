import { describe, expect, it } from 'vitest';
import {
  capture,
  directoryModules,
  type DirectoryEntry,
  type DiscoveryHost,
} from '../src/index.js';

describe('directoryModules', () => {
  it('discovers named index modules and tracks colocated support files', async () => {
    const host: DiscoveryHost = {
      async list(directory) {
        return ({
          '/workspace/plugin/tools': [
            { name: 'send_user_like', kind: 'directory' },
            { name: 'Invalid', kind: 'directory' },
          ],
          '/workspace/plugin/tools/send_user_like': [
            { name: 'index.js', kind: 'file' },
            { name: 'index.ts', kind: 'file' },
            { name: 'client.ts', kind: 'file' },
          ],
        } satisfies Record<string, DirectoryEntry[]>)[directory] ?? [];
      },
      async loadModule<T>() { return {} as T; },
      async readText() { return ''; },
    };
    const convention = directoryModules({
      id: 'named-tools',
      layouts: [{
        segments: ['tools', capture('tool', 'identifier')],
        localName: ({ tool }) => tool!,
      }],
    });
    const sources = [];
    for await (const source of convention.discover({
      owner: 'root' as never,
      packageRoot: '/workspace/plugin',
      host,
    })) sources.push(source);

    expect(sources).toEqual([{
      localName: 'send_user_like',
      source: '/workspace/plugin/tools/send_user_like/index.ts',
      relatedSources: [
        '/workspace/plugin/tools/send_user_like/index.js',
        '/workspace/plugin/tools/send_user_like/client.ts',
      ],
      target: 'server',
    }]);
  });
});
