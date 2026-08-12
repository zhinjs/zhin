import { describe, expect, it } from 'vitest';
import { dispatchExtendedConsoleRpc } from '@zhin.js/host-http';
import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import {
  INBOX_TABLE_MESSAGE,
  INBOX_TABLE_REQUEST,
  type DatabaseHost,
  type DatabaseHostModel,
} from '@zhin.js/plugin-runtime';
import {
  buildInboxMessageRow,
  conversationToInboxChannel,
  installInboxMessageRecorder,
} from '../../src/plugin-runtime/inbox-installer.js';

/** 内存假 DatabaseHost：行存 Map，select/insert/update 按 where 等值匹配。 */
function fakeDatabaseHost(tableNames: string[]): {
  host: DatabaseHost;
  rows: Map<string, Record<string, unknown>[]>;
} {
  const rows = new Map<string, Record<string, unknown>[]>();
  let nextId = 1;
  const match = (row: Record<string, unknown>, query: Record<string, unknown>) =>
    Object.entries(query).every(([key, value]) => row[key] === value);
  const host = {
    dialect: 'sqlite',
    started: true,
    define(name: string) {
      if (!rows.has(name)) rows.set(name, []);
    },
    tables: () => [...rows.keys()],
    models: {
      get(name: string): DatabaseHostModel | undefined {
        const table = rows.get(name);
        if (!table) return undefined;
        return {
          insert: async (row: Record<string, unknown>) => {
            table.push({ id: nextId++, ...row });
          },
          select: () => ({
            where: async (query: Record<string, unknown>) =>
              table.filter((row) => match(row, query)),
            then: (onfulfilled?: ((value: Record<string, unknown>[]) => unknown) | null) =>
              Promise.resolve(table).then(onfulfilled),
          }),
          delete: () => ({
            where: async (query: Record<string, unknown>) => {
              const before = table.length;
              for (let index = table.length - 1; index >= 0; index -= 1) {
                if (match(table[index]!, query)) table.splice(index, 1);
              }
              return before - table.length;
            },
          }),
          update: (patch: Record<string, unknown>) => ({
            where: async (query: Record<string, unknown>) => {
              let count = 0;
              for (const row of table) {
                if (match(row, query)) {
                  Object.assign(row, patch);
                  count += 1;
                }
              }
              return count;
            },
          }),
        } as DatabaseHostModel;
      },
    },
  } as unknown as DatabaseHost;
  for (const name of tableNames) rows.set(name, []);
  return { host, rows };
}

