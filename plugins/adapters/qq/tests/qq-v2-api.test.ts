import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { qqFixture } from './fixture.js';
import { QqWebsocketEndpoint } from '../src/endpoint.js';
import { resolveQqConfig } from '../src/protocol.js';
import { formatOutbound } from '../src/outbound.js';
import { QqActiveMessageGate, QqPassiveReplyLedger } from '../src/passive-reply.js';
import {
  addQqGroupBlacklist,
  approveQqGroupJoinRequest,
  declineQqGroupJoinRequest,
  listQqGroupBlacklist,
  listQqGroupJoinRequests,
  removeQqGroupBlacklist,
  type QqGroupApi,
} from '../src/group-admin.js';
import { sendQqMessages } from '../src/qq-send.js';
import { QQ_AT_EVERYONE } from '../src/qq-v2.js';
import type { QqBotTransport } from '../src/ws.js';

const GROUP = '30584554AA2BF4E72BD3B8F27A70339D';
const MEMBER = 'FE003FAF76C4817251FDC128A16753BB';
const CARD = {
  type: 'tuwen',
  content: {
    title: '今日天气预报',
    description: '深圳 多云转晴',
    url: 'https://example.com/weather',
    pic_url: 'https://example.com/weather.png',
  },
};

interface Call { method: 'GET' | 'POST'; url: string; body?: unknown; params?: unknown }

function http(response: unknown): { api: QqGroupApi; calls: Call[] } {
  const calls: Call[] = [];
  const request = {
    get: vi.fn(async (url: string, config?: { params?: unknown }) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return { data: response };
    }),
    post: vi.fn(async (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return { data: response };
    }),
  };
  return { api: { request }, calls };
}

function conversation(kind: 'private' | 'group' | 'channel') {
  return { endpoint: { id: 'bot', adapter: 'qq' }, kind, id: kind === 'group' ? GROUP : 'USER' };
}

async function deliver(kind: 'private' | 'group' | 'channel', payload: unknown, source?: { id: string }) {
  const calls: Call[] = [];
  const post = vi.fn(async (url: string, body?: unknown) => {
    calls.push({ method: 'POST', url, body });
    return { data: { id: 'card-1', timestamp: '2026-10-28T00:00:00+08:00' } };
  });
  const sent: unknown[] = [];
  const bot = {
    request: { post, get: vi.fn() },
    sendPrivateMessage: vi.fn(async (_id: string, message: unknown) => { sent.push(message); return { id: 'sdk' }; }),
    sendGroupMessage: vi.fn(async (_id: string, message: unknown) => { sent.push(message); return { id: 'sdk' }; }),
    sendGuildMessage: vi.fn(async (_id: string, message: unknown) => { sent.push(message); return { id: 'sdk' }; }),
  };
  const ledger = new QqPassiveReplyLedger(() => 1_700_000_000_000);
  if (source) ledger.record(kind, conversation(kind).id, source, 1_700_000_000_000);
  const result = await sendQqMessages({
    bot: bot as unknown as QqBotTransport,
    ledger,
    activeGate: new QqActiveMessageGate(),
    log: () => undefined,
  }, { conversation: conversation(kind), messages: [formatOutbound(payload)] });
  return { calls, sent, result, bot };
}

