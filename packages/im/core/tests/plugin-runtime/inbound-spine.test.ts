import { describe, expect, it, vi } from 'vitest';
import { rootPluginId, type SnapshotLease } from '@zhin.js/plugin-runtime';
import {
  executeInboundTurnSpine,
  InboundOutcomeLedger,
  inboundOutcomeSink,
  isNonHumanOrigin,
  reportInboundOutcome,
  installComponentHost,
  installOutboundHost,
  installLocaleHost,
  installDatabaseHost,
  normalizeDatabaseHostConfig,
  type InboundTurnEnvelope,
  type Message,
} from '@zhin.js/core/runtime';

function createEnvelope(overrides: Partial<InboundTurnEnvelope> = {}): InboundTurnEnvelope {
  const lease = {
    value: {
      generation: 1,
      root: rootPluginId(),
      resources: new Map(),
      projections: new Map(),
    },
    stopSignal: new AbortController().signal,
  } as unknown as SnapshotLease;
  const message = {
    id: 'msg-1',
    sender: { id: 'sender-1' },
    conversation: {
      endpoint: { id: 'ep-1', adapter: 'sandbox' },
      kind: 'private',
      id: 'u-1',
    },
    content: 'hello',
  } as unknown as Message;
  return {
    message,
    lease,
    requester: rootPluginId(),
    conversationSequence: 1,
    runHandlers: vi.fn(async () => undefined),
    dispatchInteractive: vi.fn(async () => undefined),
    dispatchCommand: vi.fn(async () => ({ dispatch: Object.freeze({ matched: false }) })),
    hasReplied: () => false,
    ...overrides,
  };
}