function fakeIm(endpointId?: string): {
  im: ImRuntime;
  emit: (event: RuntimeMessageEvent) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(event: RuntimeMessageEvent) => void>();
  const im = {
    onMessage(listener: (event: RuntimeMessageEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getEndpoint: () => (endpointId ? { name: endpointId } : null),
  } as unknown as ImRuntime;
  return {
    im,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

const capabilityId = 'root\0zhin.adapter\0icqq';

function inboundEvent(overrides: Partial<RuntimeMessageEvent> = {}): RuntimeMessageEvent {
  return {
    direction: 'inbound',
    conversation: {
      endpoint: { id: capabilityId, adapter: 'root' },
      kind: 'group',
      id: '888',
    },
    sender: { id: '10001' },
    contentPreview: 'hello',
    messageId: 'm-1',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('conversationToInboxChannel', () => {
  it('maps group / private kinds and group/guild parents', () => {
    expect(conversationToInboxChannel({
      endpoint: { id: capabilityId, adapter: 'root' }, kind: 'group', id: '888',
    })).toEqual({
      channelType: 'group', channelId: '888', parentType: null, parentId: null,
    });
    expect(conversationToInboxChannel({
      endpoint: { id: capabilityId, adapter: 'root' }, kind: 'private', id: '10001',
    })).toEqual({
      channelType: 'private', channelId: '10001', parentType: null, parentId: null,
    });
    expect(conversationToInboxChannel({
      endpoint: { id: capabilityId, adapter: 'root' }, kind: 'private', id: '2',
      parent: { kind: 'group', id: '100' },
    })).toEqual({
      channelType: 'private', channelId: '2', parentType: 'group', parentId: '100',
    });
    expect(conversationToInboxChannel({
      endpoint: { id: capabilityId, adapter: 'root' }, kind: 'channel', id: 'c-1',
      parent: { kind: 'channel', id: 'g-1' },
    })).toEqual({
      channelType: 'channel', channelId: 'c-1', parentType: 'guild', parentId: 'g-1',
    });
  });
});

describe('buildInboxMessageRow', () => {
  const resolveEndpoint = () => '1234';

  it('maps inbound events: sender is the platform user', () => {
    const row = buildInboxMessageRow(inboundEvent(), resolveEndpoint);
    expect(row).toEqual({
      adapter: 'icqq',
      endpoint_id: '1234',
      platform_message_id: 'm-1',
      channel_id: '888',
      channel_type: 'group',
      channel_name: null,
      channel_parent_type: null,
      channel_parent_id: null,
      sender_id: '10001',
      sender_name: null,
      sender_payload: '{}',
      content: 'hello',
      raw: null,
      created_at: 1_700_000_000_000,
    });
  });

  it('maps outbound events: sender is the endpoint itself', () => {
    const row = buildInboxMessageRow(
      inboundEvent({ direction: 'outbound', sender: undefined, messageId: undefined }),
      resolveEndpoint,
    );
    expect(row.sender_id).toBe('1234');
    expect(row.platform_message_id).toBe('local:1700000000000');
  });

  it('maps group-parented private conversations to private channel with group parent', () => {
    const row = buildInboxMessageRow(
      inboundEvent({
        conversation: {
          endpoint: { id: capabilityId, adapter: 'root' },
          kind: 'private',
          id: '2',
          parent: { kind: 'group', id: '100' },
        },
      }),
      resolveEndpoint,
    );
    expect(row.channel_type).toBe('private');
    expect(row.channel_id).toBe('2');
    expect(row.channel_parent_type).toBe('group');
    expect(row.channel_parent_id).toBe('100');
  });
});

describe('installInboxMessageRecorder', () => {
  it('writes inbound and outbound events into unified_inbox_message', async () => {
    const { host, rows } = fakeDatabaseHost([INBOX_TABLE_MESSAGE]);
    const { im, emit } = fakeIm('1234');
    installInboxMessageRecorder(im, host);

    emit(inboundEvent());
    emit(inboundEvent({ direction: 'outbound', sender: undefined, timestamp: 1_700_000_000_001 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const table = rows.get(INBOX_TABLE_MESSAGE)!;
    expect(table).toHaveLength(2);
    expect(table[0]).toMatchObject({
      adapter: 'icqq', endpoint_id: '1234', sender_id: '10001', channel_id: '888',
    });
    expect(table[1]).toMatchObject({ sender_id: '1234' });
  });

  it('subscribes only once per ImRuntime', () => {
    const { host } = fakeDatabaseHost([INBOX_TABLE_MESSAGE]);
    const { im, listenerCount } = fakeIm('1234');
    installInboxMessageRecorder(im, host);
    installInboxMessageRecorder(im, host);
    expect(listenerCount()).toBe(1);
  });

  it('does not cache the localName fallback while the endpoint is not ready', async () => {
    const { host, rows } = fakeDatabaseHost([INBOX_TABLE_MESSAGE]);
    const listeners = new Set<(event: RuntimeMessageEvent) => void>();
    let endpointId: string | null = null;
    let getEndpointCalls = 0;
    const im = {
      onMessage(listener: (event: RuntimeMessageEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getEndpoint: () => {
        getEndpointCalls += 1;
        return endpointId ? { name: endpointId } : null;
      },
    } as unknown as ImRuntime;
    const emit = (event: RuntimeMessageEvent) => {
      for (const listener of listeners) listener(event);
    };
    installInboxMessageRecorder(im, host);

    // 启动早期 endpoint 未就绪：回退 localName，但不写缓存。
    emit(inboundEvent({ timestamp: 1_700_000_000_000 }));
    // endpoint 上线后：应解析出 live 名而不是被固化的回退值。
    endpointId = '8596238';
    emit(inboundEvent({ timestamp: 1_700_000_000_001 }));
    // 命中后写缓存：之后即使 getEndpoint 不再可用也用缓存值。
    endpointId = null;
    emit(inboundEvent({ timestamp: 1_700_000_000_002 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const table = rows.get(INBOX_TABLE_MESSAGE)!;
    expect(table.map((row) => row.endpoint_id)).toEqual(['icqq', '8596238', '8596238']);
    expect(getEndpointCalls).toBe(2);
  });

  it('end-to-end: rows written by the recorder are readable via console-rpc-extended', async () => {
    const { host, rows } = fakeDatabaseHost([INBOX_TABLE_MESSAGE, INBOX_TABLE_REQUEST]);
    const { im, emit } = fakeIm('1234');
    installInboxMessageRecorder(im, host);
    emit(inboundEvent());
    await new Promise((resolve) => setTimeout(resolve, 0));

    rows.get(INBOX_TABLE_REQUEST)!.push({
      id: 1,
      adapter: 'icqq',
      endpoint_id: '1234',
      platform_request_id: 'flag-1',
      type: 'friend',
      scene_type: null,
      scene_id: '10001',
      sub_type: null,
      actor_id: '10001',
      actor_name: '张三',
      comment: '加个好友',
      created_at: 1_700_000_000_000,
      resolved: 0,
      resolved_at: null,
      consumed: 0,
      consumed_at: null,
    });

    const ctx = {
      fullScope: true,
      projectRoot: '/tmp/project',
      databaseHost: { models: host.models },
    };

    const messages = await dispatchExtendedConsoleRpc(
      'endpoint:inboxMessages',
      { $adapter: 'icqq', $endpoint: '1234', $channel_id: '888', $channel_type: 'group' },
      ctx,
    );
    expect(messages).toHaveProperty('data');
    const messageData = (messages as { data: { messages: Record<string, unknown>[]; inboxEnabled: boolean } }).data;
    expect(messageData.inboxEnabled).toBe(true);
    expect(messageData.messages).toHaveLength(1);
    expect(messageData.messages[0]).toMatchObject({
      platform_message_id: 'm-1',
      sender_id: '10001',
      content: 'hello',
      channel: { id: '888', type: 'group' },
    });

    const requests = await dispatchExtendedConsoleRpc(
      'endpoint:requests',
      { $adapter: 'icqq', $endpoint: '1234' },
      ctx,
    );
    const requestData = (requests as { data: { requests: Record<string, unknown>[] } }).data;
    expect(requestData.requests).toHaveLength(1);
    expect(requestData.requests[0]).toMatchObject({
      platform_request_id: 'flag-1',
      actor: { id: '10001', name: '张三' },
    });

    // consumed 写路径端到端：标记后行 consumed=1
    const consumed = await dispatchExtendedConsoleRpc(
      'endpoint:requestConsumed',
      { $row_ids: [1] },
      ctx,
    );
    expect(consumed).toEqual({ data: { success: true, updated: 1 } });
    expect(rows.get(INBOX_TABLE_REQUEST)![0]).toMatchObject({ consumed: 1 });
  });
});
