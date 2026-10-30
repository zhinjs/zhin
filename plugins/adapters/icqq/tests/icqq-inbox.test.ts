import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { OutboundMessageService, SideEventGateway } from '@zhin.js/core/runtime';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import { IcqqEndpoint } from '../src/endpoint.js';
import {
  buildIcqqInboxNoticeRow,
  buildIcqqInboxRequestRow,
  buildIcqqSystemRequestRow,
  icqqNoticeDedupeKey,
  isIcqqNoticePayload,
  isIcqqRequestPayload,
} from '../src/icqq-inbox.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import type { SystemMessage } from '../src/types.js';
import { LoginAssist } from '@zhin.js/core';

const adapterFeature = featureId('zhin.adapter');
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'icqq');

const baseConfig = resolveIcqqConfig({ id: '10001', autoReconnect: false });

const base = { adapter: 'icqq', endpointKey: '10001' };

function createSideEvents(): SideEventGateway & {
  notices: unknown[];
  requests: unknown[];
  systems: unknown[];
} {
  const notices: unknown[] = [];
  const requests: unknown[] = [];
  const systems: unknown[] = [];
  return {
    notices,
    requests,
    systems,
    async receiveNotice(notice) { notices.push(notice); },
    async receiveRequest(request) { requests.push(request); },
    async receiveSystem(event) { systems.push(event); },
  };
}

