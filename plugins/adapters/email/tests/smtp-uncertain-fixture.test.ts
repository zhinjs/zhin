import net from 'node:net';
import { once, EventEmitter } from 'node:events';
import { EmailEndpoint } from '../src/endpoint.js';
import { resolveEmailConfig } from '../src/protocol.js';
import type { EmailImapTransport } from '../src/transport.js';
import { emailDeliveryRuntime } from './runtime-delivery.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

it.each(['cut', 'accepted', 'rejected', 'partial'])('actual nodemailer and final Core receipt preserve SMTP evidence: %s', async mode => {
  let dataCount = 0; let cut = () => {};
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.write('220 fixture ESMTP\r\n'); let buffer = ''; let dataMode = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const boundary = buffer.indexOf('\r\n'); const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (dataMode) { if (line === '.') { dataCount++; if (mode === 'cut') { cut(); return; } dataMode = false; socket.write('250 queued fixture\r\n'); continue; } continue; }
        if (line.startsWith('EHLO')) socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) socket.write('235 authenticated\r\n');
        else if (line.startsWith('RCPT') && (mode === 'rejected' || (mode === 'partial' && line.includes('other@example.com')))) socket.write('550 recipient rejected\r\n');
        else if (line === 'DATA') { dataMode = true; socket.write('354 send mail\r\n'); }
        else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as net.AddressInfo).port, port: 0, controlPort: 0 }); cut = () => { proxy.cut(); };
  const imap = Object.assign(new EventEmitter(), { connect() { queueMicrotask(() => this.emit('ready')); }, end() {}, openBox() {}, search() {}, fetch() {} }) as unknown as EmailImapTransport;
  const config = resolveEmailConfig({ id: 'fixture', smtp: { host: '127.0.0.1', port: proxy.port, secure: false, auth: { user: 'fixture', pass: 'fixture' } }, imap: { host: 'imap.fixture', user: 'fixture', password: 'fixture', port: 993, tls: true } });
  const endpoint = new EmailEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'email'), config, createImap: () => imap });
  const runtime = await emailDeliveryRuntime(endpoint);
  try {
    const receipt = await runtime.send('local fixture', mode === 'partial' ? 'actor@example.com, other@example.com' : 'actor@example.com');
    if (mode === 'accepted') expect(receipt).toMatchObject({ status: 'sent', message: { id: expect.any(String) } });
    else {
      expect(receipt).toMatchObject({ status: 'failed', failure: { code: mode === 'rejected' ? 'platform_rejected' : 'delivery_unconfirmed' } });
      expect(receipt.failure?.deliveryUnknown === true).toBe(mode !== 'rejected');
    }
    const expectedData = mode === 'rejected' ? 0 : 1;
    expect(dataCount).toBe(expectedData);
    await new Promise(done => setTimeout(done, 50)); expect(dataCount).toBe(expectedData);
  } finally {
    await runtime.close(); await proxy.close(); sockets.forEach(socket => socket.destroy());
    await new Promise<void>(done => server.close(() => done()));
  }
});
