import tls from 'node:tls';
import WebSocket from 'ws';
import { getLogger } from '@zhin.js/logger';

export interface DingTalkStreamProxy { readonly port: number; readonly serverName: string }

/** Route TCP only. WSS HTTP Host, path, ticket, TLS SNI and peer validation stay original. */
export function createDingTalkStreamSocket(url: string, proxy?: DingTalkStreamProxy): WebSocket {
  if (!proxy) return new WebSocket(url);
  const target = new URL(url);
  if (target.protocol !== 'wss:' || target.hostname !== proxy.serverName || (target.port && target.port !== '443')) {
    // The hostname is safe diagnostics; never print URL/query/ticket or SDK errors.
    getLogger('dingtalk').warn(`Stream proxy rejected gateway hostname: ${target.hostname}`);
    throw new Error('DingTalk Stream proxy gateway identity changed; update the fixed upstream before retrying');
  }
  return new WebSocket(url, {
    createConnection: (options: import('node:http').ClientRequestArgs) => tls.connect({ ...options as tls.ConnectionOptions, path: undefined, host: '127.0.0.1', port: proxy.port,
      servername: target.hostname, rejectUnauthorized: true }),
  });
}