describe('QQ 图文卡片与 @全体成员', () => {
  it('把图文卡片编码为 msg_type=8，并按官方路径 POST', async () => {
    const { calls, bot } = await deliver('group', [
      { type: 'reply', data: { message_id: 'quoted' } },
      { type: 'card', data: CARD },
    ], { id: 'passive-1' });
    expect(bot.sendGroupMessage).not.toHaveBeenCalled();
    expect(calls).toEqual([{
      method: 'POST',
      url: `/v2/groups/${GROUP}/messages`,
      body: {
        msg_type: 8,
        card: CARD,
        msg_id: 'passive-1',
        msg_seq: 1,
        message_reference: { message_id: 'quoted' },
      },
    }]);
  });

  it('单聊图文卡片走 /v2/users/{user_openid}/messages', async () => {
    const { calls } = await deliver('private', [{ type: 'card', data: CARD }]);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/users/USER/messages', body: { msg_type: 8, card: CARD } });
  });

  it('四字段齐全的 share 转成同一张图文卡片', async () => {
    const { calls } = await deliver('group', [{
      type: 'share',
      data: { title: CARD.content.title, description: CARD.content.description, url: CARD.content.url, image: CARD.content.pic_url },
    }]);
    expect(calls[0]?.body).toMatchObject({ msg_type: 8, card: CARD });
  });

  it('拒绝缺字段、非 https、超长标题，以及频道里的卡片', async () => {
    expect(() => formatOutbound([{ type: 'card', data: { type: 'tuwen', content: { ...CARD.content, url: 'http://example.com/a' } } }]))
      .toThrow(expect.objectContaining({ disposition: 'not_sent' }));
    expect(() => formatOutbound([{ type: 'card', data: { type: 'tuwen', content: { ...CARD.content, title: '标题'.repeat(30) } } }]))
      .toThrow(/title/);
    expect(() => formatOutbound([{ type: 'text', data: { text: '前文' } }, { type: 'card', data: CARD }]))
      .toThrow(/不能与其他正文/);
    await expect(deliver('channel', [{ type: 'card', data: CARD }])).rejects.toThrow(/只支持群聊和单聊/);
  });

  it('纯文本 @全体成员编码为 at all，Markdown 里把标记写进 markdown.content', () => {
    expect(formatOutbound([
      { type: 'text', data: { text: '通知' } },
      { type: 'mention', data: { target: 'all' } },
    ])).toEqual(['通知', { type: 'at', data: { user_id: 'all' } }]);
    expect(formatOutbound([
      { type: 'markdown', data: { content: '**标题**' } },
      { type: 'mention', data: { target: 'all' } },
    ])).toEqual({ type: 'markdown', data: { content: `**标题**\n\n${QQ_AT_EVERYONE}` } });
    expect(formatOutbound([
      { type: 'markdown', data: { content: 'hello' } },
      { type: 'mention', data: { target: MEMBER } },
    ])).toEqual({ type: 'markdown', data: { content: `hello\n\n<qqbot-at-user id="${MEMBER}" />` } });
  });

  it('模板 markdown 没有 content，拒绝把 @ 写进 content', () => {
    expect(() => formatOutbound([
      { type: 'markdown', data: { custom_template_id: 'tpl', params: [] } },
      { type: 'mention', data: { target: 'all' } },
    ])).toThrow(/模板 markdown/);
  });

  it('事件回复的图文卡片带 event_id，不写成 message_reference', async () => {
    const { calls } = await deliver('group', [
      { type: 'reply', data: { event_id: 'evt-1' } },
      { type: 'card', data: CARD },
    ]);
    expect(calls[0]?.body).toMatchObject({ msg_type: 8, event_id: 'evt-1' });
    expect(calls[0]?.body).not.toHaveProperty('message_reference');
  });

  it('不在单聊发送 @全体成员', async () => {
    await expect(deliver('private', [
      { type: 'text', data: { text: '通知' } },
      { type: 'mention', data: { target: 'all' } },
    ])).rejects.toThrow(/只支持群聊和文字子频道/);
  });

  it('SDK 把 @全体成员写进群消息 content，请求路径是 /v2/groups/{id}/messages', async () => {
    const require = createRequire(import.meta.url);
    const { MessageBuilder } = require(join(dirname(require.resolve('qq-official-bot/package.json')), 'lib/message/builder.js')) as {
      MessageBuilder: new (appid: string, isGuild: boolean, source?: { id?: string }, msgSeq?: number) => {
        build(message: unknown): Promise<{ messagePayload: { content?: string; msg_type?: number; markdown?: { content?: string } } }>;
      };
    };
    const built = await new MessageBuilder('app', false).build(formatOutbound([
      { type: 'text', data: { text: '通知' } },
      { type: 'mention', data: { target: 'all' } },
    ]));
    expect(built.messagePayload.content).toContain(QQ_AT_EVERYONE);
    expect(built.messagePayload.markdown).toBeUndefined();
    const markdown = await new MessageBuilder('app', false).build(formatOutbound([
      { type: 'markdown', data: { content: '**标题**' } },
      { type: 'mention', data: { target: 'all' } },
    ]));
    expect(markdown.messagePayload.markdown?.content).toContain(QQ_AT_EVERYONE);
    expect(markdown.messagePayload.content ?? '').not.toContain(QQ_AT_EVERYONE);
  });
});

