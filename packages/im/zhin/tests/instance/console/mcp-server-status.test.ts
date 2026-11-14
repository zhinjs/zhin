import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { rootPluginId, tokenId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { listMcpServerStatus } from '../../../src/instance/console/agent-runtime-resolver.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function snapshotWith(servers: readonly unknown[] | undefined): RuntimeSnapshot {
  const root = rootPluginId();
  const resources = new Map<string, unknown>();
  if (servers) resources.set(tokenId('zhin.host.agent'), { introspection: { listMcpServers: () => servers, listTools: () => [] } });
  return { root, resources: new Map([[root, resources]]) } as unknown as RuntimeSnapshot;
}

describe('MCP server status rows (#1250)', () => {
  it('says why a server is not connected: failed with lastError, idle (lazy), or not loaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-mcp-status-'));
    roots.push(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({
      configVersion: 2,
      ai: { mcpServers: [
        { name: 'search', transport: 'stdio' }, { name: 'docs', transport: 'sse' },
        { name: 'files', transport: 'stdio' }, { name: 'web', transport: 'streamable-http' },
      ] },
    }));
    const lastError = { category: 'auth', message: 'HTTP 401 Unauthorized', at: 1 };
    const rows = listMcpServerStatus(root, snapshotWith([
      { name: 'search', connected: false, toolCount: 0, lastError },
      { name: 'docs', connected: false, toolCount: 0 },
      { name: 'web', connected: true, toolCount: 3 },
    ]));
    expect(rows).toEqual([
      { name: 'search', connected: false, toolCount: 0, transport: 'stdio', status: 'failed', lastError },
      { name: 'docs', connected: false, toolCount: 0, transport: 'sse', status: 'idle' },
      { name: 'files', connected: false, toolCount: 0, transport: 'stdio', status: 'not_loaded' },
      { name: 'web', connected: true, toolCount: 3, transport: 'streamable-http', status: 'connected' },
    ]);
  });
});
