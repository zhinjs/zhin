import { describe, expect, it, vi, afterEach } from 'vitest';
import { setHostRootPlugin } from '@zhin.js/core';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { HookRegistry, AgentOrchestrator } from '../../src/orchestrator/index.js';
import {
  LEGACY_HOOK_STREAM_ALIASES,
  agentStreamEventToAIHookEvent,
  isAgentStreamHookEventName,
} from '../../src/event/agent-stream-hooks.js';

describe('HookRegistry stream vocabulary (ADR 0039 P0)', () => {
  afterEach(() => {
    setHostRootPlugin(null);
  });

  it('triggerStream invokes hooks subscribed to Eve-aligned event names', async () => {
    const registry = new HookRegistry();
    const handler = vi.fn();
    registry.add({
      name: 'on-turn-start',
      event: AgentStreamEventType.TURN_STARTED,
      handler,
    });

    await registry.triggerStream({
      type: AgentStreamEventType.TURN_STARTED,
      data: { sessionId: 'ses_1', turnId: 'turn_1' },
    }, undefined, 'ses_1', { skipBus: true });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('turn');
    expect(handler.mock.calls[0][0].action).toBe('started');
    expect(handler.mock.calls[0][0].context.streamType).toBe(AgentStreamEventType.TURN_STARTED);
  });

  it('legacy message:received also fires message.received stream hooks via bus sink', async () => {
    const orchestrator = new AgentOrchestrator();
    const legacyHandler = vi.fn();
    const streamHandler = vi.fn();
    orchestrator.hooks.add({ name: 'legacy', event: 'message:received', handler: legacyHandler });
    orchestrator.hooks.add({ name: 'stream', event: AgentStreamEventType.MESSAGE_RECEIVED, handler: streamHandler });

    await orchestrator.agentStreamBus.publish({
      type: AgentStreamEventType.MESSAGE_RECEIVED,
      data: { message: 'hi' },
    }, { sessionId: 'ses_1' });

    expect(legacyHandler).toHaveBeenCalledTimes(1);
    expect(streamHandler).toHaveBeenCalledTimes(1);
  });

  it('maps legacy aliases to stream event names', () => {
    expect(LEGACY_HOOK_STREAM_ALIASES['message:received']).toBe(AgentStreamEventType.MESSAGE_RECEIVED);
    expect(LEGACY_HOOK_STREAM_ALIASES['tool:call']).toBe(AgentStreamEventType.ACTIONS_REQUESTED);
  });

  it('isAgentStreamHookEventName recognizes contract vocabulary', () => {
    expect(isAgentStreamHookEventName('session.waiting')).toBe(true);
    expect(isAgentStreamHookEventName('message:received')).toBe(false);
  });

  it('agentStreamEventToAIHookEvent splits dotted stream type', () => {
    const hookEvent = agentStreamEventToAIHookEvent({
      type: AgentStreamEventType.ACTION_RESULT,
      data: { toolName: 'bash' },
    }, 'ses_9');
    expect(hookEvent.type).toBe('action');
    expect(hookEvent.action).toBe('result');
    expect(hookEvent.sessionId).toBe('ses_9');
  });
});
