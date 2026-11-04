import botKindReply from '../middlewares/bot-kind-reply/index.js';
import { createQqRuntimeState, qqRuntimeStateToken } from '../src/qq-runtime-state.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { AdapterManagementError } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import definition from '../adapters/qq/index.js';
import listCommand from '../commands/qq/endpoint/list/index.js';
import removeCommand from '../commands/qq/endpoint/remove/[id]/index.js';
import type { QqEndpointSavePort } from '../src/qq-endpoint-write.js';
import type { QqBindCallbacks } from '../src/qq-bind-flow.js';
import {
  completeQqPendingBotKind,
  extractQqCommandReply,
  isQqEndpointOperator,
  runQqEndpointAdd,
  runQqEndpointCancel,
} from '../commands/qq/endpoint/definition.js';

const { startQqBindFlowMock } = vi.hoisted(() => ({
  startQqBindFlowMock: vi.fn(),
}));

vi.mock('../src/qq-bind-flow.js', () => ({
  startQqBindFlow: startQqBindFlowMock,
}));

async function fixture() {
  const repository = new MemoryDesiredRepository();
  const harness = await createAdapterHarness(definition, { id: 'deferred', appid: 'synthetic-placeholder', secret: 'synthetic-placeholder' }, { name: 'qq', repository });
  await harness.start(); harness.open(); const revision = harness.adapter.revision;
  const save: QqEndpointSavePort = vi.fn(config => harness.adapter.add(revision, { endpointId: config.id, config: { ...config } }, { waitForExecution: false }));
  return { harness, repository, save, stored: () => repository.snapshot?.endpoints.map(row => row.config) ?? [] };
}
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); startQqBindFlowMock.mockReset(); });
afterEach(async () => { await f.harness.stop(); });
function commandContext(state: ReturnType<typeof createQqRuntimeState>, id?: string) {
  return { owner: rootPluginId(), generation: 1, project: () => f.harness.index, config: {}, input: undefined, params: id ? { id } : {}, args: [],
    use: (token: unknown) => { if (token === qqRuntimeStateToken) return state; throw new Error('No file/env account writer'); } } as never;
}

function lastCallbacks(): QqBindCallbacks {
  return startQqBindFlowMock.mock.calls.at(-1)![0] as QqBindCallbacks;
}

function collectReplies(): { replies: string[]; reply: (text: string) => Promise<void> } {
  const replies: string[] = [];
  return {
    replies,
    reply: async (text: string) => {
      replies.push(text);
    },
  };
}

describe('extractQqCommandReply', () => {
  it('从消息 input 提取 $reply；非消息输入降级 no-op', async () => {
    const calls: string[] = [];
    const message = { $reply: async (content: string) => void calls.push(content) };

    const reply = extractQqCommandReply(message);
    await reply('hello');
    expect(calls).toEqual(['hello']);

    await expect(extractQqCommandReply(undefined)('x')).resolves.toBeUndefined();
    await expect(extractQqCommandReply({})('x')).resolves.toBeUndefined();
  });
});

describe('isQqEndpointOperator', () => {
  const message = (sender: string) => ({ sender: { id: sender } });

  it('未配置 master 时放行（首个绑定者即 owner）', () => {
    expect(isQqEndpointOperator({}, message('alice'))).toBe(true);
    expect(isQqEndpointOperator({ endpoints: [{ id: 'a' }] }, message('alice'))).toBe(true);
  });

  it('顶层 master 命中放行，不命中拒绝', () => {
    const config = { master: '1659488338' };
    expect(isQqEndpointOperator(config, message('1659488338'))).toBe(true);
    expect(isQqEndpointOperator(config, message('8596238'))).toBe(false);
  });

  it('endpoints[i].master 逐项命中同样放行', () => {
    const config = { endpoints: [{ id: 'a', master: 8596238 }] };
    expect(isQqEndpointOperator(config, message('8596238'))).toBe(true);
    expect(isQqEndpointOperator(config, message('111'))).toBe(false);
  });

  it('notify.id 作为通知目标也可执行 endpoint 管理', () => {
    const config = { master: '1659488338', notify: { id: 'openid-master' } };
    expect(isQqEndpointOperator(config, message('openid-master'))).toBe(true);
    expect(isQqEndpointOperator(config, message('other'))).toBe(false);
  });

  it('sender 缺失时拒绝（已配置 master）', () => {
    expect(isQqEndpointOperator({ master: '1' }, {})).toBe(false);
    expect(isQqEndpointOperator({ master: '1' }, undefined)).toBe(false);
  });
});

