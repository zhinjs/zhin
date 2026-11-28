/**
 * #1250 sandbox-second-account-duplicates-replies: two Sandbox accounts on one HTTP Host. Each account
 * gets its own admission-bound HttpHost view (`CapabilityContext.use` binds a fresh one per call), so
 * the path claim must not be keyed by that object — otherwise both mount `/sandbox` and every message
 * is handled (and replied to, `/restart` included) once per account.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import type { HttpHost } from '@zhin.js/host-http';
import type { EndpointEvent } from 'zhin.js/adapter';
import {
  SnapshotStore,
  bindGenerationAdmission,
  createGenerationAdmissionGate,
  generationAdmissionSource,
  type GenerationAdmissionGate,
  type SnapshotState,
} from '../../../../packages/im/plugin-runtime/src/index.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint, claimSandboxWsPaths, listSandboxWsEndpoints } from '../src/endpoint.js';
import { resolveSandboxEndpoint } from '../src/protocol.js';
import { sandboxOperations } from './sandbox-operations.js';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

type Frame = Record<string, unknown>;
const hosts: ReturnType<typeof createHttpHost>[] = [];
const clients: WebSocket[] = [];
const stores: SnapshotStore[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined);
  await Promise.all(stores.splice(0).map(store => store.close()));
  await Promise.all(hosts.splice(0).map(host => host.close()));
});

function admissionState(gate: GenerationAdmissionGate): SnapshotState {
  return {
    root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(),
    projections: new Map([[featureId('test.sandbox-admission'), { [generationAdmissionSource]: [gate] }]]),
  };
}

async function account(view: HttpHost, id: string) {
  const receive = vi.fn(async (_input: unknown) => Object.freeze({ matched: true }));
  const events = vi.fn(async (event: EndpointEvent) => event.name === 'message.receive' ? receive(event.payload) : undefined);
  const harness = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), id),
    http: view, defaults: resolveSandboxEndpoint({ id, owner: 'sandbox-user' }),
  }), { name: id, capabilities: ['inbound', 'outbound'], operations: sandboxOperations, gateway: createTestEndpointEventGateway({ receive: events }) });
  await harness.start();
  harness.open();
  cleanups.push(() => harness.stop());
  return { harness, endpoint: harness.endpoint as SandboxWsEndpoint, receive };
}

async function connect(port: number, path: string) {
  const client = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.push(client);
  const frames: Frame[] = [];
  client.on('message', data => frames.push(JSON.parse(String(data)) as Frame));
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
  return { client, frames, ready: frames.find(frame => frame.type === 'ready')! };
}

describe('Sandbox accounts sharing one HTTP Host', () => {
  it('gives each account its own path although every account sees a different HttpHost object', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gate = createGenerationAdmissionGate();
    stores.push(new SnapshotStore(admissionState(gate)));
    // What two `context.use(httpHostToken)` calls return: two distinct admission-bound views.
    const firstView = bindGenerationAdmission<HttpHost>(http, gate);
    const secondView = bindGenerationAdmission<HttpHost>(http, gate);
    expect(firstView).not.toBe(secondView);

    const first = await account(firstView, 'sandbox-bot');
    const second = await account(secondView, 'sandbox-bot2');
    expect(first.endpoint.paths).toEqual(['/sandbox', '/sandbox/sandbox-bot']);
    expect(second.endpoint.paths).toEqual(['/sandbox/sandbox-bot2']);
    expect(second.endpoint.path).toBe('/sandbox/sandbox-bot2');

    const { port } = await http.listen();
    const page = await connect(port, '/sandbox');
    expect(page.ready).toMatchObject({
      endpoint: 'sandbox-bot',
      endpoints: [
        { id: 'sandbox-bot', path: '/sandbox/sandbox-bot', default: true },
        { id: 'sandbox-bot2', path: '/sandbox/sandbox-bot2', default: false },
      ],
    });
    // A side-effecting command reaches exactly one account, exactly once.
    page.client.send(JSON.stringify({ type: 'private', id: 'sandbox-user', content: '/restart', messageId: 'm-restart' }));
    await vi.waitFor(() => expect(first.receive).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(first.receive).toHaveBeenCalledTimes(1);
    expect(second.receive).not.toHaveBeenCalled();

    const secondPage = await connect(port, '/sandbox/sandbox-bot2');
    expect(secondPage.ready).toMatchObject({ endpoint: 'sandbox-bot2' });
    secondPage.client.send(JSON.stringify({ type: 'private', id: 'sandbox-user', content: 'hello', messageId: 'm-second' }));
    await vi.waitFor(() => expect(second.receive).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(first.receive).toHaveBeenCalledTimes(1);
    expect(second.receive.mock.calls[0]![0]).toMatchObject({ endpointId: 'sandbox-bot2' });
    // Neither page sees the other account's echo.
    expect(page.frames.some(frame => frame.messageId === 'm-second')).toBe(false);

    // The first account's own path reaches the first account too.
    const own = await connect(port, '/sandbox/sandbox-bot');
    expect(own.ready).toMatchObject({ endpoint: 'sandbox-bot' });
  });

  it('releases every claimed path on stop and lets the same account take them over again', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gate = createGenerationAdmissionGate();
    const one = claimSandboxWsPaths(bindGenerationAdmission<HttpHost>(http, gate), 'a');
    const two = claimSandboxWsPaths(bindGenerationAdmission<HttpHost>(http, gate), 'b');
    expect(one.paths).toEqual(['/sandbox', '/sandbox/a']);
    expect(two.paths).toEqual(['/sandbox/b']);
    // A generation hand-over of account `a` shares its paths instead of moving it.
    const handover = claimSandboxWsPaths(bindGenerationAdmission<HttpHost>(http, gate), 'a');
    expect(handover.paths).toEqual(['/sandbox', '/sandbox/a']);
    one.release();
    expect(listSandboxWsEndpoints(http).map(entry => entry.id)).toEqual(['a', 'b']);
    handover.release();
    expect(listSandboxWsEndpoints(http)).toEqual([{ id: 'b', path: '/sandbox/b', default: false }]);
    const later = claimSandboxWsPaths(http, 'c');
    expect(later.paths).toEqual(['/sandbox', '/sandbox/c']);
    two.release(); later.release();
    expect(listSandboxWsEndpoints(http)).toEqual([]);
  });

  it('keeps hosts apart: another Host starts with its own `/sandbox`', () => {
    const left = createHttpHost({ host: '127.0.0.1', port: 0 });
    const right = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(left, right);
    const a = claimSandboxWsPaths(left, 'a');
    const b = claimSandboxWsPaths(right, 'b');
    expect(a.paths[0]).toBe('/sandbox');
    expect(b.paths[0]).toBe('/sandbox');
    a.release(); b.release();
  });
});
