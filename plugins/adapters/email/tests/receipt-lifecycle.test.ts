import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { capabilityId, rootPluginId, featureId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { EmailEndpoint } from '../src/endpoint.js';
import { resolveEmailConfig } from '../src/protocol.js';
import type { EmailImapTransport } from '../src/transport.js';

const parser = vi.hoisted(() => ({ entered: false, settled: false, release: () => undefined as void }));
vi.mock('mailparser', async importOriginal => {
  const actual = await importOriginal<typeof import('mailparser')>();
  return { ...actual, simpleParser: async (source: string) => {
    parser.entered = true; await new Promise<void>(resolve => { parser.release = resolve; });
    const parsed = await actual.simpleParser(source); parser.settled = true; return parsed;
  } };
});
it.each(['close', 'stop'] as const)('owns the accepted IMAP parser through %s without leaking a late result', async action => {
  parser.entered = false; parser.settled = false;
  const events = new EventEmitter();
  const imap: EmailImapTransport = {
    on: (name, receive) => { events.on(name, receive); }, once: (name, receive) => { events.once(name, receive); },
    connect: () => { queueMicrotask(() => events.emit('ready')); }, end: () => { events.emit('end'); },
    openBox: (_name, _rw, complete) => complete(null, { uidvalidity: 1 }), search: (_query, complete) => complete(null, [1]),
    fetch: () => {
      const fetch = new EventEmitter();
      queueMicrotask(() => {
        const message = new EventEmitter(); fetch.emit('message', message, 1);
        const body = Readable.from(['From: user@example.test\r\nTo: bot@example.test\r\nMessage-ID: <synthetic>\r\n\r\nhello']);
        message.emit('body', body); message.emit('attributes', { uid: 1 });
        body.once('end', () => { message.emit('end'); fetch.emit('end'); });
      });
      return fetch;
    },
  };
  const config = resolveEmailConfig({ id: 'synthetic', smtp: { host: 'smtp.synthetic', port: 465, secure: true, auth: { user: 'bot', pass: 'synthetic' } },
    imap: { host: 'imap.synthetic', port: 993, tls: true, user: 'bot', password: 'synthetic' } });
  const receive = vi.fn(async (_event: unknown) => undefined), native = vi.fn();
  const h = await createEndpointHarness(() => new EmailEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'email'), config,
    createImap: () => imap, createSmtp: () => ({ verify: async () => undefined, close() {}, sendMail: async () => ({}) }),
  }), { gateway: createTestEventGateway({ receive }), capabilities: ['inbound', 'outbound'] });
  h.endpoint.on('mail', native);
  let closing: Promise<void> | undefined;
  try {
    await h.start(); h.open(); await vi.waitFor(() => expect(parser.entered).toBe(true));
    let closed = false; closing = (action === 'close' ? h.close() : h.stop()).then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(action === 'stop');
    parser.release(); await closing;
    await vi.waitFor(() => expect(parser.settled).toBe(true));
    if (action === 'close') {
      expect(receive).toHaveBeenCalledOnce(); expect(native).toHaveBeenCalledOnce();
      expect(receive.mock.calls[0]![0]).toMatchObject({ event: native.mock.calls[0]![0] });
    } else { expect(receive).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled(); }
  } finally { parser.release(); await closing; await h.stop(); }
});