describe('runQqEndpointAdd', () => {
  const chatInput = {
    conversation: {
      endpoint: { adapter: 'sandbox', id: 'host' },
      kind: 'private' as const,
      id: 'u1',
    },
    sender: { id: 'u1' },
  };

  it('二维码就绪后 resolve 链接；扫码成功暂存凭据并追问公域/私域（不写文件）', async () => {
    const state = createQqRuntimeState();
    const stop = vi.fn();
    startQqBindFlowMock.mockReturnValue(stop);
    const { replies, reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'newbot', reply, f.save, chatInput);
    expect(state.bindFlow).not.toBeNull();

    lastCallbacks().onQrDisplayed?.('https://q.qq.com/connect?task_id=t1');
    const firstReply = await firstReplyPromise;
    expect(firstReply).toContain('https://q.qq.com/connect?task_id=t1');

    await lastCallbacks().onSuccess([{ appId: '102000009', appSecret: 'sec-9' }]);

    expect(state.bindFlow).toBeNull();
    expect(state.pendingBotKind).toMatchObject({
      endpointId: 'newbot',
      appId: '102000009',
      appSecret: 'sec-9',
    });
    expect(f.repository.writes).toHaveLength(0);
    expect(state.pendingBotKind?.save).toBe(f.save);
    expect(replies.some((text) => text.includes('扫码成功') && text.includes('public'))).toBe(true);
  });

  it('用户选择 private 后通过捕获的CAS一次保存未启动账号', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'newbot', reply, f.save, chatInput);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;
    await lastCallbacks().onSuccess([{ appId: '102000009', appSecret: 'sec-9' }]);

    const text = await completeQqPendingBotKind(state.pendingBotKind!, 'private');
    state.pendingBotKind = null;

    expect(text).toContain('botKind=private');
    expect(text).toContain('GUILD_MESSAGES');
    expect(f.repository.writes).toHaveLength(1);
    expect(f.harness.adapter.list()[0]?.desiredEnabled).toBe(false); expect(f.harness.endpoint).toBeUndefined();
    expect(f.stored()).toEqual([
      expect.objectContaining({
        id: 'newbot', appid: '102000009', secret: 'sec-9',
        botKind: 'private',
        intents: expect.arrayContaining(['GUILD_MESSAGES']),
      }),
    ]);
  });

  it('无会话上下文时直接按 public 一次性写入', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { replies, reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'newbot', reply, f.save);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;
    await lastCallbacks().onSuccess([{ appId: '102000009', appSecret: 'sec-9' }]);

    expect(state.pendingBotKind).toBeNull();
    expect(f.repository.writes).toHaveLength(1);
    expect(f.stored()[0]?.appid).toBe('102000009');
    expect(f.harness.adapter.list()[0]?.desiredEnabled).toBe(false);
    expect(f.stored()[0]).toMatchObject({ botKind: 'public' });
    expect(replies.some((text) => text.includes('无法交互'))).toBe(true);
  });

  it('未指定 name 时使用 appId 作为 endpoint 名', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, undefined, reply, f.save, chatInput);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;
    await lastCallbacks().onSuccess([{ appId: '102000010', appSecret: 's' }]);

    expect(f.repository.writes).toHaveLength(0);
    expect(state.pendingBotKind?.endpointId).toBe('102000010');
  });

  it('已有进行中的绑定时拒绝并发', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const pending = runQqEndpointAdd(state, 'a', reply, f.save, chatInput);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await pending;

    const second = await runQqEndpointAdd(state, 'b', reply, f.save, chatInput);
    expect(second).toContain('已有进行中');
    expect(startQqBindFlowMock).toHaveBeenCalledTimes(1);
  });

  it('绑定失败时回复失败原因并释放单例', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { replies, reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'a', reply, f.save, chatInput);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;

    lastCallbacks().onFailure(new Error('network down'));

    expect(state.bindFlow).toBeNull();
    expect(replies.some((text) => text.includes('network down'))).toBe(true);
  });

  it('后续 reply 抛 Message reply scope has ended 时不让进程崩溃', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const reply = async () => {
      throw new Error('Message reply scope has ended');
    };

    const firstReplyPromise = runQqEndpointAdd(state, 'a', reply, f.save, chatInput);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;

    await expect(
      lastCallbacks().onSuccess?.([{ appId: '102000011', appSecret: 's' }]),
    ).resolves.toBeUndefined();
    expect(state.bindFlow).toBeNull();
    expect(state.pendingBotKind).not.toBeNull();
  });

  it('二维码尚未就绪就失败时，失败原因作为首条回复', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'a', reply, f.save, chatInput);
    lastCallbacks().onFailure(new Error('获取绑定任务失败: boom'));

    await expect(firstReplyPromise).resolves.toContain('获取绑定任务失败');
    expect(state.bindFlow).toBeNull();
  });
});

