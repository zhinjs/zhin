import { Agent } from 'node:https';
import tls from 'node:tls';
import { Socket } from 'node:net';

export interface KookApiProxy { readonly port: number }

/** JSON Web API only: keep www.kookapp.cn identity, route TCP to a fixed loopback port. */
export function createKookApiAgent(proxy: KookApiProxy): Agent {
  const agent = new Agent({ keepAlive: false });
  agent.createConnection = options => {
    const hostname = String(options.hostname ?? options.host ?? '');
    if (hostname !== 'www.kookapp.cn' || Number(options.port ?? 443) !== 443) {
      const rejected = new Socket();
      queueMicrotask(() => rejected.destroy(new Error('KOOK JSON API proxy rejected destination identity')));
      return rejected;
    }
    return tls.connect({ ...options as tls.ConnectionOptions, path: undefined,
      host: '127.0.0.1', port: proxy.port, servername: 'www.kookapp.cn', rejectUnauthorized: true });
  };
  return agent;
}
