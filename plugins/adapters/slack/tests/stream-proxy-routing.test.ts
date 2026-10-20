import { once } from 'node:events';
import { Agent } from 'node:https';
import { Socket } from 'node:net';
import WebSocket from 'ws';
import tls from 'node:tls';
import { createSlackStreamAgent } from '../src/stream-proxy.js';

it.each(['changed.gateway.test', 'slack.com'])('rejects unmatched real WebSocket destination %s without direct TLS bypass', async hostname => {
  const connector = vi.spyOn(tls, 'connect');
  const agent = createSlackStreamAgent({ port: 18443, serverName: 'gateway.test' });
  const socket = new WebSocket(`wss://${hostname}/socket?ticket=fixture`, { agent });
  try {
    expect((await once(socket, 'error'))[0].message).toContain('identity changed');
    expect(connector).not.toHaveBeenCalled();
  } finally { socket.terminate(); agent.destroy(); connector.mockRestore(); }
});

it('keeps SDK discovery host on the standard HTTPS Agent TLS path', () => {
  const socket = new Socket();
  const direct = vi.spyOn(Agent.prototype, 'createConnection').mockReturnValue(socket);
  try {
    const agent = createSlackStreamAgent({ port: 18443, serverName: 'gateway.test' });
    agent.createConnection({ host: 'slack.com', port: 443 });
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ host: 'slack.com', port: 443 }), undefined);
    agent.destroy();
  } finally { direct.mockRestore(); socket.destroy(); }
});
