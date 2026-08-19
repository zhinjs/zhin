import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { MessageGateway } from '@zhin.js/core/runtime';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import {
  IcqqEndpoint,
  type IcqqInboxHooks,
} from '../src/endpoint.js';
import {
  buildIcqqInboxNoticeRow,
  buildIcqqInboxRequestRow,
  buildIcqqSystemRequestRow,
  isIcqqNoticePayload,
  isIcqqRequestPayload,
} from '../src/icqq-inbox.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import type { SystemMessage } from '../src/types.js';

const adapterFeature = featureId('zhin.adapter');
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'icqq');

const baseConfig = resolveIcqqConfig({ id: '10001', autoReconnect: false });

const base = { adapter: 'icqq', endpointKey: '10001' };

function createHooks(): IcqqInboxHooks & {
  requests: Record<string, unknown>[];
  notices: Record<string, unknown>[];
  published: Array<{ type: string; data: unknown }>;
} {
  const requests: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
  const published: Array<{ type: string; data: unknown }> = [];
  return {
    requests,
    notices,
    published,
    recordRequest(row) {
      requests.push(row);
    },
    recordNotice(row) {
      notices.push(row);
    },
    publish(type, data) {
      published.push({ type, data });
    },
  };
}

async function startEndpoint(
  options?: { systemMsg?: unknown[]; inbox?: IcqqInboxHooks },
): Promise<IcqqEndpoint> {
  const gateway: MessageGateway = {
    receive: vi.fn(async () => Object.freeze({ matched: true })),
    send: vi.fn(async () => 'sent'),
  };
  const endpoint = new IcqqEndpoint({
    id: endpointKey,
    gateway,
    config: baseConfig,
    ...(options?.inbox ? { inbox: options.inbox } : {}),
  });
  if (options?.systemMsg) {
    vi.mocked(endpoint.getSystemMsg).mockResolvedValue(options.systemMsg as never);
  }
  await endpoint.start();
  endpoint.open();
  return endpoint;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('icqq inbox payload guards', () => {
  it('detects request / notice post_type shells', () => {
    expect(isIcqqRequestPayload({ post_type: 'request' })).toBe(true);
    expect(isIcqqRequestPayload({ post_type: 'request.friend' })).toBe(true);
    expect(isIcqqRequestPayload({ post_type: 'notice' })).toBe(false);
    expect(isIcqqNoticePayload({ post_type: 'notice' })).toBe(true);
    expect(isIcqqNoticePayload({ post_type: 'notice.group' })).toBe(true);
    expect(isIcqqNoticePayload({ post_type: 'message' })).toBe(false);
  });
});

describe('buildIcqqInboxRequestRow', () => {
  it('maps a friend request payload (flag as platform_request_id)', () => {
    const row = buildIcqqInboxRequestRow({
      post_type: 'request',
      request_type: 'friend',
      user_id: 20002,
      nickname: '张三',
      comment: '加个好友',
      flag: 'flag-1',
      time: 1_700_000_000,
    }, base);
    expect(row).toEqual({
      adapter: 'icqq',
      endpoint_id: '10001',
      platform_request_id: 'flag-1',
      type: 'friend',
      scene_type: null,
      scene_id: '20002',
      sub_type: null,
      actor_id: '20002',
      actor_name: '张三',
      comment: '加个好友',
      created_at: 1_700_000_000_000,
      resolved: 0,
      resolved_at: null,
      consumed: 0,
      consumed_at: null,
    });
  });

  it('maps a group invite payload and falls back to seq', () => {
    const row = buildIcqqInboxRequestRow({
      post_type: 'request',
      request_type: 'group',
      sub_type: 'invite',
      group_id: 888,
      user_id: 20003,
      seq: 42,
      time: 1_700_000_000,
    }, base);
    expect(row).toMatchObject({
      platform_request_id: '42',
      type: 'group',
      scene_type: 'group',
      scene_id: '888',
      sub_type: 'invite',
      actor_id: '20003',
    });
  });

  it('returns null without user_id or any request id', () => {
    expect(buildIcqqInboxRequestRow({ post_type: 'request', flag: 'f' }, base)).toBeNull();
    expect(buildIcqqInboxRequestRow({ post_type: 'request', user_id: 1 }, base)).toBeNull();
  });
});

describe('buildIcqqInboxNoticeRow', () => {
  it('maps a group increase notice with operator as actor', () => {
    const row = buildIcqqInboxNoticeRow({
      post_type: 'notice',
      notice_type: 'group',
      sub_type: 'increase',
      group_id: 888,
      user_id: 20002,
      operator_id: 20005,
      time: 1_700_000_000,
    }, base);
    expect(row).toMatchObject({
      adapter: 'icqq',
      endpoint_id: '10001',
      type: 'group',
      sub_type: 'increase',
      scene_type: 'group',
      scene_id: '888',
      actor_id: '20005',
      target_id: '20002',
      created_at: 1_700_000_000_000,
      consumed: 0,
    });
    expect(String(row?.platform_notice_id)).toContain('group.increase');
    expect(JSON.parse(String(row?.payload))).toMatchObject({ notice_type: 'group' });
  });

  it('returns null when notice type is missing', () => {
    expect(buildIcqqInboxNoticeRow({ post_type: 'notice', user_id: 1 }, base)).toBeNull();
  });
});

describe('buildIcqqSystemRequestRow', () => {
  it('maps GET_SYSTEM_MSG friend / group entries', () => {
    const friend = buildIcqqSystemRequestRow({
      type: 'friend', user_id: 30003, nickname: '李四', comment: 'hi', flag: 'flag-9',
      time: 1_700_000_000,
    }, 'friend', base);
    expect(friend).toMatchObject({
      platform_request_id: 'flag-9',
      type: 'friend',
      scene_id: '30003',
      actor_name: '李四',
    });

    const group = buildIcqqSystemRequestRow({
      type: 'add', user_id: 40004, group_id: 888, flag: 'flag-10', time: 1_700_000_000,
    }, 'group', base);
    expect(group).toMatchObject({
      platform_request_id: 'flag-10',
      type: 'group',
      scene_type: 'group',
      scene_id: '888',
      sub_type: 'add',
    });
  });
});

describe('icqq.endpoint inbox wiring', () => {
  it('records request events and publishes endpoint:request', async () => {
    const hooks = createHooks();
    const endpoint = await startEndpoint({ inbox: hooks });
    try {
      (endpoint as any).emit('request.friend.add', {
        post_type: 'request',
        request_type: 'friend',
        user_id: 20002,
        nickname: '张三',
        comment: '加个好友',
        flag: 'flag-1',
        time: 1_700_000_000,
      });
      await flush();
      expect(hooks.requests).toHaveLength(1);
      expect(hooks.requests[0]).toMatchObject({
        adapter: 'icqq',
        endpoint_id: '10001',
        platform_request_id: 'flag-1',
        type: 'friend',
      });
      expect(hooks.published).toEqual([
        { type: 'endpoint:request', data: hooks.requests[0] },
      ]);

      (endpoint as any).emit('request.friend.add', {
        post_type: 'request',
        request_type: 'friend',
        user_id: 20002,
        flag: 'flag-1',
        time: 1_700_000_000,
      });
      await flush();
      expect(hooks.requests).toHaveLength(1);
    } finally {
      await endpoint.stop();
    }
  });

  it('records notice events and publishes endpoint:notice', async () => {
    const hooks = createHooks();
    const endpoint = await startEndpoint({ inbox: hooks });
    (endpoint as any).emit('notice.group.increase', {
      post_type: 'notice',
      notice_type: 'group',
      sub_type: 'increase',
      group_id: 888,
      user_id: 20002,
      operator_id: 20002,
      time: 1_700_000_000,
    });
    await flush();
    expect(hooks.notices).toHaveLength(1);
    expect(hooks.notices[0]).toMatchObject({
      adapter: 'icqq',
      endpoint_id: '10001',
      type: 'group',
      scene_id: '888',
    });
    expect(hooks.published).toEqual([
      { type: 'endpoint:notice', data: hooks.notices[0] },
    ]);
    await endpoint.stop();
  });

  it('pulls GET_SYSTEM_MSG once at startup for offline requests', async () => {
    const hooks = createHooks();
    const endpoint = await startEndpoint({
      systemMsg: [
        { type: 'friend', user_id: 30003, nickname: '李四', flag: 'flag-9', time: 1_700_000_000 } as SystemMessage,
        { type: 'invite', user_id: 40004, group_id: 888, flag: 'flag-10', time: 1_700_000_000 } as SystemMessage,
      ],
      inbox: hooks,
    });
    await flush();
    expect(endpoint.getSystemMsg).toHaveBeenCalled();
    expect(hooks.requests.map((row) => row.platform_request_id)).toEqual([
      'flag-9', 'flag-10',
    ]);
    expect(hooks.published.map((p) => p.type)).toEqual([
      'endpoint:request', 'endpoint:request',
    ]);
    await endpoint.stop();
  });

  it('ignores request/notice payloads when no inbox hooks are injected', async () => {
    const endpoint = await startEndpoint();
    expect(() => (endpoint as any).emit('request.friend.add', {
      post_type: 'request', request_type: 'friend', user_id: 1, flag: 'f', time: 1,
    })).not.toThrow();
    await flush();
    await endpoint.stop();
  });
});
