import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint } from '../src/endpoint.js';
import { resolveSandboxEndpoint } from '../src/protocol.js';

const kill = vi.fn();
// A Docker CLI that never reports back (ignored SIGTERM, or a child holding stdio open).
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: () => ({ kill }),
}));

const hosts: ReturnType<typeof createHttpHost>[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(hosts.splice(0).map(host => host.close()));
});

it('still sends ready with a timed-out shell isolation status when the Docker probe hangs', async () => {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(http);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'),
    http, defaults: resolveSandboxEndpoint({ id: 'hung-probe-bot', owner: 'hung-owner' }),
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({ receive: async () => undefined }) });
  await endpoint.start();
  endpoint.open();
  const { port } = await http.listen();
  const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
  clients.push(client);
  const frames: Record<string, unknown>[] = [];
  client.on('message', data => frames.push(JSON.parse(String(data)) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true), { timeout: 3000 });
  expect(frames.find(frame => frame.type === 'ready')).toMatchObject({
    shellIsolation: { available: false, provider: 'docker', message: 'Docker readiness check timed out' },
  });
  expect(kill).toHaveBeenCalledWith('SIGKILL');
  await endpoint.stop();
});
