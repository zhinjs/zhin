import { Agent, fetch as dispatcherFetch } from 'undici';
import tls from 'node:tls';
import type { LarkFetch } from './endpoint.js';

export interface LarkWebApiProxy { readonly port: number }

export function validateLarkWebApiProxy(value: LarkWebApiProxy): void {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'port')
    || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new TypeError('Invalid Lark webApiProxy: only a loopback port is allowed');
  }
}

/** Per-endpoint fetch dispatcher; URL/Host/SNI remain the official Feishu identity. */
export function createLarkWebApiTransport(proxy: LarkWebApiProxy) {
  validateLarkWebApiProxy(proxy);
  const port = proxy.port;
  const sockets = new Set<tls.TLSSocket>();
  let active = true;
  let dispatcher: Agent | undefined;
  const fetch: LarkFetch = async (url, init) => {
    const target = new URL(url);
    if (target.origin !== 'https://open.feishu.cn' || target.username || target.password
      || target.hash || !target.pathname.startsWith('/open-apis/')) {
      throw new TypeError('Lark Web API proxy rejected destination identity');
    }
    if (!active) throw new Error('Lark Web API proxy transport is stopped');
    dispatcher ??= new Agent({ connect(options, callback) {
      if (options.hostname !== 'open.feishu.cn' || options.protocol !== 'https:' || Number(options.port || 443) !== 443) {
        callback(new Error('Lark Web API proxy rejected destination identity'), null);
        return;
      }
      const socket = tls.connect({ host: '127.0.0.1', port,
        servername: 'open.feishu.cn', rejectUnauthorized: true });
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.setTimeout(10_000, () => socket.destroy(new Error('Lark Web API TLS connection timeout')));
      const failed = (error: Error) => callback(error, null);
      socket.once('error', failed);
      socket.once('secureConnect', () => { socket.setTimeout(0); socket.removeListener('error', failed); callback(null, socket); });
    } });
    // Pair fetch and its dispatcher from the same Undici version; Node's bundled
    // handler protocol may differ (notably Node 26 versus Undici 6).
    return dispatcherFetch(url, { ...init, redirect: 'error', dispatcher } as Parameters<typeof dispatcherFetch>[1]);
  };
  return {
    fetch,
    reopen() { active = true; },
    async close() { active = false; for (const socket of sockets) socket.destroy(new Error('Lark Web API proxy transport stopped')); const previous = dispatcher; dispatcher = undefined; await previous?.destroy(); },
  };
}
