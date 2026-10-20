import { Agent } from 'node:https';
import tls from 'node:tls';
import { Socket } from 'node:net';

export interface SlackWebApiProxy { readonly port: number }

/** JSON Web API only: keep slack.com identity, route TCP to a fixed loopback port. */
export function createSlackWebApiAgent(proxy: SlackWebApiProxy): Agent {
  const agent = new Agent({ keepAlive: false });
  agent.createConnection = options => {
    const hostname = String(options.hostname ?? options.host ?? '');
    if (hostname !== 'slack.com' || Number(options.port ?? 443) !== 443) {
      const rejected = new Socket();
      queueMicrotask(() => rejected.destroy(new Error('Slack Web API proxy rejected destination identity')));
      return rejected;
    }
    return tls.connect({ ...options as tls.ConnectionOptions, path: undefined,
      host: '127.0.0.1', port: proxy.port, servername: 'slack.com', rejectUnauthorized: true });
  };
  return agent;
}
