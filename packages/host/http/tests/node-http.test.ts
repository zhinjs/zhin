import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { createResponseStream, jsonResponse, readJsonBody, SSE_HEADERS } from '@zhin.js/host-http-contract';
import { createHttpHost, type ProcessHttpHost } from '../src/node/server.js';
import type { WsConnection } from '../src/http-host.js';

const hosts: ProcessHttpHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

async function start(setup: (host: ProcessHttpHost) => void): Promise<number> {
  const host = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(host);
  setup(host);
  return (await host.listen()).port;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('Node ↔ Web request adapter', () => {
  it('streams the request body to the handler before the client finished sending', async () => {
    const firstChunk = deferred<string>();
    const port = await start((host) => host.route('POST', '/upload', async (request) => {
      const reader = request.body!.getReader();
      const decoder = new TextDecoder();
      const first = await reader.read();
      firstChunk.resolve(decoder.decode(first.value));
      let rest = '';
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        rest += decoder.decode(next.value);
      }
      return new Response(`${decoder.decode(first.value)}${rest}`);
    }));
    const client = httpRequest({ host: '127.0.0.1', port, path: '/upload', method: 'POST', headers: { 'transfer-encoding': 'chunked' } });
    const responded = new Promise<string>((resolve, reject) => {
      client.once('response', (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve(body));
      });
      client.once('error', reject);
    });
    client.write('hello ');
    expect(await firstChunk.promise).toBe('hello ');
    client.end('world');
    expect(await responded).toBe('hello world');
  });

  it('passes headers, method, query and the peer address', async () => {
    const port = await start((host) => host.route('PUT', '/echo', (request, { url, remoteAddress }) => jsonResponse(200, {
      method: request.method,
      custom: request.headers.get('x-custom'),
      q: url.searchParams.get('q'),
      remoteAddress,
    })));
    const response = await fetch(`http://127.0.0.1:${port}/echo?q=1`, { method: 'PUT', headers: { 'x-custom': 'v' } });
    expect(await response.json()).toEqual({ method: 'PUT', custom: 'v', q: '1', remoteAddress: '127.0.0.1' });
  });

  it('aborts request.signal when the client disconnects', async () => {
    const aborted = deferred<boolean>();
    const entered = deferred();
    const port = await start((host) => host.route('GET', '/hang', (request) => {
      request.signal.addEventListener('abort', () => aborted.resolve(true), { once: true });
      entered.resolve();
      return new Promise<Response>(() => undefined);
    }));
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/hang`, { signal: controller.signal }).catch(() => undefined);
    await entered.promise;
    controller.abort();
    await pending;
    expect(await aborted.promise).toBe(true);
  });

  it('answers 413 from the body limit and keeps the connection usable', async () => {
    const port = await start((host) => host.route('POST', '/json', async (request) => jsonResponse(200, {
      body: await readJsonBody(request, { limit: 64 }),
    })));
    const agent = new (await import('node:http')).Agent({ keepAlive: true, maxSockets: 1 });
    const post = (body: string) => new Promise<{ status: number; body: string; socket: unknown }>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: '/json', method: 'POST', agent, headers: { 'content-type': 'application/json' } }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode!, body: text, socket: request.socket }));
      });
      request.once('error', reject);
      request.end(body);
    });
    const tooLarge = await post(JSON.stringify({ data: 'x'.repeat(10_000) }));
    expect(tooLarge.status).toBe(413);
    expect(JSON.parse(tooLarge.body)).toEqual({ success: false, error: 'Request body exceeds 64 bytes' });
    const ok = await post('{"a":1}');
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ body: { a: 1 } });
    expect(ok.socket).toBe(tooLarge.socket);
    agent.destroy();
  });
});

describe('Node ↔ Web response adapter', () => {
  it('sends Content-Length for complete bodies and repeated set-cookie headers', async () => {
    const port = await start((host) => host.route('GET', '/fixed', () => {
      const headers = new Headers({ 'content-type': 'text/plain' });
      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');
      return new Response('fixed body', { status: 201, headers });
    }));
    const response = await rawGet(port, '/fixed');
    expect(response.statusCode).toBe(201);
    expect(response.headers['content-length']).toBe('10');
    expect(response.headers['set-cookie']).toEqual(['a=1', 'b=2']);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('flushes SSE headers before the first event and frames events as written', async () => {
    let stream!: ReturnType<typeof createResponseStream>;
    const port = await start((host) => host.route('GET', '/events', () => {
      stream = createResponseStream();
      return new Response(stream.stream, { headers: SSE_HEADERS });
    }));
    const response = await rawGet(port, '/events');
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(response.headers['content-length']).toBeUndefined();
    const received: string[] = [];
    const got = deferred();
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      received.push(chunk);
      if (received.join('').includes('two')) got.resolve();
    });
    stream.write('data: one\n\n');
    stream.write('data: two\n\n');
    await got.promise;
    expect(received.join('')).toBe('data: one\n\ndata: two\n\n');
    const closed = deferred();
    stream.onClose(() => closed.resolve());
    response.destroy();
    await closed.promise;
    expect(stream.signal.aborted).toBe(true);
  });

  it('applies backpressure from a slow client to the producer', async () => {
    let stream!: ReturnType<typeof createResponseStream>;
    const port = await start((host) => host.route('GET', '/big', () => {
      stream = createResponseStream({ highWaterMark: 64 * 1024 });
      return new Response(stream.stream);
    }));
    const response = await rawGet(port, '/big');
    response.pause();
    const chunk = new Uint8Array(64 * 1024);
    let accepted = 0;
    // The paused client stops reading: the producer must eventually be told to wait.
    for (let i = 0; i < 400; i += 1) {
      accepted += 1;
      if (!stream.write(chunk)) break;
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    expect(accepted).toBeLessThan(400);
    const drained = deferred();
    stream.onDrain(() => drained.resolve());
    let received = 0;
    response.on('data', (data: Buffer) => { received += data.length; });
    response.resume();
    await drained.promise;
    stream.close();
    await new Promise((resolve) => { response.once('end', resolve); });
    expect(received).toBe(accepted * chunk.byteLength);
  });

  it('drops the connection when the body stream errors', async () => {
    const port = await start((host) => host.route('GET', '/broken', () => {
      const stream = createResponseStream();
      stream.write('partial');
      setTimeout(() => stream.error(new Error('boom')), 20);
      return new Response(stream.stream);
    }));
    await expect(fetch(`http://127.0.0.1:${port}/broken`).then((response) => response.text())).rejects.toThrow();
  });
});

