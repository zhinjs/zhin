import tls from 'node:tls';
import WebSocket from 'ws';
import { getLogger } from '@zhin.js/logger';

export interface KookStreamProxy { readonly port: number; readonly serverName: string }

/** Route TCP only. WSS HTTP Host, path, ticket, TLS SNI and peer validation stay original. */
export function createKookStreamSocket(url: string, proxy?: KookStreamProxy): WebSocket {
  if (!proxy) return new WebSocket(url);
  const target = new URL(url);
  if (target.protocol !== 'wss:' || target.hostname !== proxy.serverName || (target.port && target.port !== '443')) {
    // The hostname is safe diagnostics; never print URL/query/ticket or SDK errors.
    getLogger('kook').warn(`Stream proxy rejected gateway hostname: ${target.hostname}`);
    throw new Error('KOOK Stream proxy gateway identity changed; update the fixed upstream before retrying');
  }
  return new WebSocket(url, {
    createConnection: (options: import('node:http').ClientRequestArgs) => tls.connect({ ...options as tls.ConnectionOptions, path: undefined, host: '127.0.0.1', port: proxy.port,
      servername: target.hostname, rejectUnauthorized: true }),
  });
}
