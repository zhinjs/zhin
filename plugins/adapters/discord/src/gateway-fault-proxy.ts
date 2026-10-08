import { getLogger, formatCompact } from '@zhin.js/logger';
import { Collection } from '@discordjs/collection';
import {
  SimpleContextFetchingStrategy, WebSocketShard, WebSocketShardEvents,
  managerToFetchingStrategyOptions,
  type IShardingStrategy, type SessionInfo, type WebSocketManager,
  type WebSocketShardDestroyOptions,
} from '@discordjs/ws';

export function validateDiscordGatewayFaultProxy(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Discord gateway fault proxy must be ws://127.0.0.1:PORT/');
  return url.origin;
}

/** Public gateway host only; credentials and arbitrary proxy targets are rejected. */
export function discordGatewayProxyURL(proxy: string, upstream: string): string {
  const origin = validateDiscordGatewayFaultProxy(proxy); const target = new URL(upstream);
  if (target.protocol !== 'wss:' || !/^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(target.hostname)
    || (target.port && target.port !== '443') || target.username || target.password || target.pathname !== '/' || target.hash
    || [...target.searchParams].some(([key, value]) => !(key === 'v' && /^\d{1,2}$/.test(value)) && !(key === 'encoding' && value === 'json') && !(key === 'compress' && value === 'zlib-stream'))) throw new Error('Invalid Discord gateway host');
  return `${origin}/__discord_gateway/${target.hostname}`;
}

/** Undo only this proxy's exact internal route when SDK updates sequence. */
export function canonicalDiscordGatewayURL(proxy: string, value: string): string {
  const origin = validateDiscordGatewayFaultProxy(proxy); const url = new URL(value);
  if (url.origin !== origin) { discordGatewayProxyURL(proxy, value); return value; }
  const host = url.pathname.match(/^\/__discord_gateway\/(gateway(?:-[a-z0-9-]+)?\.discord\.gg)$/)?.[1];
  if (!host || url.username || url.password || url.search || url.hash) throw new Error('Invalid internal Discord gateway route');
  return `wss://${host}/`;
}

/** Keeps SDK heartbeat/Identify/Resume. Only connection URLs use the test proxy. */
export class DiscordFaultProxyStrategy implements IShardingStrategy {
  #failureReject!: (error: Error) => void;
  readonly #failure = new Promise<never>((_, reject) => { this.#failureReject = reject; });
  readonly #diagnosed = new Set<string>();
  readonly #shards = new Collection<number, WebSocketShard>();
  constructor(readonly manager: WebSocketManager, readonly proxy: string) { validateDiscordGatewayFaultProxy(proxy); void this.#failure.catch(() => {}); }
  async spawn(shardIds: number[]): Promise<void> {
    const options = await managerToFetchingStrategyOptions(this.manager);
    const mapped = { ...options, gatewayInformation: { ...options.gatewayInformation, url: discordGatewayProxyURL(this.proxy, options.gatewayInformation.url) } };
    for (const shardId of shardIds) {
      const context = new SimpleContextFetchingStrategy(this.manager, mapped);
      const retrieve = context.retrieveSessionInfo.bind(context); const update = context.updateSessionInfo.bind(context);
      const invalid = () => {
        const error = new Error('Invalid Discord gateway session'); this.#failureReject(error);
        void Promise.resolve(this.manager.emit(WebSocketShardEvents.Error, { error, shardId })).catch(() => {});
        void shard.destroy({ code: 1000, reason: 'Invalid gateway session' }).catch(() => {});
      };
      context.retrieveSessionInfo = async (id: number): Promise<SessionInfo | null> => {
        try {
          const session = await retrieve(id);
          if (!session) return null;
          const canonical = canonicalDiscordGatewayURL(this.proxy, session.resumeURL);
          const target = new URL(canonical);
          if (!this.#diagnosed.has(target.hostname) && this.#diagnosed.size < 8) {
            this.#diagnosed.add(target.hostname);
            getLogger('discord').debug(formatCompact({ op: 'discord_gateway_resume_target', hostname: target.hostname, pathIsRoot: target.pathname === '/', queryKeys: [...new Set(target.searchParams.keys())].join(',') }));
          }
          return { ...session, resumeURL: discordGatewayProxyURL(this.proxy, canonical) };
        } catch { invalid(); return null; }
      };
      context.updateSessionInfo = async (id, session) => {
        try { return await update(id, session ? { ...session, resumeURL: canonicalDiscordGatewayURL(this.proxy, session.resumeURL) } : null); }
        catch { invalid(); }
      };
      const shard = new WebSocketShard(context, shardId);
      for (const event of Object.values(WebSocketShardEvents)) shard.on(event, (payload?: object) => this.manager.emit(event, { ...payload, shardId } as never));
      this.#shards.set(shardId, shard);
    }
  }
  async connect(): Promise<void> { await Promise.race([Promise.all([...this.#shards.values()].map(shard => shard.connect())), this.#failure]); }
  async destroy(options?: Omit<WebSocketShardDestroyOptions, 'recover'>): Promise<void> {
    await Promise.all([...this.#shards.values()].map(shard => shard.destroy(options))); this.#shards.clear();
  }
  async send(shardId: number, payload: Parameters<WebSocketShard['send']>[0]): Promise<void> {
    const shard = this.#shards.get(shardId); if (!shard) throw new RangeError('Discord shard not found'); await shard.send(payload);
  }
  async fetchStatus() { return this.#shards.mapValues(shard => shard.status); }
}
