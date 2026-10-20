import tls from 'node:tls';
import { Agent } from 'undici';

export interface DiscordRestApiProxy { readonly port: number }

/** JSON REST only, fixed Discord TLS identity and loopback TCP route. */
export function createDiscordRestApiAgent(proxy: DiscordRestApiProxy): Agent & { destroyProxy(): Promise<void> } {
  const pending = new Set<() => void>();
  let closed = false;
  const agent = new Agent({ connect(options, callback) {
    if (closed) { queueMicrotask(() => callback(new Error('Discord REST proxy stopped'), null)); return; }
    if (options.hostname !== 'discord.com' || options.protocol !== 'https:' || Number(options.port || 443) !== 443) {
      queueMicrotask(() => callback(new Error('Discord REST proxy rejected destination identity'), null));
      return;
    }
    const socket = tls.connect({ host: '127.0.0.1', port: proxy.port,
      servername: 'discord.com', rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] });
    let complete = false;
    const finish = (error?: Error) => {
      if (complete) return; complete = true;
      pending.delete(cancel);
      clearTimeout(timer); socket.off('error', onError);
      if (error) { socket.destroy(); callback(error, null); }
      else callback(null, socket);
    };
    const cancel = () => finish(new Error('Discord REST proxy stopped'));
    pending.add(cancel);
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error('Discord REST proxy TLS connection timed out')), 10_000);
    timer.unref(); socket.once('error', onError); socket.once('secureConnect', () => finish());
  } });
  return Object.assign(agent, { async destroyProxy() {
    closed = true;
    for (const cancel of [...pending]) cancel();
    await agent.destroy();
  } });
}