describe('executeInboundTurnSpine & @zhin.js/core/runtime host installers', () => {
  it('exports IM and Database host installers from @zhin.js/core/runtime', () => {
    expect(typeof installComponentHost).toBe('function');
    expect(typeof installOutboundHost).toBe('function');
    expect(typeof installLocaleHost).toBe('function');
    expect(typeof installDatabaseHost).toBe('function');
    expect(normalizeDatabaseHostConfig({ dialect: 'memory' })).toEqual({ dialect: 'memory' });
  });

  it('short-circuits on pre-route and reports handler dispatch', async () => {
    const reportDispatch = vi.fn(async () => undefined);
    const runHandlers = vi.fn(async () => undefined);
    const outcome = await executeInboundTurnSpine(createEnvelope({
      ingressRoute: {
        preRoute: async () => true,
        route: async () => false,
      },
      runHandlers,
    }), { reportDispatch });

    expect(outcome.stage).toBe('pre-route');
    expect(outcome.dispatch).toEqual({
      matched: true,
      command: 'pre-route',
      owner: rootPluginId(),
    });
    expect(runHandlers).not.toHaveBeenCalled();
    expect(reportDispatch).toHaveBeenCalledWith({
      matched: true,
      path: 'handler',
      handlerId: 'pre-route',
      replied: false,
    });
  });

  it('falls back to agent-ingress when handlers, interactive, and commands miss', async () => {
    const reportDispatch = vi.fn(async () => undefined);
    const outcome = await executeInboundTurnSpine(createEnvelope({
      ingressRoute: {
        route: async () => true,
      },
    }), { reportDispatch });

    expect(outcome.stage).toBe('agent-ingress');
    expect(outcome.dispatch).toEqual({
      matched: true,
      command: 'ai',
      owner: rootPluginId(),
    });
    expect(outcome.record).toMatchObject({
      turnId: 'msg-1:1',
      senderId: 'sender-1',
      stage: 'agent-ingress',
      matched: true,
      command: 'ai',
      owner: rootPluginId(),
      replied: false,
    });
    expect(reportDispatch).toHaveBeenCalledWith({
      matched: true,
      path: 'handler',
      handlerId: 'ai',
      replied: false,
    });
  });

  it('answers a near-miss command with a suggestion instead of handing it to the AI (#1250)', async () => {
    const reportDispatch = vi.fn(async () => undefined);
    const route = vi.fn(async () => true);
    const outcome = await executeInboundTurnSpine(createEnvelope({
      ingressRoute: { route },
      suggestCommand: async () => '没有这个指令，你是不是想用：rss list',
    }), { reportDispatch });

    expect(route).not.toHaveBeenCalled();
    expect(outcome.stage).toBe('command-suggestion');
    expect(outcome.dispatch.matched).toBe(false);
    expect(outcome.reply).toEqual({ owner: rootPluginId(), content: '没有这个指令，你是不是想用：rss list' });
    expect(reportDispatch).toHaveBeenCalledWith({ matched: false, path: 'none', replied: true });
  });

  it('keeps a message from something other than a person away from every command (#1250 第 84 批)', async () => {
    const base = createEnvelope();
    const ledger = new InboundOutcomeLedger({ conversation: base.message.conversation, receivedAt: 1 });
    const message = { ...base.message, content: '/models', metadata: { origin: 'peer_bot' }, [inboundOutcomeSink]: () => ledger } as unknown as Message;
    const dispatchCommand = vi.fn(async () => ({ dispatch: Object.freeze({ matched: true, status: 'denied' as const, command: 'models' }) }));
    const suggestCommand = vi.fn(async () => 'did you mean /models');
    const route = vi.fn(async () => false);
    const outcome = await executeInboundTurnSpine(createEnvelope({ message, dispatchCommand, suggestCommand, ingressRoute: { route } }));
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(suggestCommand).not.toHaveBeenCalled();
    expect(outcome.reply).toBeUndefined();
    expect(ledger.settle()).toMatchObject({ outcome: 'ignored_bot', reason: 'non_human_origin', stage: 'command' });
  });

  it('judges the origin from the trusted origin first, then the self-reported metadata (#1250 第 84 批)', () => {
    expect(isNonHumanOrigin({ origin: 'peer_bot' })).toBe(true);
    expect(isNonHumanOrigin({ metadata: { origin: 'member' } })).toBe(true);
    expect(isNonHumanOrigin({ origin: 'human', metadata: { origin: 'self' } })).toBe(false);
    expect(isNonHumanOrigin({ metadata: { origin: 'human' } })).toBe(false);
    expect(isNonHumanOrigin({ metadata: {} })).toBe(false);
    expect(isNonHumanOrigin({})).toBe(false);
  });

  it('keeps the outcome a command reported itself when it returned and sent nothing (#1250 第 84 批)', async () => {
    const run = async (input: { report: boolean; value?: string; replied?: boolean }) => {
      const base = createEnvelope();
      const ledger = new InboundOutcomeLedger({ conversation: base.message.conversation, receivedAt: 1 });
      const message = { ...base.message, content: '/reset', [inboundOutcomeSink]: () => ledger } as unknown as Message;
      await executeInboundTurnSpine(createEnvelope({ message, dispatchCommand: async () => {
        if (input.report) reportInboundOutcome(message, { outcome: 'not_addressed', reason: 'clear_command', stage: 'agent_gate' });
        if (input.replied) ledger.noteReplyDelivered();
        return { dispatch: Object.freeze({ matched: true, status: 'executed' as const, command: 'reset', owner: rootPluginId(),
          ...(input.value !== undefined ? { value: input.value } : {}) }) };
      } }));
      return ledger.settle();
    };
    expect(await run({ report: true })).toMatchObject({ outcome: 'not_addressed', reason: 'clear_command' });
    // A command that answered, or reported nothing, still records command_replied.
    expect(await run({ report: true, value: 'done' })).toMatchObject({ outcome: 'command_replied', reason: 'executed' });
    expect(await run({ report: true, replied: true })).toMatchObject({ outcome: 'command_replied', reason: 'executed' });
    expect(await run({ report: false })).toMatchObject({ outcome: 'command_replied', reason: 'executed' });
  });

  it('keeps the AI path when no command is similar or a handler already replied', async () => {
    const route = vi.fn(async () => true);
    const none = await executeInboundTurnSpine(createEnvelope({
      ingressRoute: { route }, suggestCommand: async () => undefined,
    }));
    expect(none.stage).toBe('agent-ingress');
    expect(route).toHaveBeenCalledTimes(1);

    const suggestCommand = vi.fn(async () => 'unused');
    const replied = await executeInboundTurnSpine(createEnvelope({
      ingressRoute: { route }, suggestCommand, hasReplied: () => true,
    }));
    expect(suggestCommand).not.toHaveBeenCalled();
    expect(replied.reply).toBeUndefined();
    expect(route).toHaveBeenCalledTimes(2);

    const failing = await executeInboundTurnSpine(createEnvelope({
      ingressRoute: { route }, suggestCommand: async () => { throw new Error('index unavailable'); },
    }));
    expect(failing.stage).toBe('agent-ingress');
    expect(route).toHaveBeenCalledTimes(3);
  });

  it('invokes onTurnComplete with a frozen InboundTurnRecord for command turns', async () => {
    const onTurnComplete = vi.fn();
    const outcome = await executeInboundTurnSpine(createEnvelope({
      turnId: 'custom-turn-42',
      dispatchCommand: vi.fn(async () => ({
        dispatch: Object.freeze({ matched: true, command: 'help', owner: rootPluginId() }),
        reply: { owner: rootPluginId(), content: 'help text' },
      })),
      onTurnComplete,
    }));

    expect(outcome.stage).toBe('command');
    expect(Object.isFrozen(outcome.record)).toBe(true);
    expect(onTurnComplete).toHaveBeenCalledOnce();
    expect(onTurnComplete).toHaveBeenCalledWith(expect.objectContaining({
      turnId: 'custom-turn-42',
      stage: 'command',
      matched: true,
      command: 'help',
      replied: true,
    }));
  });
});
