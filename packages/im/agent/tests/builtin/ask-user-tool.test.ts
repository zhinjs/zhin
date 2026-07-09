import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plugin, Message, SendOptions, Adapter } from '@zhin.js/core';
import {
  AskUserBuiltinTool,
  askOwnerViaPrivateWithParent,
  buildSensitiveOwnerQuestionText,
} from '../../src/builtin/ask-user-tool.js';
import { AskUserSessionService } from '../../src/builtin/ask-user-session-service.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

function messageWithReply(
  overrides: Parameters<typeof mockCommMessage>[0] = {},
): Message {
  const msg = mockCommMessage(overrides) as Message & { $reply?: ReturnType<typeof vi.fn> };
  msg.$reply = vi.fn().mockResolvedValue('prompt-msg-1');
  return msg;
}

describe('buildSensitiveOwnerQuestionText', () => {
  it('群来源包含 scene 与 sender', () => {
    const msg = mockCommMessage({ scope: 'group', sceneId: '129043431', senderId: 'u1' });
    const text = buildSensitiveOwnerQuestionText(msg, '执行 bash?', 'confirm');
    expect(text).toContain('group(129043431)');
    expect(text).toContain('u1');
    expect(text).toContain('输入"yes"以确认');
  });
});

describe('AskUserBuiltinTool.run', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let plugin: Plugin;
  let disposeMiddleware: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    AskUserSessionService.resetForTests();
    sendMessage = vi.fn().mockResolvedValue('msg-1');
    disposeMiddleware = vi.fn();
    const endpoints = new Map([
      ['bot1', { $config: { master: 'owner1' } }],
    ]);
    const adapterStub = { endpoints, sendMessage, emit: vi.fn() };
    plugin = {
      inject: vi.fn(() => adapterStub),
      addMiddleware: vi.fn(() => disposeMiddleware),
    } as unknown as Plugin;
    (plugin as { root: Plugin }).root = plugin;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('群聊非 sensitive 时走 Prompt，不私聊 Owner', async () => {
    const tool = new AskUserBuiltinTool(plugin);
    const msg = messageWithReply({ adapter: 'icqq', endpoint: 'bot1', scope: 'group', sceneId: 'g1', senderId: 'u1' });
    const runPromise = tool.run({ question: '请补充细节', timeout: 1 }, msg);

    await vi.waitFor(() => expect((plugin.addMiddleware as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));
    const mw = (plugin.addMiddleware as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as (
      m: Message,
      next: () => Promise<void>,
    ) => Promise<void>;
    await mw({
      ...msg,
      $raw: '补充内容',
    } as Message, vi.fn());

    await expect(runPromise).resolves.toBe('补充内容');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(msg.$reply).toHaveBeenCalled();
  });

  it('群聊 sensitive 时私聊 Owner（不经过 Prompt）', async () => {
    const tool = new AskUserBuiltinTool(plugin);
    const msg = messageWithReply({ adapter: 'icqq', endpoint: 'bot1', scope: 'group', sceneId: 'g1' });
    const runPromise = tool.run({ question: '执行 rm?', type: 'confirm', sensitive: true, timeout: 1 }, msg);

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const opts = sendMessage.mock.calls[0]![0] as SendOptions;
    expect(opts.parent).toEqual({ type: 'group', id: 'g1' });
    expect(msg.$reply).not.toHaveBeenCalled();

    await vi.waitFor(() => expect((plugin.addMiddleware as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));
    const mw = (plugin.addMiddleware as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as (
      m: Message,
      next: () => Promise<void>,
    ) => Promise<void>;
    await mw({
      $channel: { type: 'private', id: 'owner1' },
      $sender: { id: 'owner1' },
      $endpoint: 'bot1',
      $raw: 'yes',
    } as Message, vi.fn());

    await expect(runPromise).resolves.toBe('yes');
  });

  it('私聊 master 时走 Prompt', async () => {
    const tool = new AskUserBuiltinTool(plugin);
    const msg = messageWithReply({
      adapter: 'icqq',
      endpoint: 'bot1',
      scope: 'private',
      senderId: 'owner1',
      sceneId: 'owner1',
    });
    const runPromise = tool.run({ question: '确认?', type: 'confirm', timeout: 1 }, msg);

    await vi.waitFor(() => expect((plugin.addMiddleware as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));
    const mw = (plugin.addMiddleware as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as (
      m: Message,
      next: () => Promise<void>,
    ) => Promise<void>;
    await mw({ ...msg, $raw: 'yes' } as Message, vi.fn());

    await expect(runPromise).resolves.toBe('yes');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sensitive 无 master 时报错', async () => {
    const endpoints = new Map([['bot1', { $config: {} }]]);
    (plugin.inject as ReturnType<typeof vi.fn>).mockReturnValue({ endpoints, sendMessage });
    const tool = new AskUserBuiltinTool(plugin);
    const msg = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', scope: 'group', sceneId: 'g1' });
    const out = await tool.run({ question: 'secret', sensitive: true }, msg);
    expect(out).toContain('未配置 master');
  });
});

describe('askOwnerViaPrivateWithParent', () => {
  beforeEach(() => {
    AskUserSessionService.resetForTests();
  });

  it('sendMessage 携带 parent.group', async () => {
    const sendMessage = vi.fn().mockResolvedValue('sent-1');
    const addMiddleware = vi.fn(() => vi.fn());
    const plugin = {
      addMiddleware,
    } as unknown as Plugin;
    (plugin as { root: Plugin }).root = plugin;

    const msg = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', scope: 'group', sceneId: 'g99' });
    const runPromise = askOwnerViaPrivateWithParent(
      plugin,
      msg,
      { question: 'ok?', type: 'confirm' },
      'confirm',
      5000,
      'owner1',
      { sendMessage } as unknown as Adapter,
    );

    expect(sendMessage).toHaveBeenCalledOnce();
    const opts = sendMessage.mock.calls[0]![0] as SendOptions;
    expect(opts.type).toBe('private');
    expect(opts.id).toBe('owner1');
    expect(opts.parent).toEqual({ type: 'group', id: 'g99' });

    await vi.waitFor(() => expect(addMiddleware.mock.calls.length).toBeGreaterThan(0));
    const mw = addMiddleware.mock.calls.at(-1)![0] as (
      m: Message,
      next: () => Promise<void>,
    ) => Promise<void>;
    await mw({
      $channel: { type: 'private', id: 'owner1' },
      $sender: { id: 'owner1' },
      $endpoint: 'bot1',
      $raw: 'yes',
    } as Message, vi.fn());

    await expect(runPromise).resolves.toBe('yes');
  });
});