describe('runQqEndpointCancel', () => {
  it('有进行中流程时 stop 并释放单例', () => {
    const state = createQqRuntimeState();
    const stop = vi.fn();
    state.bindFlow = { id: 'a', stop };

    expect(runQqEndpointCancel(state)).toContain('已取消');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(state.bindFlow).toBeNull();
  });

  it('可取消待确认的公域/私域选择', () => {
    const state = createQqRuntimeState();
    state.pendingBotKind = {
      endpointId: 'x',
      appId: '1',
      appSecret: '2',
      sessionKey: 'k', save: f.save,
    };

    expect(runQqEndpointCancel(state)).toContain('尚未写入');
    expect(state.pendingBotKind).toBeNull();
  });

  it('无流程时提示', () => {
    const state = createQqRuntimeState();
    expect(runQqEndpointCancel(state)).toContain('没有进行中');
  });
});

describe('QQ list/remove use the actual owning runtime commands', () => {
  it('removes an existing saved account without restarting or touching a file writer', async () => {
    await f.save({ id: 'a', appid: 'synthetic-app', secret: 'synthetic-secret' }); const state = createQqRuntimeState();
    const text = await removeCommand.execute(commandContext(state, 'a')); expect(text).toContain('删除配置已保存'); expect(text).not.toContain('重启'); expect(f.stored()).toEqual([]); expect(f.repository.writes).toHaveLength(2);
  });
  it('keeps a missing account distinct from persistence failure', async () => {
    await expect(removeCommand.execute(commandContext(createQqRuntimeState(), 'ghost'))).resolves.toContain('不存在'); expect(f.repository.writes).toHaveLength(0);
  });
  it('lists actual persisted accounts without a second running map or secret exposure', async () => {
    await f.save({ id: 'conf-bot', appid: 'synthetic-app', secret: 'synthetic-secret' });
    const text = await listCommand.execute(commandContext(createQqRuntimeState())); expect(text).toContain('conf-bot'); expect(text).toContain('synthetic-app'); expect(text).not.toContain('synthetic-secret'); expect(f.harness.endpoint).toBeUndefined();
  });
  it('keeps empty-directory placeholders', async () => { expect(await listCommand.execute(commandContext(createQqRuntimeState()))).toContain('（无）'); });
  it('uses only the flow’s captured verified cancel invocation in the footer', async () => {
    const state = createQqRuntimeState(); state.bindFlow = { id: 'a', stop: vi.fn(), cancelCommand: '!work qq endpoint cancel' };
    expect(await listCommand.execute(commandContext(state))).toContain('!work qq endpoint cancel');
  });
  it('keeps the pending bot-kind footer without saving or exposing its secret', async () => {
    const state = createQqRuntimeState(); state.pendingBotKind = { endpointId: 'wait-bot', appId: '1', appSecret: 'synthetic-secret', sessionKey: 'k', save: f.save };
    const text = await listCommand.execute(commandContext(state)); expect(text).toContain('wait-bot'); expect(text).toContain('公域/私域'); expect(text).not.toContain('synthetic-secret'); expect(f.repository.writes).toHaveLength(0);
  });
});


