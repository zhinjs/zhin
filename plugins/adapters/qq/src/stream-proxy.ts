import { Agent } from 'node:https';
import tls from 'node:tls';
import { getLogger } from '@zhin.js/logger';

export interface QqStreamProxy { readonly port: number; readonly serverName: string }

/** QQ receiver uses this agent only for WSS; discovery/OpenAPI stay unchanged. */
export function createQqStreamAgent(proxy: QqStreamProxy): Agent {
  const agent = new Agent({ keepAlive: false });
  agent.createConnection = options => {
    const hostname = String(options.hostname ?? options.host ?? '');
    if (hostname !== proxy.serverName || Number(options.port ?? 443) !== 443) {
      getLogger('qq').warn(`Stream proxy rejected gateway hostname: ${hostname}`);
      throw new Error('Qq Stream proxy gateway identity changed; update fixed upstream before retrying');
    }
    return tls.connect({ ...options as tls.ConnectionOptions, path: undefined, host: '127.0.0.1', port: proxy.port,
      servername: hostname, rejectUnauthorized: true });
  };
  return agent;
}
