import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId, tokenId, type RuntimeSnapshot, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { registerConsoleRestPages } from '@zhin.js/host-http';
import { createHttpHost, type ProcessHttpHost } from '@zhin.js/host-http/node';
import { createAgentRuntimeLeaseResolver } from '../../../src/instance/console/agent-runtime-resolver.js';

const hosts: ProcessHttpHost[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function readerOf(agentHost: unknown): SnapshotReader {
  const root = rootPluginId();
  const resources = new Map<string, unknown>();
  if (agentHost) resources.set(tokenId('zhin.host.agent'), agentHost);
  const snapshot = { root, resources: new Map([[root, resources]]) } as unknown as RuntimeSnapshot;
  return { acquire: () => ({ value: snapshot, release: () => undefined }) } as unknown as SnapshotReader;
}

async function post(agentHost: unknown): Promise<Response> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-mcp-test-route-'));
  roots.push(root);
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, ai: { mcpServers: [{ name: 'github', transport: 'stdio' }] } }));
  const host = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(host);
  registerConsoleRestPages(host, { fullScope: true, projectRoot: root, acquireAgentRuntime: createAgentRuntimeLeaseResolver(root, readerOf(agentHost)) });
  const { port } = await host.listen();
  return fetch(`http://127.0.0.1:${port}/api/introspection/mcp/test`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'github' }),
  });
}

describe('MCP connection test through the instance resolver (#1250 batch 28 review B1)', () => {
  it('answers 503, not 500, when the generation has no Agent', async () => {
    const response = await post(undefined);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, error: 'Agent 未运行，无法测试 MCP 连接' });
  });

  it('answers 503 for an Agent without the test', async () => {
    expect((await post({ introspection: { listMcpServers: () => [], listTools: () => [] } })).status).toBe(503);
  });

  it('runs the Agent\'s test when it has one', async () => {
    const testMcpServer = vi.fn(async (name: string) => ({ ok: true, name, toolCount: 1, durationMs: 2 }));
    const response = await post({ introspection: { listMcpServers: () => [], listTools: () => [], testMcpServer } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { ok: true, name: 'github', toolCount: 1, durationMs: 2 } });
  });
});
