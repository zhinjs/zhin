import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message, Plugin } from '@zhin.js/core';
import { AskUserSessionService } from '../../src/builtin/ask-user-session-service.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

function installService() {
  let capturedMw: (m: Message, next: () => Promise<void>) => Promise<void> = async () => {};
  const plugin = {
    root: {
      addMiddleware: (fn: typeof capturedMw) => {
        capturedMw = fn;
        return () => {};
      },
      inject: vi.fn(),
    },
  } as unknown as Plugin;
  const service = AskUserSessionService.install(plugin);
  return { service, plugin, runMw: (msg: Message) => capturedMw(msg, vi.fn()) };
}

function groupMsg(overrides: Parameters<typeof mockCommMessage>[0] = {}) {
  return mockCommMessage({
    adapter: 'icqq',
    endpoint: 'bot1',
    scope: 'group',
    sceneId: 'g1',
    ...overrides,
  });
}

function ownerPrivateMsg(senderId = 'owner1') {
  return mockCommMessage({
    adapter: 'icqq',
    endpoint: 'bot1',
    scope: 'private',
    senderId,
    sceneId: senderId,
  });
}

function sensitiveSpec(
  sessionId: string,
  question: string,
  sendMessage: ReturnType<typeof vi.fn>,
  overrides: { timeoutMs?: number; default_value?: string; groupOrigin?: Message } = {},
) {
  const message = groupMsg();
  return {
    sessionId,
    kind: 'sensitive_dm' as const,
    message,
    questionType: 'confirm',
    args: {
      question,
      ...(overrides.default_value != null ? { default_value: overrides.default_value } : {}),
    },
    timeoutMs: overrides.timeoutMs ?? 30_000,
    botMaster: 'owner1',
    adapter: { sendMessage } as never,
    groupOrigin: overrides.groupOrigin ?? message,
  };
}

describe('AskUserSessionService', () => {
  beforeEach(() => {
    AskUserSessionService.resetForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    AskUserSessionService.resetForTests();
  });

  it('queues concurrent sensitive_dm for same owner and resolves in order', async () => {
    const sendMessage = vi.fn().mockResolvedValue('sent');
    const { service, runMw } = installService();

    const first = service.open(sensitiveSpec('s1', '执行 rm?', sendMessage));
    const second = service.open(sensitiveSpec('s2', '执行 curl?', sendMessage));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(service.isPendingReply(ownerPrivateMsg())).toBe(true);

    await runMw({ ...ownerPrivateMsg(), $raw: 'yes' } as Message);
    await expect(first).resolves.toBe('yes');

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    await runMw({ ...ownerPrivateMsg(), $raw: 'no' } as Message);
    await expect(second).resolves.toBe('no');
  });

  it('resolves timeout with cancel message when no default_value', async () => {
    const sendMessage = vi.fn().mockResolvedValue('sent');
    const { service } = installService();

    const pending = service.open(sensitiveSpec('s1', '确认?', sendMessage, { timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(pending).resolves.toBe('Owner 未在规定时间内响应，操作已取消。');
    expect(service.isPendingReply(ownerPrivateMsg())).toBe(false);
  });

  it('resolves timeout with default_value when configured', async () => {
    const sendMessage = vi.fn().mockResolvedValue('sent');
    const { service } = installService();

    const pending = service.open(sensitiveSpec('s1', '确认?', sendMessage, {
      timeoutMs: 2_000,
      default_value: 'fallback',
    }));
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(pending).resolves.toBe('fallback');
  });

  it('bypasses slash commands while ask is pending', () => {
    const sendMessage = vi.fn().mockResolvedValue('sent');
    const { service, plugin } = installService();

    void service.open(sensitiveSpec('s1', '确认?', sendMessage));

    const cmdMsg = {
      ...ownerPrivateMsg(),
      $raw: '/approve list',
    } as Message;
    expect(service.matchInbound(cmdMsg, plugin.root as Plugin)).toBe('bypass');
    expect(service.isPendingReply(cmdMsg, plugin.root as Plugin)).toBe(false);
  });

  it('notifies group feed on sensitive_dm resolve from group origin', async () => {
    const notifySpy = vi.spyOn(
      await import('../../src/collaboration/ask-user-bridge.js'),
      'notifyGroupOwnerAskUserResolved',
    ).mockResolvedValue(undefined);

    const sendMessage = vi.fn().mockResolvedValue('sent');
    const { service, runMw } = installService();
    const groupOrigin = groupMsg({ sceneId: 'collab-room' });

    const pending = service.open({
      ...sensitiveSpec('s1', '确认?', sendMessage),
      groupOrigin,
    });
    await runMw({ ...ownerPrivateMsg(), $raw: 'yes' } as Message);
    await expect(pending).resolves.toContain('yes');
    expect(notifySpy).toHaveBeenCalledWith(groupOrigin, expect.stringContaining('yes'));
    notifySpy.mockRestore();
  });
});
