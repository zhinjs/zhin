import { Agent } from 'node:https';
import tls from 'node:tls';
import { Socket } from 'node:net';
import { getLogger } from '@zhin.js/logger';
export interface SlackStreamProxy { readonly port: number; readonly serverName: string }
export function createSlackStreamAgent(proxy: SlackStreamProxy): Agent {
  const agent = new Agent({ keepAlive: false });
  const direct = agent.createConnection.bind(agent);
  agent.createConnection = (options, callback) => {
    const hostname = String(options.hostname ?? options.host ?? '');
    const headers = options.headers as Record<string, unknown> | undefined;
    const upgrade = Object.entries(headers ?? {}).some(([name, value]) => name.toLowerCase() === 'upgrade' && String(value).toLowerCase() === 'websocket');
    if (hostname === proxy.serverName && Number(options.port ?? 443) === 443) return tls.connect({ ...options as tls.ConnectionOptions, path: undefined,
      host: '127.0.0.1', port: proxy.port, servername: hostname, rejectUnauthorized: true });
    if (!upgrade && hostname === 'slack.com' && Number(options.port ?? 443) === 443) return direct(options, callback);
    getLogger('slack').warn(`Stream proxy rejected gateway hostname: ${hostname}`);
    const rejected = new Socket();
    queueMicrotask(() => rejected.destroy(new Error('Slack Stream proxy gateway identity changed; update fixed upstream before retrying')));
    return rejected;
  };
  return agent;
}
