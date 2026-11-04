import { expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpHost, HttpHandler } from '@zhin.js/host-http';
import { SnapshotStore, rootPluginId, type SnapshotLease } from '@zhin.js/plugin-runtime';
import { registerPersonalModelHttp } from '../../../src/plugin-runtime/personal-models/register-http.js';

it('releases the HTTP generation lease when private resource resolution throws', async () => {
  const store = new SnapshotStore({ root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() });
  let captured: SnapshotLease | undefined;
  const handlers = new Map<string, HttpHandler>();
  const http = { route: (method: string, path: string, handler: HttpHandler) => { handlers.set(`${method} ${path}`, handler); return () => {}; } } as unknown as HttpHost;
  registerPersonalModelHttp({ http, base: '/api', snapshots: {
    acquire: () => captured = store.acquire(), owns: lease => store.owns(lease),
    rootResource: () => { throw new Error('synthetic lookup failure'); },
  } });
  let status = 0;
  const response = { setHeader: () => undefined, writeHead: (value: number) => { status = value; }, end: () => undefined } as unknown as ServerResponse;
  await handlers.get('GET /api/agent/personal-models')!({} as IncomingMessage, response, new URL('https://host.example/api/agent/personal-models'), 'demo', { principalId: 'person', scope: 'demo' });
  expect(status).toBe(503);
  expect(captured?.active).toBe(false);
  await store.close();
});
