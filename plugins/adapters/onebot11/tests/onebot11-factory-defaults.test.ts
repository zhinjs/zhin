import WebSocket, { WebSocketServer } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/onebot11/index.js';
import { Onebot11Client } from '../src/client.js';

describe('OneBot11 convention Adapter self-identity defaults', () => {
  it.each(['ws', 'wss'] as const)('probes the real %s SDK connection without a legacy factory or mutable directory', async mode => {
    const actions: string[] = [];
    const respond = (socket: WebSocket) => socket.on('message', raw => {
      const request = JSON.parse(String(raw)) as { action: string; echo: string };
      actions.push(request.action);
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: request.echo, data: { user_id: 777, nickname: 'fixture' } }));
    });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const server = mode === 'ws' ? new WebSocketServer({ host: '127.0.0.1', port: 0 }) : undefined;
    if (server) { server.on('connection', respond); await new Promise<void>(resolve => server.once('listening', resolve)); }
    const address = server?.address();
    const config = mode === 'ws'
      ? { connection: mode, id: 'forward', url: `ws://127.0.0.1:${address && typeof address !== 'string' ? address.port : 0}` }
      : { connection: mode, id: 'reverse', path: '/onebot/defaults' };
    const h = await createAdapterHarness(definition, config, { name: 'onebot11', resources: new Map([[httpHostToken.id, http]]) });
    let vendor: WebSocket | undefined;
    try {
      await h.start(); h.open();
      if (mode === 'wss') {
        const { port } = await http.listen(); vendor = new WebSocket(`ws://127.0.0.1:${port}/onebot/defaults`); respond(vendor);
        await new Promise<void>((resolve, reject) => { vendor!.once('open', resolve); vendor!.once('error', reject); });
      }
      expect(h.endpoint).toBeInstanceOf(Onebot11Client);
      await vi.waitFor(() => expect(h.index.connection('onebot11', h.canonicalId)?.selfUserId).toBe('777'));
      expect(actions).toEqual(['get_login_info']);
    } finally {
      vendor?.terminate(); await h.stop(); await http.close();
      if (server) { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  });
});