it('keeps binding language and real cancel head across follow-ups without accepting another sender or thread', async () => {
  const state = createQqRuntimeState(); startQqBindFlowMock.mockReturnValue(vi.fn());
  const { replies, reply } = collectReplies();
  const input = { sender: { id: 'alice' }, locale: 'en', conversation: { endpoint: { adapter: 'sandbox', id: 'bot' },
    kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'thread' } };
  const first = runQqEndpointAdd(state, 'english', reply, f.save, input, 'en', '!ops qq endpoint cancel', ['!ops qq endpoint cancel']);
  lastCallbacks().onQrDisplayed?.('https://example.test/synthetic-qr');
  expect(await first).toContain('Open this link');
  await lastCallbacks().onSuccess([{ appId: 'fixture-app', appSecret: 'fixture-secret' }]);
  expect(replies.at(-1)).toContain('!ops qq endpoint cancel');
  expect(state.pendingBotKind?.locale).toBe('en');
  const context = (message: object) => ({ input: { ...input, locale: 'zh-CN', content: 'private', $reply: reply, ...message },
    use(token: unknown) { if (token === qqRuntimeStateToken) return state; throw new Error('unexpected resource'); } });
  for (const other of [{ sender: { id: 'bob' } }, { conversation: { ...input.conversation, threadId: 'other' } },
    { conversation: { ...input.conversation, parent: { kind: 'channel', id: 'other' } } }]) {
    const next = vi.fn(); await botKindReply.handle(context(other) as never, next);
    expect(next).toHaveBeenCalledOnce(); expect(f.stored()).toEqual([]);
  }
  await botKindReply.handle(context({ content: '私域' }) as never, vi.fn());
  expect(replies.at(-1)).toContain('Unrecognized answer'); expect(f.stored()).toEqual([]);
  const next = vi.fn(); await botKindReply.handle(context({ content: '!ops qq endpoint cancel' }) as never, next);
  expect(next).toHaveBeenCalledOnce();
  await botKindReply.handle(context({}) as never, vi.fn());
  expect(replies.at(-1)).toContain('Saved account');
  expect(f.stored()[0]).toMatchObject({ id: 'english', botKind: 'private' });
  expect(state.pendingBotKind).toBeNull();
});


it('keeps an unresolved bot-kind choice after commit_unknown and never automatically resubmits it', async () => {
  const state = createQqRuntimeState(); startQqBindFlowMock.mockReturnValue(vi.fn()); const { reply, replies } = collectReplies();
  const input = { sender: { id: 'alice' }, conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private', id: 'alice' } };
  const started = runQqEndpointAdd(state, 'pending', reply, f.save, input); lastCallbacks().onQrDisplayed?.('https://example.test/synthetic-qr'); await started;
  await lastCallbacks().onSuccess([{ appId: 'synthetic-app', appSecret: 'synthetic-secret' }]);
  const compare = vi.spyOn(f.repository, 'compareAndSet').mockRejectedValue(new AdapterManagementError('commit_unknown', 'synthetic unknown commit outcome'));
  const context = { input: { ...input, content: 'private', $reply: reply }, use: (token: unknown) => { if (token === qqRuntimeStateToken) return state; throw new Error('No file/env writer'); } };
  await botKindReply.handle(context as never, vi.fn()); expect(state.pendingBotKind?.endpointId).toBe('pending'); expect(replies.at(-1)).toContain('unknown'); expect(compare).toHaveBeenCalledTimes(1); expect(f.stored()).toEqual([]);
});