async function startEndpoint(
  options?: { systemMsg?: unknown[]; sideEvents?: SideEventGateway },
): Promise<IcqqEndpoint> {
  const gateway: OutboundMessageService = {
    receive: vi.fn(async () => Object.freeze({ matched: true })),
    send: vi.fn(async () => 'sent'),
  };
  const endpoint = bindTestEndpoint(new IcqqEndpoint({
    id: endpointKey,
    gateway,
    config: baseConfig,
    sideEvents: options?.sideEvents ?? createSideEvents(),
    loginAssist: new LoginAssist(null, { defaultTimeoutMs: 60_000 }),
  }), gateway, options?.sideEvents ?? createSideEvents());
  if (options?.systemMsg) {
    vi.mocked(endpoint.getSystemMsg).mockResolvedValue(options.systemMsg as never);
  }
  await endpoint.start(new AbortController().signal);
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

describe('icqqNoticeDedupeKey', () => {
  it('同一管理员先后拉两人进群（无 time）不撞键', () => {
    const base = { post_type: 'notice', notice_type: 'group', sub_type: 'increase', group_id: 888, operator_id: 1 };
    expect(icqqNoticeDedupeKey({ ...base, user_id: 2 })).not.toBe(icqqNoticeDedupeKey({ ...base, user_id: 3 }));
  });

  it('重复投递同一通知键相同', () => {
    const raw = { post_type: 'notice', notice_type: 'group', sub_type: 'increase', group_id: 888, user_id: 2, time: 1 };
    expect(icqqNoticeDedupeKey(raw)).toBe(icqqNoticeDedupeKey({ ...raw }));
  });
});

describe('icqq inbox row builders', () => {
  it('builds friend request rows', () => {
    const row = buildIcqqInboxRequestRow({
      post_type: 'request',
      request_type: 'friend',
      user_id: 20002,
      nickname: '张三',
      comment: '加个好友',
      flag: 'flag-1',
      time: 1_700_000_000,
    }, base);
    expect(row).toMatchObject({
      adapter: 'icqq',
      endpoint_id: '10001',
      platform_request_id: 'flag-1',
      type: 'friend',
      actor_id: '20002',
    });
  });

  it('builds group request rows', () => {
    const row = buildIcqqInboxRequestRow({
      post_type: 'request',
      request_type: 'group',
      sub_type: 'add',
      user_id: 20002,
      group_id: 888,
      flag: 'flag-2',
      time: 1_700_000_000,
    }, base);
    expect(row).toMatchObject({
      type: 'group',
      scene_type: 'group',
      scene_id: '888',
      platform_request_id: 'flag-2',
    });
  });

  it('rejects request rows without user or flag', () => {
    expect(buildIcqqInboxRequestRow({ post_type: 'request', flag: 'f' }, base)).toBeNull();
    expect(buildIcqqInboxRequestRow({ post_type: 'request', user_id: 1 }, base)).toBeNull();
  });

  it('builds notice rows', () => {
    const row = buildIcqqInboxNoticeRow({
      post_type: 'notice',
      notice_type: 'group',
      sub_type: 'increase',
      group_id: 888,
      user_id: 20002,
      operator_id: 20002,
      time: 1_700_000_000,
    }, base);
    expect(row).toMatchObject({
      type: 'group',
      scene_id: '888',
      actor_id: '20002',
    });
    expect(JSON.parse(String(row?.payload))).toMatchObject({ notice_type: 'group' });
  });

  it('rejects notice rows without notice_type', () => {
    expect(buildIcqqInboxNoticeRow({ post_type: 'notice', user_id: 1 }, base)).toBeNull();
  });

  it('builds system request rows', () => {
    const friend = buildIcqqSystemRequestRow({
      type: 'friend',
      user_id: 30003,
      nickname: '李四',
      flag: 'flag-9',
      time: 1_700_000_000,
    } as SystemMessage, 'friend', base);
    expect(friend).toMatchObject({
      platform_request_id: 'flag-9',
      type: 'friend',
      actor_id: '30003',
    });
    const group = buildIcqqSystemRequestRow({
      type: 'add',
      user_id: 40004,
      group_id: 888,
      flag: 'flag-10',
      time: 1_700_000_000,
    } as SystemMessage, 'group', base);
    expect(group).toMatchObject({
      platform_request_id: 'flag-10',
      type: 'group',
      scene_type: 'group',
      scene_id: '888',
      sub_type: 'add',
    });
  });
});

describe('icqq endpoint side-event wiring (no inbox dual-write)', () => {
  it('emits login and online as independent system events', async () => {
    const sideEvents = createSideEvents();
    const endpoint = await startEndpoint({ sideEvents });
    try {
      endpoint.emit('system.login.qrcode', { image: Buffer.from('test-qr') });
      endpoint.emit('system.online', {});
      await flush();
      expect(sideEvents.systems).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'system', name: 'system.login.qrcode', endpointId: '10001' }),
        expect.objectContaining({ type: 'system', name: 'system.online' }),
      ]));
      for (const system of sideEvents.systems) {
        expect(system).not.toHaveProperty('conversation');
        expect(system).not.toHaveProperty('actor');
      }
      expect(sideEvents.notices).toHaveLength(0);
      expect(sideEvents.requests).toHaveLength(0);
    } finally {
      await endpoint.stop();
    }
  });

  it('dispatches request events to SideEventGateway', async () => {
    const sideEvents = createSideEvents();
    const endpoint = await startEndpoint({ sideEvents });
    try {
      endpoint.emit('request.friend.add', {
        post_type: 'request',
        request_type: 'friend',
        user_id: 20002,
        nickname: '张三',
        comment: '加个好友',
        flag: 'flag-1',
        time: 1_700_000_000,
      });
      await flush();
      expect(sideEvents.requests).toHaveLength(1);
      expect(sideEvents.requests[0]).toMatchObject({
        type: 'request',
        id: 'flag-1',
        endpointId: '10001',
      });

      endpoint.emit('request.friend.add', {
        post_type: 'request',
        request_type: 'friend',
        user_id: 20002,
        flag: 'flag-1',
        time: 1_700_000_000,
      });
      await flush();
      expect(sideEvents.requests).toHaveLength(1);
    } finally {
      await endpoint.stop();
    }
  });

  it('dispatches notice events to SideEventGateway', async () => {
    const sideEvents = createSideEvents();
    const endpoint = await startEndpoint({ sideEvents });
    endpoint.emit('notice.group.increase', {
      post_type: 'notice',
      notice_type: 'group',
      sub_type: 'increase',
      group_id: 888,
      user_id: 20002,
      operator_id: 20002,
      time: 1_700_000_000,
    });
    await flush();
    expect(sideEvents.notices).toHaveLength(1);
    expect(sideEvents.notices[0]).toMatchObject({
      type: 'notice',
      name: 'notice.group.member_increase',
      target: { id: '20002' },
      endpointId: '10001',
    });
    await endpoint.stop();
  });

  it('pulls GET_SYSTEM_MSG at startup into SideEventGateway', async () => {
    const sideEvents = createSideEvents();
    const endpoint = await startEndpoint({
      systemMsg: [
        { type: 'friend', request_type: 'friend', user_id: 30003, nickname: '李四', flag: 'flag-9', time: 1_700_000_000 } as SystemMessage,
        { type: 'invite', user_id: 40004, group_id: 888, flag: 'flag-10', time: 1_700_000_000 } as SystemMessage,
      ],
      sideEvents,
    });
    await flush();
    expect(endpoint.getSystemMsg).toHaveBeenCalled();
    expect(sideEvents.requests).toHaveLength(2);
    await endpoint.stop();
  });

  it('management.listRequests reads live getSystemMsg', async () => {
    const endpoint = await startEndpoint({
      systemMsg: [
        { type: 'friend', request_type: 'friend', user_id: 30003, nickname: '李四', flag: 'flag-9', time: 1_700_000_000 } as SystemMessage,
      ],
    });
    const pending = await endpoint.management.listRequests!();
    expect(pending).toEqual([expect.objectContaining({
      platform_request_id: 'flag-9',
      type: 'friend',
      actor_id: '30003',
    })]);
    await endpoint.stop();
  });

  it('ignores request/notice when SideEventGateway is absent', async () => {
    const endpoint = await startEndpoint();
    expect(() => endpoint.emit('request.friend.add', {
      post_type: 'request', request_type: 'friend', user_id: 1, flag: 'f', time: 1,
    })).not.toThrow();
    await flush();
    await endpoint.stop();
  });
});

