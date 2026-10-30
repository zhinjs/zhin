import WebSocket from 'ws';
import { buildWsConnectOptions, callOneBot12Action, type OneBot12ActionResponse, type OneBot12WebhookConfig, type OneBot12WsConfig } from './protocol.js';
import { callOneBot12WsAction, handleOneBot12WsMessage, rejectAllPending } from './ws-transport.js';
import type { OneBot12PendingAction } from './ws-types.js';

/** Separate read-only connection: never changes credentials or state of the running Endpoint. */
export async function probeOnebot12Identity(config: OneBot12WsConfig, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const { url, headers } = buildWsConnectOptions(config);
  const socket = new WebSocket(url, { headers }), pending = new Map<string, OneBot12PendingAction>();
  let rejectOpen: (error: unknown) => void = () => undefined;
  const abort = () => { rejectOpen(signal.reason); rejectAllPending(pending); socket.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', data => handleOneBot12WsMessage(data, { endpointId: config.id, pending, ingest: () => undefined }));
  socket.on('close', () => { rejectOpen(new Error('Identity connection closed')); rejectAllPending(pending); });
  try {
    await new Promise<void>((resolve, reject) => { rejectOpen = reject; socket.once('open', resolve); socket.on('error', reject); });
    signal.throwIfAborted();
    const sequence = { value: 0 }, self = { platform: config.platform, user_id: config.userId };
    return await identifySelectedBot(self, action => callOneBot12WsAction(socket, pending, sequence, action, {}, self), signal);
  } finally {
    signal.removeEventListener('abort', abort); rejectAllPending(pending); socket.terminate();
  }
}

export async function probeOnebot12HttpIdentity(config: OneBot12WebhookConfig, signal: AbortSignal): Promise<string | undefined> {
  const self = { platform: config.platform, user_id: config.userId };
  return identifySelectedBot(self, action => callOneBot12Action({ url: config.api_url, access_token: config.access_token, signal, self }, action), signal);
}

async function identifySelectedBot(selected: Readonly<{ platform: string; user_id: string }>, query: (action: string) => Promise<OneBot12ActionResponse>, signal: AbortSignal): Promise<string | undefined> {
    const status = await query('get_status');
    signal.throwIfAborted();
    if (status.status !== 'ok' || status.retcode !== 0) throw new Error('OneBot12 identity status lookup failed');
    const data = status.data;
    if (!data || typeof data !== 'object' || !('bots' in data) || !Array.isArray(data.bots)) return undefined;
    const match = data.bots.some((bot: unknown) => {
      if (!bot || typeof bot !== 'object' || !('self' in bot) || !bot.self || typeof bot.self !== 'object') return false;
      return 'platform' in bot.self && 'user_id' in bot.self && bot.self.platform === selected.platform && bot.self.user_id === selected.user_id;
    });
    if (!match) return undefined;
    const account = await query('get_self_info');
    signal.throwIfAborted();
    if (account.status !== 'ok' || account.retcode !== 0) throw new Error('OneBot12 account identity lookup failed');
    if (!account.data || typeof account.data !== 'object' || !('user_id' in account.data) || account.data.user_id !== selected.user_id) return undefined;
    return `onebot12:${JSON.stringify([selected.platform, selected.user_id])}`;
}
