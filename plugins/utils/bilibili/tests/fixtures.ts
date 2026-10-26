import { resolveCommandSession } from 'zhin.js/command';
import { resolveBilibiliConfig, type BilibiliConfig } from '../src/config.js';
import type { BiliClient, DynamicItem, LiveInfo, RoomInfo, UserCard } from '../src/api.js';
import { BilibiliWatcher } from '../src/poll.js';
import { createInMemoryBiliDb, type BiliDb } from '../src/store.js';
import type { BilibiliRuntime } from '../src/runtime.js';

/** Default sender is a group admin so subscription flows pass the manager check. */
export function biliMessage(kind: 'private' | 'group' | 'channel' = 'group', id = '10001', roles: readonly string[] = ['admin'], senderId = 'u1') {
  return {
    conversation: { endpoint: { id: 'root/sandbox', adapter: 'root/sandbox' }, kind, id },
    content: 'bili list',
    generation: 1,
    sender: { id: senderId, name: 'tester', roles: [...roles] },
    clientAdapter: 'sandbox',
    endpointId: 'bot1',
    segments: [{ type: 'text', data: { text: 'bili list' } }],
  };
}

export function live(uid: string, liveStatus: number, liveTime = 0, extra: Partial<LiveInfo> = {}): LiveInfo {
  return {
    uid, uname: `UP${uid}`, roomId: `9${uid}`, title: '测试直播', liveStatus, liveTime,
    cover: '', area: '虚拟日常', url: `https://live.bilibili.com/9${uid}`, ...extra,
  };
}

export function dyn(id: string, pubTs: number, extra: Partial<DynamicItem> = {}): DynamicItem {
  return {
    id, author: 'UP', pubTs, type: 'DYNAMIC_TYPE_WORD', pinned: false,
    summary: `动态 ${id}`, url: `https://t.bilibili.com/${id}`, ...extra,
  };
}

export class FakeClient {
  liveStatus = new Map<string, LiveInfo>();
  dynamics = new Map<string, DynamicItem[]>();
  liveError: Error | undefined;
  dynamicError: Error | undefined;
  calls = { live: 0, dynamics: 0 };
  card: UserCard | Error = { uid: '1', name: '测试UP' };
  room: RoomInfo | Error = {
    uid: '1', roomId: '100', title: '房间', liveStatus: 1, area: '聊天', online: 42, url: 'https://live.bilibili.com/100',
  };

  async getLiveStatus(uids: readonly string[]): Promise<Map<string, LiveInfo>> {
    this.calls.live += 1;
    if (this.liveError) throw this.liveError;
    return new Map(uids.flatMap((uid) => (this.liveStatus.has(uid) ? [[uid, this.liveStatus.get(uid)!] as const] : [])));
  }

  async getDynamics(uid: string): Promise<DynamicItem[]> {
    this.calls.dynamics += 1;
    if (this.dynamicError) throw this.dynamicError;
    return this.dynamics.get(uid) ?? [];
  }

  async getUserCard(): Promise<UserCard> {
    if (this.card instanceof Error) throw this.card;
    return this.card;
  }

  async getRoomInfo(): Promise<RoomInfo> {
    if (this.room instanceof Error) throw this.room;
    return this.room;
  }

  resetSession(): void {}
}

export interface Harness {
  db: BiliDb;
  client: FakeClient;
  pushes: { channelId: string; content: string }[];
  clock: { now: number };
  watcher: BilibiliWatcher;
  runtime: BilibiliRuntime;
  sleeps: number[];
}

export function harness(config: BilibiliConfig = {}, withOutbound = true): Harness {
  const db = createInMemoryBiliDb();
  const client = new FakeClient();
  const pushes: Harness['pushes'] = [];
  const sleeps: number[] = [];
  const clock = { now: 1_800_000_000_000 };
  const resolved = resolveBilibiliConfig({ jitterMs: 0, requestGapMs: 0, ...config });
  const outbound = withOutbound
    ? async (input: { channelId: string; content: string }) => { pushes.push({ channelId: input.channelId, content: input.content }); }
    : null;
  const watcher = new BilibiliWatcher({
    db,
    config: resolved,
    client: client as unknown as BiliClient,
    outbound,
    now: () => clock.now,
    random: () => 0.5,
    sleep: async (ms) => { sleeps.push(ms); },
    warn: () => undefined,
  });
  const runtime: BilibiliRuntime = {
    db, config: resolved, client: client as unknown as BiliClient, outbound, watcher, persistent: true,
  };
  return { db, client, pushes, clock, watcher, runtime, sleeps };
}

export function commandContext(runtime: BilibiliRuntime, params: Record<string, unknown> = {}, input: unknown = biliMessage()) {
  return {
    // Same session projection (adapter / scene / sender.role) the command router builds.
    ...resolveCommandSession(input),
    owner: {} as never,
    generation: 0,
    locale: 'zh-CN' as const,
    formatCommand: (path: string) => `!${path}`,
    config: {},
    use: (token: unknown) => {
      void token;
      return runtime;
    },
    args: [],
    params,
    input,
  };
}
