import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTcpFaultProxy } from '../../scripts/platform-acceptance/tcp-fault-proxy.mjs';

describe('TCP email fault proxy', () => {
  it('preserves end-to-end TLS identity, cuts established connections and only recovers new connections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zhin-tcp-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=mail.test', '-addext', 'subjectAltName=DNS:mail.test'], { stdio: 'ignore' });
    const key = readFileSync(join(directory, 'key.pem'));
    const ca = readFileSync(join(directory, 'cert.pem'));
    const peers = new Set<tls.TLSSocket>();
    const server = tls.createServer({ key, cert: ca }, socket => {
      peers.add(socket); socket.once('close', () => peers.delete(socket));
      socket.on('error', () => {}); socket.pipe(socket);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as net.AddressInfo).port, port: 0, controlPort: 0 });
    const connect = (servername: string) => tls.connect({ host: proxy.host, port: proxy.port, servername, ca, rejectUnauthorized: true });
    const clients: tls.TLSSocket[] = [];
    try {
      const client = connect('mail.test'); clients.push(client); await once(client, 'secureConnect');
      expect(client.authorized).toBe(true);
      const echoed = once(client, 'data'); client.write('opaque SMTP/IMAP bytes');
      expect((await echoed)[0].toString()).toBe('opaque SMTP/IMAP bytes');
      const wrong = connect('wrong.test'); clients.push(wrong);
      expect((await once(wrong, 'error'))[0].code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      const disconnected = once(client, 'close');
      await fetch(`${proxy.controlOrigin}/cut`, { method: 'POST' }); await disconnected;
      const blocked = net.connect({ host: proxy.host, port: proxy.port });
      blocked.on('error', () => {}); await once(blocked, 'close');
      expect(proxy.status().connections).toBe(2);
      await fetch(`${proxy.controlOrigin}/recover`, { method: 'POST' });
      const recovered = connect('mail.test'); clients.push(recovered); await once(recovered, 'secureConnect');
      expect(recovered.authorized).toBe(true);
      expect(client.destroyed).toBe(true);
      expect(JSON.stringify(proxy.status())).not.toContain('mail.test');
    } finally {
      clients.forEach(socket => socket.destroy());
      await proxy.close(); await proxy.close();
      peers.forEach(socket => socket.destroy());
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
    expect(proxy.status()).toMatchObject({ state: 'closed', activeSockets: 0 });
  });

  it('rejects dynamic URLs/credentials and invalid ports before opening listeners', async () => {
    await expect(createTcpFaultProxy({ upstreamHost: 'user:secret@host', upstreamPort: 993 })).rejects.toThrow('invalid upstream host');
    await expect(createTcpFaultProxy({ upstreamHost: 'mail.test', upstreamPort: 0 })).rejects.toThrow('invalid port');
  });

  it('cleans the data listener if the control port cannot bind', async () => {
    const occupied = net.createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
    const port = (occupied.address() as net.AddressInfo).port;
    try {
      await expect(createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: 993, port: 0, controlPort: port })).rejects.toThrow('Could not bind');
    } finally {
      await new Promise<void>(resolve => occupied.close(() => resolve()));
    }
  });
});