describe('icqq scene events (#996)', () => {
  it('normalizes poke on the bot, reactions, admin set, mute and join requests', async () => {
    const sideEvents = createSideEvents();
    const endpoint = await startEndpoint({ sideEvents });
    try {
      const base = { post_type: 'notice', notice_type: 'group', group_id: 888, self_id: 10001 };
      endpoint.emit('notice.group.poke', { ...base, sub_type: 'poke', operator_id: 20002, target_id: 10001, user_id: 10001, action: '戳了戳', time: 1_700_000_001 });
      endpoint.emit('notice.group.reaction', { ...base, sub_type: 'reaction', user_id: 20002, id: '76', seq: 321, set: false, time: 1_700_000_002 });
      endpoint.emit('notice.group.admin', { ...base, sub_type: 'admin', user_id: 20003, set: true, time: 1_700_000_003 });
      endpoint.emit('notice.group.ban', { ...base, sub_type: 'ban', operator_id: 20002, user_id: 10001, duration: 600, time: 1_700_000_004 });
      endpoint.emit('request.group.add', {
        post_type: 'request', request_type: 'group', sub_type: 'add', group_id: 888, user_id: 30003, comment: '想进群', flag: 'flag-996', time: 1_700_000_005,
      });
      await flush();
      expect(sideEvents.notices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'notice.group.poke', actor: expect.objectContaining({ id: '20002' }), target: expect.objectContaining({ id: '10001' }) }),
        expect.objectContaining({ name: 'notice.group.emoji_reaction', reaction: '76', operation: 'removed', messageId: 'seq:321' }),
        expect.objectContaining({ name: 'notice.group.admin_change', role: 'admin', enabled: true }),
        expect.objectContaining({ name: 'notice.group.ban', durationSeconds: 600, target: expect.objectContaining({ id: '10001' }) }),
      ]));
      expect(sideEvents.requests).toEqual([
        expect.objectContaining({ name: 'request.group.add', actor: expect.objectContaining({ id: '30003' }), comment: '想进群' }),
      ]);
    } finally {
      await endpoint.stop();
    }
  });
});
