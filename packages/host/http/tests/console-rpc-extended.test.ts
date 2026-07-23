import { describe, expect, it, vi } from 'vitest';
import {
  dispatchExtendedConsoleRpc,
  type ConsoleRpcExtendedCtx,
} from '../src/console-rpc-extended.js';
import { normalizeConsoleRpcType } from '@zhin.js/console-protocol';

function makeCtx(overrides: Partial<ConsoleRpcExtendedCtx> = {}): ConsoleRpcExtendedCtx {
  return {
    fullScope: true,
    projectRoot: '/tmp/project',
    ...overrides,
  };
}

function makeInboxDb(tables: Record<string, Record<string, unknown>[] | Error>) {
  return {
    models: {
      get(name: string) {
        const entry = tables[name];
        if (entry === undefined) return undefined;
        return {
          select: () => ({
            where: async (query: Record<string, unknown>) => {
              if (entry instanceof Error) throw entry;
              return entry.filter((row) =>
                Object.entries(query).every(([key, value]) => row[key] === value));
            },
          }),
          update: (patch: Record<string, unknown>) => ({
            where: async (query: Record<string, unknown>) => {
              if (entry instanceof Error) throw entry;
              let count = 0;
              for (const row of entry) {
                if (Object.entries(query).every(([key, value]) => row[key] === value)) {
                  Object.assign(row, patch);
                  count += 1;
                }
              }
              return count;
            },
          }),
        };
      },
    },
  };
}

