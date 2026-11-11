import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamResponse } from '@a2a-js/sdk';
import type { A2ARequestHandler } from '@a2a-js/sdk/server';
import { buildAgentCardForBinding } from '../src/card-builder.js';
import { handleJsonRpc, handleRest } from '../src/http-handlers.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

const card = buildAgentCardForBinding(
  { name: 'zhin', providerAlias: 'ollama', model: 'qwen3:8b', mcpServers: [] } as never,
  'http://localhost',
);

function event(text: string) {
  return StreamResponse.fromJSON({
    message: { messageId: text, role: 'ROLE_AGENT', parts: [{ text }] },
  });
}

function fakeHandler(sendMessageStream: () => AsyncGenerator<unknown, void, undefined>): A2ARequestHandler {
  return {
    getAgentCard: async () => card,
    sendMessageStream,
  } as unknown as A2ARequestHandler;
}

interface Served {
  readonly port: number;
  /** Settles when the handler promise settles; rejects if the handler threw. */
  readonly handled: Promise<void>;
}

async function serve(kind: 'rest' | 'jsonrpc', handler: A2ARequestHandler): Promise<Served> {
  let settle!: (value: void | PromiseLike<void>) => void;
  const handled = new Promise<void>((resolve) => { settle = resolve; });
  const server = createServer((req, res) => {
    settle(kind === 'rest'
      ? handleRest(req, res, handler, 'message:stream')
      : handleJsonRpc(req, res, handler));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, handled };
}

const message = { messageId: 'in', role: 'ROLE_USER', parts: [{ text: 'hi' }] };
const headers = { 'content-type': 'application/json', 'a2a-version': '1.0' };

describe('A2A SSE streaming', () => {
  it('REST: ends the response with an SSE error event when the stream fails after the first chunk', async () => {
    const { port, handled } = await serve('rest', fakeHandler(async function* () {
      yield event('one');
      throw new Error('executor exploded');
    }));

    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST', headers, body: JSON.stringify({ message }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(text).toContain('"text":"one"');
    expect(text).toContain('event: error\ndata: {"error":"executor exploded"}\n\n');
    await expect(handled).resolves.toBeUndefined();
  });

  it('REST: a failure before the first chunk is still a plain JSON error', async () => {
    const failing = {
      [Symbol.asyncIterator]() { return this; },
      next: async () => { throw new Error('never started'); },
    } as unknown as AsyncGenerator<unknown, void, undefined>;
    const { port, handled } = await serve('rest', fakeHandler(() => failing));

    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST', headers, body: JSON.stringify({ message }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'never started' });
    await expect(handled).resolves.toBeUndefined();
  });

  it('JSON-RPC: reports a mid-stream failure as an SSE error event carrying the request id', async () => {
    const { port, handled } = await serve('jsonrpc', fakeHandler(async function* () {
      yield event('one');
      throw new Error('executor exploded');
    }));

    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'SendStreamingMessage', params: { message } }),
    });
    const text = await response.text();
    const errorLine = text.split('\n\n').find((block) => block.startsWith('event: error'));

    expect(text).toContain('"text":"one"');
    expect(errorLine).toBeDefined();
    expect(JSON.parse(errorLine!.split('\ndata: ')[1]!)).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      error: { message: expect.stringContaining('executor exploded') },
    });
    await expect(handled).resolves.toBeUndefined();
  });

  it('stops pulling from the source and runs its cleanup when the client disconnects', async () => {
    let produced = 0;
    let cleanedUp = false;
    const { port, handled } = await serve('rest', fakeHandler(async function* () {
      try {
        for (;;) {
          produced += 1;
          yield event(`chunk-${produced}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      } finally {
        cleanedUp = true;
      }
    }));

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', headers }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
      });
      req.end(JSON.stringify({ message }));
    });

    await expect(handled).resolves.toBeUndefined();
    expect(cleanedUp).toBe(true);
    const producedAtClose = produced;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(produced).toBe(producedAtClose);
  });
});
