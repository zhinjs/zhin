import { describe, expect, it, vi } from 'vitest';
import { rootPluginId, type SnapshotLease } from '@zhin.js/plugin-runtime';
import {
  executeInboundTurnSpine,
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