describe('dispatchExtendedConsoleRpc', () => {
  it('returns undefined for unknown types so the caller can continue the chain', async () => {
    await expect(
      dispatchExtendedConsoleRpc('ping', {}, makeCtx()),
    ).resolves.toBeUndefined();
    await expect(
      dispatchExtendedConsoleRpc('endpoint.send_message', {}, makeCtx()),
    ).resolves.toBeUndefined();
  });

  describe('cron / schedule', () => {
    it('reports 未配置 when scheduleHost is missing', async () => {
      await expect(
        dispatchExtendedConsoleRpc('schedule:list', {}, makeCtx()),
      ).resolves.toEqual({ error: '调度服务未配置（scheduleHost 未挂载）' });
      await expect(
        dispatchExtendedConsoleRpc('cron:list', {}, makeCtx()),
      ).resolves.toEqual({ error: '调度服务未配置（scheduleHost 未挂载）' });
    });

    it('lists memory jobs from ScheduleHost and keeps persistent empty', async () => {
      const ctx = makeCtx({
        scheduleHost: {
          list: () => [
            { id: 'job-1', cron: '0 0 8 * * *', description: '早安' },
            { id: 'job-2', cron: '0 */5 * * * *' },
            { bogus: true },
          ],
        },
      });
      await expect(
        dispatchExtendedConsoleRpc('cron:list', {}, ctx),
      ).resolves.toEqual({
        data: {
          memory: [
            { id: 'job-1', cron: '0 0 8 * * *', description: '早安', expression: '0 0 8 * * *', running: true },
            { id: 'job-2', cron: '0 */5 * * * *', expression: '0 */5 * * * *', running: true },
          ],
          persistent: [],
        },
      });
    });

    it('cron write ops report 未接线 on full scope and are forbidden on demo scope', async () => {
      for (const type of ['cron:add', 'cron:remove', 'cron:pause', 'cron:resume']) {
        const full = await dispatchExtendedConsoleRpc(type, {}, makeCtx());
        expect(full).toHaveProperty('error');
        expect((full as { error: string }).error).toContain('未接线');

        const demo = await dispatchExtendedConsoleRpc(
          type,
          {},
          makeCtx({ fullScope: false }),
        );
        expect(demo).toEqual({
          error: `Demo scope: RPC "${normalizeConsoleRpcType(type)}" is forbidden`,
        });
      }
    });
  });

  describe('endpoint inbox reads', () => {
    const requestRows = [
      {
        id: 1,
        adapter: 'icqq',
        endpoint_id: '1234',
        platform_request_id: 'req-1',
        type: 'friend',
        scene_type: null,
        scene_id: '10001',
        sub_type: null,
        actor_id: '10001',
        actor_name: '张三',
        comment: '加个好友',
        created_at: 1000,
        resolved: 0,
        resolved_at: null,
      },
      {
        id: 2,
        adapter: 'icqq',
        endpoint_id: '1234',
        platform_request_id: 'req-2',
        type: 'group',
        scene_type: 'group',
        scene_id: '888',
        sub_type: 'invite',
        actor_id: '10002',
        actor_name: null,
        comment: null,
        created_at: 2000,
        resolved: 1,
        resolved_at: 3000,
      },
      {
        id: 3,
        adapter: 'qq',
        endpoint_id: 'bot-1',
        platform_request_id: 'req-3',
        type: 'friend',
        scene_type: null,
        scene_id: '42',
        sub_type: null,
        actor_id: '42',
        actor_name: '李四',
        comment: null,
        created_at: 1500,
        resolved: 0,
        resolved_at: null,
      },
    ];

    it('degrades to empty arrays with inboxEnabled=false when tables are missing', async () => {
      const ctx = makeCtx(); // no databaseHost at all
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:inboxRequests',
          { $adapter: 'icqq', $endpoint: '1234' },
          ctx,
        ),
      ).resolves.toEqual({ data: { requests: [], inboxEnabled: false } });

      const ctxThrow = makeCtx({
        databaseHost: makeInboxDb({ unified_inbox_notice: new Error('no such table') }),
      });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:inboxNotices',
          { $adapter: 'icqq', $endpoint: '1234' },
          ctxThrow,
        ),
      ).resolves.toEqual({ data: { notices: [], inboxEnabled: false } });
    });

    it('endpoint:requests returns only unresolved rows for the endpoint, oldest first', async () => {
      const ctx = makeCtx({
        databaseHost: makeInboxDb({ unified_inbox_request: requestRows }),
      });
      const result = await dispatchExtendedConsoleRpc(
        'endpoint:requests',
        { $adapter: 'icqq', $endpoint: '1234' },
        ctx,
      );
      expect(result).toEqual({
        data: {
          inboxEnabled: true,
          requests: [
            {
              id: 1,
              platform_request_id: 'req-1',
              platformRequestId: 'req-1',
              type: 'friend',
              scene_type: undefined,
              scene_id: '10001',
              channel_id: '10001',
              channel_type: undefined,
              channel: { id: '10001', type: undefined },
              sub_type: undefined,
              actor: { id: '10001', name: '张三' },
              sender: { id: '10001', name: '张三' },
              sender_id: '10001',
              sender_name: '张三',
              comment: '加个好友',
              created_at: 1000,
              timestamp: 1000,
              resolved: 0,
              resolved_at: undefined,
            },
          ],
        },
      });
    });

    it('endpoint:inboxRequests pages newest first with limit/offset', async () => {
      const ctx = makeCtx({
        databaseHost: makeInboxDb({ unified_inbox_request: requestRows }),
      });
      const result = await dispatchExtendedConsoleRpc(
        'endpoint:inboxRequests',
        { $adapter: 'icqq', $endpoint: '1234', $limit: 1, $offset: 1 },
        ctx,
      );
      const data = (result as { data: { requests: { id: number }[]; inboxEnabled: boolean } }).data;
      expect(data.inboxEnabled).toBe(true);
      expect(data.requests.map((r) => r.id)).toEqual([1]);
    });

    it('endpoint:inboxMessages filters by channel, parent and before cursors', async () => {
      const messageRows = [
        {
          id: 5,
          adapter: 'icqq',
          endpoint_id: '1234',
          platform_message_id: 'm5',
          channel_id: '888',
          channel_type: 'group',
          channel_name: '测试群',
          channel_parent_type: null,
          channel_parent_id: null,
          sender_id: '10001',
          sender_name: '张三',
          content: '[]',
          raw: null,
          created_at: 5000,
        },
        {
          id: 6,
          adapter: 'icqq',
          endpoint_id: '1234',
          platform_message_id: 'm6',
          channel_id: '888',
          channel_type: 'group',
          channel_name: null,
          channel_parent_type: 'guild',
          channel_parent_id: 'g-1',
          sender_id: '10002',
          sender_name: null,
          content: '[]',
          raw: null,
          created_at: 6000,
        },
      ];
      const ctx = makeCtx({
        databaseHost: makeInboxDb({ unified_inbox_message: messageRows }),
      });

      const missing = await dispatchExtendedConsoleRpc(
        'endpoint:inboxMessages',
        { $adapter: 'icqq', $endpoint: '1234' },
        ctx,
      );
      expect(missing).toEqual({
        error: '$adapter, $endpoint, $channel_id, $channel_type required',
      });

      const all = await dispatchExtendedConsoleRpc(
        'endpoint:inboxMessages',
        { $adapter: 'icqq', $endpoint: '1234', $channel_id: '888', $channel_type: 'group' },
        ctx,
      );
      const allData = (all as { data: { messages: { id: number }[] } }).data;
      expect(allData.messages.map((m) => m.id)).toEqual([6, 5]);

      const beforeCursor = await dispatchExtendedConsoleRpc(
        'endpoint:inboxMessages',
        {
          $adapter: 'icqq',
          $endpoint: '1234',
          $channel_id: '888',
          $channel_type: 'group',
          $before_id: 6,
        },
        ctx,
      );
      const cursorData = (beforeCursor as { data: { messages: { id: number }[] } }).data;
      expect(cursorData.messages.map((m) => m.id)).toEqual([5]);

      const byParent = await dispatchExtendedConsoleRpc(
        'endpoint:inboxMessages',
        {
          $adapter: 'icqq',
          $endpoint: '1234',
          $channel_id: '888',
          $channel_type: 'group',
          $parent: { type: 'guild', id: 'g-1' },
        },
        ctx,
      );
      const parentData = (byParent as {
        data: { messages: { id: number; parent?: { type: string; id: string } }[] };
      }).data;
      expect(parentData.messages.map((m) => m.id)).toEqual([6]);
      expect(parentData.messages[0]?.parent).toEqual({ type: 'guild', id: 'g-1' });
    });
  });

  describe('endpoint request actions', () => {
    it('requestConsumed / noticeConsumed report 未接线 (full) and forbidden (demo)', async () => {
      for (const type of ['endpoint:requestConsumed', 'endpoint:noticeConsumed']) {
        const full = await dispatchExtendedConsoleRpc(
          type,
          { $row_ids: [1] },
          makeCtx(),
        );
        expect((full as { error: string }).error).toContain('未接线');
        const demo = await dispatchExtendedConsoleRpc(
          type,
          { $row_ids: [1] },
          makeCtx({ fullScope: false }),
        );
        expect(demo).toEqual({
          error: `Demo scope: RPC "${normalizeConsoleRpcType(type)}" is forbidden`,
        });
      }
    });

    it('requestConsumed / noticeConsumed update consumed=1 on matching rows', async () => {
      const requestRows = [
        { id: 1, adapter: 'icqq', endpoint_id: '1234', consumed: 0, consumed_at: null },
        { id: 2, adapter: 'icqq', endpoint_id: '1234', consumed: 0, consumed_at: null },
      ];
      const noticeRows = [
        { id: 7, adapter: 'icqq', endpoint_id: '1234', consumed: 0, consumed_at: null },
      ];
      const ctx = makeCtx({
        databaseHost: makeInboxDb({
          unified_inbox_request: requestRows,
          unified_inbox_notice: noticeRows,
        }),
      });

      await expect(
        dispatchExtendedConsoleRpc('endpoint:requestConsumed', { $row_ids: [1, 2] }, ctx),
      ).resolves.toEqual({ data: { success: true, updated: 2 } });
      expect(requestRows[0]?.consumed).toBe(1);
      expect(requestRows[1]?.consumed).toBe(1);
      expect(typeof requestRows[0]?.consumed_at).toBe('number');

      await expect(
        dispatchExtendedConsoleRpc('endpoint:noticeConsumed', { $row_ids: [7] }, ctx),
      ).resolves.toEqual({ data: { success: true, updated: 1 } });
      expect(noticeRows[0]?.consumed).toBe(1);
    });

    it('requestConsumed requires $row_ids and reports 未接线 when the table is missing', async () => {
      const ctx = makeCtx({
        databaseHost: makeInboxDb({ unified_inbox_notice: [] }),
      });
      await expect(
        dispatchExtendedConsoleRpc('endpoint:requestConsumed', {}, ctx),
      ).resolves.toEqual({ error: '$row_ids required' });
      const missing = await dispatchExtendedConsoleRpc(
        'endpoint:requestConsumed',
        { $row_ids: [1] },
        ctx,
      );
      expect((missing as { error: string }).error).toContain('未接线');
    });

    it('approve/reject call endpoint methods when present', async () => {
      const approveRequest = vi.fn().mockResolvedValue(undefined);
      const rejectRequest = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        resolveEndpointManagement: () => ({ approveRequest, rejectRequest }),
      });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:requestApprove',
          { $adapter: 'icqq', $endpoint: '1234', $id: 'req-1', $remark: '欢迎' },
          ctx,
        ),
      ).resolves.toEqual({ data: { success: true } });
      expect(approveRequest).toHaveBeenCalledWith('req-1', '欢迎');

      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:requestReject',
          { $adapter: 'icqq', $endpoint: '1234', $id: 'req-2', $reason: 'spam' },
          ctx,
        ),
      ).resolves.toEqual({ data: { success: true } });
      expect(rejectRequest).toHaveBeenCalledWith('req-2', 'spam');
    });

    it('approve reports 未接线 when the endpoint lacks approval methods', async () => {
      const ctx = makeCtx({ resolveEndpointManagement: () => ({}) });
      const result = await dispatchExtendedConsoleRpc(
        'endpoint:requestApprove',
        { $adapter: 'sandbox', $endpoint: 'bot', $id: 'req-1' },
        ctx,
      );
      expect((result as { error: string }).error).toContain('请求审批未接线');
      expect((result as { error: string }).error).toContain('sandbox');
    });

    it('approve requires $adapter/$endpoint/$id and is demo-forbidden', async () => {
      const ctx = makeCtx({ resolveEndpointManagement: () => ({}) });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:requestApprove',
          { $adapter: 'icqq' },
          ctx,
        ),
      ).resolves.toEqual({ error: '$adapter, $endpoint, $id required' });

      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:requestApprove',
          { $adapter: 'icqq', $endpoint: '1', $id: 'r' },
          makeCtx({ fullScope: false }),
        ),
      ).resolves.toEqual({
        error: 'Demo scope: RPC "request.approve" is forbidden',
      });
    });
  });

  describe('endpoint social reads', () => {
    it('friends consumes the normalized endpoint management port', async () => {
      const ctx = makeCtx({
        resolveEndpointManagement: () => ({
          listFriends: async () => [
            { user_id: 10001, nickname: '张三', remark: '老张' },
            { user_id: 10002, nickname: '李四', remark: '' },
          ],
        }),
      });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:friends',
          { $adapter: 'icqq', $endpoint: '1234' },
          ctx,
        ),
      ).resolves.toEqual({
        data: {
          friends: [
            { user_id: 10001, nickname: '张三', remark: '老张' },
            { user_id: 10002, nickname: '李四', remark: '' },
          ],
          count: 2,
        },
      });
    });

    it('keeps the legacy raw-endpoint resolver as an inbound-only compatibility seam', async () => {
      const ctx = makeCtx({
        resolveEndpoint: () => ({
          getFriendList: async () => ({ data: [{ userId: 7, name: '王五' }] }),
        }),
      });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:friends',
          { adapter: 'weixin', endpointId: 'bot' },
          ctx,
        ),
      ).resolves.toEqual({ error: '当前适配器（weixin）不支持好友列表' });
    });

    it('friends/groups/channels/groupMembers report 该平台不支持 without methods', async () => {
      const ctx = makeCtx({ resolveEndpointManagement: () => ({}) });
      const base = { $adapter: 'sandbox', $endpoint: 'bot' };
      await expect(
        dispatchExtendedConsoleRpc('endpoint:friends', base, ctx),
      ).resolves.toEqual({ error: '当前适配器（sandbox）不支持好友列表' });
      await expect(
        dispatchExtendedConsoleRpc('endpoint:groups', base, ctx),
      ).resolves.toEqual({ error: '当前适配器（sandbox）不支持群列表' });
      await expect(
        dispatchExtendedConsoleRpc('endpoint:channels', base, ctx),
      ).resolves.toEqual({ error: '当前适配器（sandbox）不支持频道列表' });
      await expect(
        dispatchExtendedConsoleRpc('endpoint:groupMembers', { ...base, $group_id: '888' }, ctx),
      ).resolves.toEqual({ error: '当前适配器（sandbox）不支持群成员列表' });
    });

    it('groups consumes normalized adapter data', async () => {
      const ctx = makeCtx({
        resolveEndpointManagement: () => ({
          listGroups: async () => [{ group_id: 888, name: '测试群' }],
        }),
      });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:groups',
          { $adapter: 'icqq', $endpoint: '1234' },
          ctx,
        ),
      ).resolves.toEqual({
        data: { groups: [{ group_id: 888, name: '测试群' }], count: 1 },
      });
    });

    it('channels combines getGuilds + getChannels with guild parent', async () => {
      const ctx = makeCtx({
        resolveEndpointManagement: () => ({
          listChannels: async () => [{
            id: 'c-1',
            name: '子频道',
            parent: { type: 'guild', id: 'g-1', name: '频道一' },
          }],
        }),
      });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:channels',
          { $adapter: 'qq', $endpoint: 'bot' },
          ctx,
        ),
      ).resolves.toEqual({
        data: {
          channels: [
            { id: 'c-1', name: '子频道', parent: { type: 'guild', id: 'g-1', name: '频道一' } },
          ],
          count: 1,
        },
      });
    });

    it('groupMembers returns arrays from getGroupMemberList', async () => {
      const getGroupMemberList = vi.fn().mockResolvedValue([{ user_id: 1 }, { user_id: 2 }]);
      const ctx = makeCtx({
        resolveEndpointManagement: () => ({ listGroupMembers: getGroupMemberList }),
      });
      const result = await dispatchExtendedConsoleRpc(
        'endpoint:groupMembers',
        { $adapter: 'icqq', $endpoint: '1234', $group_id: '888' },
        ctx,
      );
      expect(result).toEqual({
        data: { members: [{ user_id: 1 }, { user_id: 2 }], count: 2 },
      });
      expect(getGroupMemberList).toHaveBeenCalledWith('888');
    });

    it('social reads are allowed in demo scope', async () => {
      const ctx = makeCtx({
        fullScope: false,
        resolveEndpointManagement: () => ({
          listFriends: async () => [{ user_id: 1, nickname: 'a', remark: '' }],
        }),
      });
      const result = await dispatchExtendedConsoleRpc(
        'endpoint:friends',
        { $adapter: 'icqq', $endpoint: '1' },
        ctx,
      );
      expect(result).toHaveProperty('data');
    });

    it('reports endpoint resolution failures', async () => {
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:friends',
          { $adapter: 'icqq', $endpoint: '1234' },
          makeCtx(),
        ),
      ).resolves.toEqual({ error: 'Endpoint registry is not configured' });

      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:friends',
          { $adapter: 'icqq', $endpoint: '9999' },
          makeCtx({ resolveEndpointManagement: () => undefined }),
        ),
      ).resolves.toEqual({ error: 'endpoint not found' });

      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:friends',
          {},
          makeCtx({ resolveEndpointManagement: () => ({}) }),
        ),
      ).resolves.toEqual({ error: '$adapter and $endpoint required' });
    });
  });

  describe('endpoint social writes', () => {
    const writeCases: Array<{
      type: string;
      data: Record<string, unknown>;
      method: string;
      expectedArgs: unknown[];
      unsupported: string;
    }> = [
      {
        type: 'endpoint:groupKick',
        data: { $adapter: 'icqq', $endpoint: '1', $group_id: '888', $user_id: '10001' },
        method: 'kickGroupMember',
        expectedArgs: ['888', '10001'],
        unsupported: '当前适配器（icqq）不支持踢出群成员',
      },
      {
        type: 'endpoint:groupMute',
        data: { $adapter: 'icqq', $endpoint: '1', $group_id: '888', $user_id: '10001' },
        method: 'muteGroupMember',
        expectedArgs: ['888', '10001', 600],
        unsupported: '当前适配器（icqq）不支持禁言群成员',
      },
      {
        type: 'endpoint:groupMute',
        data: { $adapter: 'icqq', $endpoint: '1', $group_id: '888', $user_id: '10001', $duration: 3600 },
        method: 'muteGroupMember',
        expectedArgs: ['888', '10001', 3600],
        unsupported: '当前适配器（icqq）不支持禁言群成员',
      },
      {
        type: 'endpoint:groupAdmin',
        data: { $adapter: 'icqq', $endpoint: '1', $group_id: '888', $user_id: '10001', $enable: false },
        method: 'setGroupAdmin',
        expectedArgs: ['888', '10001', false],
        unsupported: '当前适配器（icqq）不支持设置群管理员',
      },
      {
        type: 'endpoint:deleteFriend',
        data: { $adapter: 'icqq', $endpoint: '1', $user_id: '10001' },
        method: 'deleteFriend',
        expectedArgs: ['10001'],
        unsupported: '当前适配器暂不支持删除好友',
      },
    ];

    it('full scope invokes endpoint methods with normalized args', async () => {
      for (const c of writeCases) {
        const fn = vi.fn().mockResolvedValue(undefined);
        const ctx = makeCtx({ resolveEndpointManagement: () => ({ [c.method]: fn }) });
        await expect(
          dispatchExtendedConsoleRpc(c.type, c.data, ctx),
        ).resolves.toEqual({ data: { success: true } });
        expect(fn).toHaveBeenCalledWith(...c.expectedArgs);
      }
    });

    it('full scope reports 该平台不支持 when methods are absent', async () => {
      for (const c of writeCases) {
        const ctx = makeCtx({ resolveEndpointManagement: () => ({}) });
        const result = await dispatchExtendedConsoleRpc(c.type, c.data, ctx);
        expect(result).toEqual({ error: c.unsupported });
      }
    });

    it('demo scope forbids all social write ops', async () => {
      for (const c of writeCases) {
        const ctx = makeCtx({
          fullScope: false,
          resolveEndpointManagement: () => ({ [c.method]: async () => undefined }),
        });
        await expect(
          dispatchExtendedConsoleRpc(c.type, c.data, ctx),
        ).resolves.toEqual({
          error: `Demo scope: RPC "${normalizeConsoleRpcType(c.type)}" is forbidden`,
        });
      }
    });

    it('write ops validate required fields', async () => {
      const ctx = makeCtx({ resolveEndpointManagement: () => ({}) });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:groupKick',
          { $adapter: 'icqq', $endpoint: '1' },
          ctx,
        ),
      ).resolves.toEqual({ error: '$adapter, $endpoint, $group_id required' });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:groupKick',
          { $adapter: 'icqq', $endpoint: '1', $group_id: '888' },
          ctx,
        ),
      ).resolves.toEqual({ error: '$user_id required' });
      await expect(
        dispatchExtendedConsoleRpc(
          'endpoint:deleteFriend',
          { $adapter: 'icqq', $endpoint: '1' },
          ctx,
        ),
      ).resolves.toEqual({ error: '$adapter, $endpoint, $user_id required' });
    });
  });
});