describe('Node ws ↔ WsConnection adapter', () => {
  it('delivers text and binary frames, reports bufferedAmount and close code / reason', async () => {
    const connected = deferred<WsConnection>();
    const messages: Array<string | Uint8Array> = [];
    const closed = deferred<[number, string]>();
    const port = await start((host) => host.ws('/socket').onConnection((connection) => {
      connection.onMessage((data) => {
        messages.push(data);
        if (typeof data === 'string') connection.send(`echo:${data}`);
        else connection.send(data);
      });
      connection.onClose((code, reason) => closed.resolve([code, reason]));
      connected.resolve(connection);
    }));
    const client = new WebSocket(`ws://127.0.0.1:${port}/socket?x=1`, { headers: { 'x-client': 'test' } });
    const replies: Array<string | Buffer> = [];
    client.on('message', (data, isBinary) => { replies.push(isBinary ? (data as Buffer) : data.toString()); });
    await new Promise((resolve) => { client.once('open', resolve); });
    const connection = await connected.promise;
    expect(connection.url.searchParams.get('x')).toBe('1');
    expect(connection.headers.get('x-client')).toBe('test');
    expect(connection.remoteAddress).toBe('127.0.0.1');
    expect(connection.bufferedAmount).toBe(0);
    client.send('hi');
    client.send(new Uint8Array([1, 2, 3]));
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(messages[0]).toBe('hi');
    expect(messages[1]).toBeInstanceOf(Uint8Array);
    expect([...(messages[1] as Uint8Array)]).toEqual([1, 2, 3]);
    expect(replies[0]).toBe('echo:hi');
    expect([...(replies[1] as Buffer)]).toEqual([1, 2, 3]);
    client.close(4001, 'bye');
    expect(await closed.promise).toEqual([4001, 'bye']);
    // Sending after close is a no-op; late onClose listeners still learn the outcome.
    connection.send('ignored');
    const late = deferred<number>();
    connection.onClose((code) => late.resolve(code));
    expect(await late.promise).toBe(4001);
  });

  it('closes from the server side with a code', async () => {
    const port = await start((host) => host.ws('/kick', { auth: 'protocol' }).onConnection((connection) => {
      connection.close(4003, 'Unauthorized');
    }));
    const client = new WebSocket(`ws://127.0.0.1:${port}/kick`);
    const [code, reason] = await new Promise<[number, string]>((resolve) => {
      client.once('close', (value, why) => resolve([value, why.toString()]));
    });
    expect(code).toBe(4003);
    expect(reason).toBe('Unauthorized');
  });
});

function rawGet(port: number, path: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, resolve);
    request.once('error', reject);
    request.end();
  });
}
