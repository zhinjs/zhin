import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { rootPluginId, tokenId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { listMcpServerStatus } from '../../../src/instance/console/agent-runtime-resolver.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function snapshotWith(servers: readonly unknown[] | undefined, bindings?: readonly unknown[]): RuntimeSnapshot {
  const root = rootPluginId();
  const resources = new Map<string, unknown>();
  if (servers) resources.set(tokenId('zhin.host.agent'), {
    introspection: { listMcpServers: () => servers, listTools: () => [] },
    ...(bindings ? { console: { listBindings: () => bindings } } : {}),
  });
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
      { name: 'search', connected: false, toolCount: 0, transport: 'stdio', status: 'failed', lastError, boundAgents: [] },
      { name: 'docs', connected: false, toolCount: 0, transport: 'sse', status: 'idle', boundAgents: [] },
      { name: 'files', connected: false, toolCount: 0, transport: 'stdio', status: 'not_loaded', boundAgents: [] },
      { name: 'web', connected: true, toolCount: 3, transport: 'streamable-http', status: 'connected', boundAgents: [] },
    ]);
  });

  it('names the Agents that bind each server: the running Agent first, else the configuration (#1250 第 41 批)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-mcp-status-'));
    roots.push(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({
      configVersion: 2,
      ai: {
        mcpServers: [{ name: 'github', transport: 'streamable-http' }, { name: 'docs', transport: 'stdio' }],
        // `ai.agents.zhin: {}` without mcpServers: github is connected but no Agent binds it.
        agents: { zhin: {}, researcher: { mcpServers: ['docs'] } },
      },
    }));
    // Without a running Agent: from the configuration.
    expect(listMcpServerStatus(root, snapshotWith(undefined)).map(row => [row.name, row.boundAgents])).toEqual([
      ['github', []], ['docs', ['researcher']],
    ]);
    // The running Agent's bindings win over the file (e.g. edited but not reloaded yet).
    const rows = listMcpServerStatus(root, snapshotWith(
      [{ name: 'github', connected: true, toolCount: 49 }, { name: 'docs', connected: true, toolCount: 2 }],
      [{ name: 'zhin', mcpServers: ['docs'] }, { name: 'researcher', mcpServers: ['docs', 'docs'] }],
    ));
    expect(rows.map(row => [row.name, row.status, row.boundAgents])).toEqual([
      ['github', 'connected', []], ['docs', 'connected', ['zhin', 'researcher']],
    ]);
  });

  it('counts an object binding entry ({ name, permit }, ADR 0065) as binding its server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-mcp-status-'));
    roots.push(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({
      configVersion: 2,
      ai: {
        mcpServers: [{ name: 'github', transport: 'streamable-http' }, { name: 'docs', transport: 'stdio' }],
        agents: { zhin: { mcpServers: [{ name: 'github', permit: { default: 'owner' } }] }, researcher: { mcpServers: ['docs'] } },
      },
    }));
    expect(listMcpServerStatus(root, snapshotWith(undefined)).map(row => [row.name, row.boundAgents])).toEqual([
      ['github', ['zhin']], ['docs', ['researcher']],
    ]);
    const rows = listMcpServerStatus(root, snapshotWith(
      [{ name: 'github', connected: true, toolCount: 49 }, { name: 'docs', connected: true, toolCount: 2 }],
      [{ name: 'zhin', mcpServers: [{ name: 'github' }, ''] }, { name: 'researcher', mcpServers: ['docs', { permit: {} }] }],
    ));
    expect(rows.map(row => [row.name, row.boundAgents])).toEqual([['github', ['zhin']], ['docs', ['researcher']]]);
  });
});
