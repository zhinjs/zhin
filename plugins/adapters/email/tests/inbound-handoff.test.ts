import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { EmailEndpoint } from '../src/endpoint.js';
import { resolveEmailConfig } from '../src/protocol.js';
import type { EmailImapTransport } from '../src/transport.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';

const config = resolveEmailConfig({ id: 'fixture', smtp: { host: 'smtp.fixture', port: 465, secure: true, auth: { user: 'bot@example.com', pass: 'fixture' } },
  imap: { host: 'imap.fixture', port: 993, tls: true, user: 'bot@example.com', password: 'fixture', markSeen: false, checkInterval: 60000 } });
const mail = (uid: number, body: string) => `From: actor@example.com\r\nTo: bot@example.com\r\nMessage-ID: <m${uid}@example.com>\r\nSubject: probe\r\n\r\n${body}`;

/** Each poll returns the UNSEEN mails so far, as an IMAP server would while none is marked seen. */
function imapFixture(inbox: Array<{ uid: number; raw: string }>) {
  const emitter = new EventEmitter();
  const transport = Object.assign(emitter, {
    connect: vi.fn(() => queueMicrotask(() => emitter.emit('ready'))), end: vi.fn(),
    openBox: vi.fn((_box, _rw, callback) => callback(null, { uidvalidity: 1 })),
    search: vi.fn((_criteria, callback) => callback(null, inbox.map(entry => entry.uid))),
    fetch: vi.fn(() => {
      const fetch = new EventEmitter();
      queueMicrotask(() => {
        let open = inbox.length;
        for (const entry of inbox) {
          const message = new EventEmitter(); fetch.emit('message', message, entry.uid);
          const stream = Readable.from([entry.raw]); message.emit('body', stream); message.emit('attributes', { uid: entry.uid });
          stream.once('end', () => { message.emit('end'); if (--open === 0) fetch.emit('end'); });
        }
      });
      return fetch;
    }),
  });
  return { transport: transport as unknown as EmailImapTransport, emitter, fetch: transport.fetch };
}

// #1250 adapter-inbound-deadlock: the first mail's dispatch (an Agent turn) waits for the user's reply mail,
// which only a later IMAP check can fetch.
it('checks for the reply mail while the previous mail\'s dispatch still waits for it', async () => {
  const inbox = [{ uid: 1, raw: mail(1, 'run it') }];
  const imap = imapFixture(inbox);
  let answered!: () => void;
  const answer = new Promise<void>(resolve => { answered = resolve; });
  const receive = vi.fn(async (payload: { content?: string }) => {
    if (payload.content?.includes('yes')) { answered(); return; }
    await answer; // the turn waits for the reply
  });
  const endpoint = await createEndpointHarness(() => new EmailEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'email'), config,
    createImap: () => imap.transport, createSmtp: () => ({ verify: vi.fn(async () => {}), sendMail: vi.fn(async () => ({ messageId: 'fixture' })), close: vi.fn() }) }),
  { capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({ receive: async (event) => {
    if (event.name !== 'message.receive') return undefined;
    event.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
    return receive(event.payload as { content?: string });
  } }) });
  try {
    await endpoint.start(); endpoint.open();
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    inbox.push({ uid: 2, raw: mail(2, 'yes') });
    await vi.waitFor(() => {
      imap.emitter.emit('mail');
      expect(receive).toHaveBeenCalledTimes(2);
    }, { timeout: 2_000 });
    await answer;
    // The first mail was taken once: its hand-over marked its UID admitted.
    expect(receive.mock.calls.map(call => call[0].content?.split('\n').at(-1))).toEqual(['run it', 'yes']);
  } finally { answered(); await endpoint.stop(); }
});
