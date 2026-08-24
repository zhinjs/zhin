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
    vi.mocked(endpoint.client.getSystemMsg).mockResolvedValue(options.systemMsg as never);
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

describe('icqq.endpoint side-event wiring (no inbox dual-write)', () => {
  it('dispatches request events to SideEventGateway', async () => {
    const sideEvents = createSideEvents();
    const endpoint = await startEndpoint({ sideEvents });
    try {
      endpoint.client.emit('request.friend.add', {
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
        $type: 'request',
        $id: 'flag-1',
        $endpoint: '10001',
      });

      endpoint.client.emit('request.friend.add', {
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
    endpoint.client.emit('notice.group.increase', {
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
      $type: 'notice',
      $endpoint: '10001',
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
    expect(endpoint.client.getSystemMsg).toHaveBeenCalled();
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
    expect(() => endpoint.client.emit('request.friend.add', {
      post_type: 'request', request_type: 'friend', user_id: 1, flag: 'f', time: 1,
    })).not.toThrow();
    await flush();
    await endpoint.stop();
  });
});