describe('QQ 入群审批与群黑名单', () => {
  const page = {
    list: [{
      join_request_id: 'R1',
      member_openid: MEMBER,
      username: '小光',
      apply_at: '2026-08-05T14:19:09+08:00',
      apply_source: 'self_apply',
      invited_by: '',
      bot: false,
      risk_tips: '',
      verify_info: { method: 'verify_message', verify_message: '你好', review_qa_list: [] },
    }],
    next_cursor: '',
  };

  it('拉取入群申请：无分页参数时不带 query，传入 limit 时放在 query', async () => {
    const first = http(page);
    await expect(listQqGroupJoinRequests(first.api, { groupId: GROUP })).resolves.toMatchObject({
      nextCursor: '',
      requests: [{ joinRequestId: 'R1', memberId: MEMBER, username: '小光', verifyMessage: '你好', bot: false }],
    });
    expect(first.calls).toEqual([{ method: 'GET', url: `/v2/groups/${GROUP}/join_request_list` }]);

    const second = http(page);
    await listQqGroupJoinRequests(second.api, { groupId: GROUP, cursor: '1785767153250497', limit: 20 });
    expect(second.calls[0]).toEqual({
      method: 'GET',
      url: `/v2/groups/${GROUP}/join_request_list`,
      params: { cursor: '1785767153250497', limit: 20 },
    });
    await expect(listQqGroupJoinRequests(second.api, { groupId: GROUP, limit: 51 })).rejects.toThrow(RangeError);
  });

  it('审批入群申请 POST 官方路径和请求体', async () => {
    const approved = http({});
    await approveQqGroupJoinRequest(approved.api, { groupId: GROUP, userId: MEMBER, joinRequestId: 'R1' });
    expect(approved.calls).toEqual([{
      method: 'POST',
      url: `/v2/groups/${GROUP}/approval_join_request/${MEMBER}`,
      body: { op: 'approve', join_request_id: 'R1' },
    }]);

    const declined = http({});
    await declineQqGroupJoinRequest(declined.api, {
      groupId: GROUP, userId: MEMBER, joinRequestId: 'R1', reason: '不符合入群要求', addToBlacklist: true,
    });
    expect(declined.calls[0]?.body).toEqual({
      op: 'decline',
      join_request_id: 'R1',
      reject_reason: '不符合入群要求',
      add_to_member_blacklist: true,
    });
    await expect(approveQqGroupJoinRequest(approved.api, {
      groupId: GROUP, userId: MEMBER, joinRequestId: 'R1',
    })).resolves.toBeUndefined();
  });

  it('查询和增删群黑名单', async () => {
    const listed = http({
      users: [{ member_openid: MEMBER, username: '阳光少年', banned_at: '2025-07-01T10:30:00+08:00', bot: false, union_openid: 'U' }],
      next_cursor: '',
    });
    await expect(listQqGroupBlacklist(listed.api, { groupId: GROUP })).resolves.toEqual({
      users: [{ userId: MEMBER, username: '阳光少年', bannedAt: '2025-07-01T10:30:00+08:00', bot: false, unionId: 'U' }],
      nextCursor: '',
    });
    expect(listed.calls).toEqual([{ method: 'GET', url: `/v2/groups/${GROUP}/member_blacklist` }]);

    const added = http({ fail_openids: [] });
    await expect(addQqGroupBlacklist(added.api, { groupId: GROUP, userIds: [MEMBER] })).resolves.toEqual({ failedUserIds: [] });
    expect(added.calls[0]).toEqual({
      method: 'POST',
      url: `/v2/groups/${GROUP}/member_blacklist`,
      body: { op: 'add', member_openids: [MEMBER] },
    });

    const removed = http({ fail_openids: [MEMBER] });
    await expect(removeQqGroupBlacklist(removed.api, { groupId: GROUP, userIds: [MEMBER] })).resolves.toEqual({ failedUserIds: [MEMBER] });
    expect(removed.calls[0]?.body).toEqual({ op: 'del', member_openids: [MEMBER] });
    await expect(addQqGroupBlacklist(added.api, { groupId: GROUP, userIds: [] })).rejects.toThrow(RangeError);
  });

  it('取消进行中的请求时把同一个 signal 交给 HTTP 客户端', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const request = {
      get: vi.fn(async (_url: string, config?: { signal?: AbortSignal }) => {
        seen = config?.signal;
        await new Promise((_resolve, reject) => {
          config?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }),
      post: vi.fn(),
    };
    const pending = listQqGroupJoinRequests({ request }, { groupId: GROUP, signal: controller.signal });
    await vi.waitFor(() => expect(seen).toBe(controller.signal));
    controller.abort();
    await expect(pending).rejects.toBeTruthy();
  });

  it('endpoint.management 调到官方路径', async () => {
    const endpoint = await qqFixture(() => new QqWebsocketEndpoint({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'qq'),
      config: resolveQqConfig({ id: 'test-qq-bot', appid: 'app-1', secret: 'secret-1', mode: 'websocket' }) as ReturnType<typeof resolveQqConfig> & { mode: 'websocket' },
    }), () => ({}));
    const get = vi.spyOn(endpoint.endpoint.request, 'get').mockResolvedValue({ data: { list: [], users: [], next_cursor: '' } } as never);
    try {
      await endpoint.start();
      await endpoint.management.listGroupJoinRequests?.({ groupId: GROUP });
      await endpoint.management.listGroupBlacklist?.({ groupId: GROUP });
      expect(get.mock.calls.map(call => call[0])).toEqual([
        `/v2/groups/${GROUP}/join_request_list`,
        `/v2/groups/${GROUP}/member_blacklist`,
      ]);
    } finally {
      get.mockRestore();
      await endpoint.stop();
    }
  });
});
