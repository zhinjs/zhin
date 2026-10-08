import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { EmailEndpoint } from '../src/endpoint.js';
import { resolveEmailConfig } from '../src/protocol.js';
import { type EmailImapTransport, type EmailSmtpTransport } from '../src/transport.js';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';

const config = resolveEmailConfig({ id: 'fixture', smtp: { host: 'smtp.fixture', port: 465, secure: true, auth: { user: 'bot@example.com', pass: 'fixture' } }, imap: { host: 'imap.fixture', port: 993, tls: true, user: 'bot@example.com', password: 'fixture', markSeen: false, checkInterval: 60000 } });
const raw = 'From: actor@example.com\r\nTo: bot@example.com\r\nMessage-ID: <fixture@example.com>\r\nSubject: probe\r\n\r\nhello';
function imapFixture() {
  const emitter = new EventEmitter();
  const state = { validity: 1, defer: false, release: () => {} };
  const transport = Object.assign(emitter, {
    connect: vi.fn(() => queueMicrotask(() => emitter.emit('ready'))), end: vi.fn(),
    openBox: vi.fn((_box, _rw, callback) => callback(null, { uidvalidity: state.validity })),
    search: vi.fn((_criteria, callback) => callback(null, [1])),
    fetch: vi.fn(() => {
      const fetch = new EventEmitter();
      const deliver = () => {
        const message = new EventEmitter(); fetch.emit('message', message, 1);
        const stream = Readable.from([raw]); message.emit('body', stream); message.emit('attributes', { uid: 1 });
        stream.once('end', () => { message.emit('end'); fetch.emit('end'); });
      };
      state.release = deliver;
      if (!state.defer) queueMicrotask(deliver);
      return fetch;
    }),
  });
  return { transport: transport as unknown as EmailImapTransport, emitter, state, fetch: transport.fetch, connect: transport.connect, end: transport.end };
}
function endpointFixture(imap: EmailImapTransport, receive = vi.fn(async () => {}), smtp: EmailSmtpTransport = { verify: vi.fn(async () => {}), sendMail: vi.fn(async () => ({ messageId: 'fixture' })), close: vi.fn() }) {
  return bindTestEndpoint(new EmailEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'email'), config, createImap: () => imap, createSmtp: () => smtp }), { receive });
}
it('holds polling lock through dispatch and deduplicates completed UID while allowing changed UIDVALIDITY', async () => {
  const imap = imapFixture(); let release!: () => void;
  const receive = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { release = done; })).mockResolvedValue(undefined);
  const endpoint = endpointFixture(imap.transport, receive);
  try {
    await endpoint.start(); endpoint.open();
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    imap.emitter.emit('mail'); expect(imap.fetch).toHaveBeenCalledTimes(1);
    release(); await new Promise(done => setTimeout(done, 20));
    imap.emitter.emit('mail'); await vi.waitFor(() => expect(imap.fetch).toHaveBeenCalledTimes(2));
    await new Promise(done => setTimeout(done, 20)); expect(receive).toHaveBeenCalledTimes(1);
    imap.state.validity = 2; imap.emitter.emit('mail');
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
  } finally { await endpoint.stop(); }
});
it('failed dispatch does not permanently consume UID admission', async () => {
  const imap = imapFixture(); const receive = vi.fn().mockRejectedValueOnce(new Error('fixture rejection')).mockResolvedValue(undefined);
  const endpoint = endpointFixture(imap.transport, receive);
  try {
    await endpoint.start(); endpoint.open(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    await new Promise(done => setTimeout(done, 20)); imap.emitter.emit('mail');
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
  } finally { await endpoint.stop(); }
});
it('stop settles startup waiting for IMAP ready and ignores late ready', async () => {
  const imap = imapFixture(); imap.connect.mockImplementation(() => {});
  const endpoint = endpointFixture(imap.transport);
  const starting = endpoint.start();
  await vi.waitFor(() => expect(imap.connect).toHaveBeenCalledTimes(1));
  await endpoint.stop(); await starting;
  imap.emitter.emit('ready'); expect(endpoint.transportState).toBe('stopped'); expect(imap.end).toHaveBeenCalledTimes(1);
});
it('retired fetch cannot dispatch into restarted endpoint', async () => {
  const old = imapFixture(); old.state.defer = true;
  const next = imapFixture(); next.state.defer = true;
  const receive = vi.fn(async () => {}); let generation = 0;
  const endpoint = bindTestEndpoint(new EmailEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'email'), config, createImap: () => generation++ === 0 ? old.transport : next.transport, createSmtp: () => ({ verify: async () => {}, sendMail: async () => ({}), close: () => {} }) }), { receive });
  try {
    await endpoint.start(); endpoint.open(); await vi.waitFor(() => expect(old.fetch).toHaveBeenCalledTimes(1));
    await endpoint.stop(); await endpoint.start(); endpoint.open();
    old.state.release(); await new Promise(done => setTimeout(done, 20)); expect(receive).not.toHaveBeenCalled();
    next.state.release(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  } finally { await endpoint.stop(); }
});
it('never retries an uncertain SMTP send', async () => {
  const imap = imapFixture(); const sendMail = vi.fn(async () => { throw new Error('connection lost after DATA'); });
  const endpoint = endpointFixture(imap.transport, undefined, { verify: async () => {}, close: () => {}, sendMail });
  try {
    await endpoint.start();
    await expect(endpoint.send({ conversation: { endpoint: { id: 'fixture', adapter: 'email' }, kind: 'private', id: 'actor@example.com' }, payload: 'probe' })).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  } finally { await endpoint.stop(); }
});
it('expires instance UID dedup after 24h and permits the same still-unread mail again', async () => {
  const imap = imapFixture(); const receive = vi.fn(async () => {});
  const endpoint = endpointFixture(imap.transport, receive); let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await endpoint.start(); endpoint.open(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    await new Promise(done => setTimeout(done, 20));
    const future = Date.now() + 24 * 60 * 60 * 1000 + 1;
    clock = vi.spyOn(Date, 'now').mockReturnValue(future);
    imap.emitter.emit('mail'); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
  } finally { clock?.mockRestore(); await endpoint.stop(); }
});
it('isolates a retired fetch even when a factory reuses the same transport object', async () => {
  const imap = imapFixture(); imap.state.defer = true;
  const receive = vi.fn(async () => {}); const endpoint = endpointFixture(imap.transport, receive);
  try {
    await endpoint.start(); endpoint.open(); await vi.waitFor(() => expect(imap.fetch).toHaveBeenCalledTimes(1));
    const oldDelivery = imap.state.release;
    await endpoint.stop(); await endpoint.start(); endpoint.open(); await vi.waitFor(() => expect(imap.fetch).toHaveBeenCalledTimes(2));
    oldDelivery(); await new Promise(done => setTimeout(done, 20)); expect(receive).not.toHaveBeenCalled();
    imap.state.release(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  } finally { await endpoint.stop(); }
});
