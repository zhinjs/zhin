import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Plugin } from '@zhin.js/core';
import { AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { createAgentStreamBus } from '../../src/event/agent-stream-bus.js';
import { ImApprovalAdapter } from '../../src/session/im-approval-adapter.js';
import { ToolApprovalOnceStore } from '../../src/tool/tool-approval-once-store.js';
import {
  resolveToolApprovalRequired,
  runToolApprovalGate,
} from '../../src/tool/tool-approval-gate.js';
import { AskUserBuiltinTool } from '../../src/builtin/ask-user-tool.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('tool-approval-gate', () => {
  let onceStore: ToolApprovalOnceStore;

  beforeEach(() => {
    onceStore = new ToolApprovalOnceStore();
    vi.spyOn(AskUserBuiltinTool.prototype, 'run').mockResolvedValue('yes');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolveToolApprovalRequired respects always/never and custom fn', async () => {
    expect(await resolveToolApprovalRequired('never', { toolName: 't', args: {}, sessionId: 's' })).toBe(false);
    expect(await resolveToolApprovalRequired('always', { toolName: 't', args: {}, sessionId: 's' })).toBe(true);
    expect(await resolveToolApprovalRequired('once', { toolName: 't', args: {}, sessionId: 's' }, onceStore)).toBe(true);
    onceStore.add('s', 't');
    expect(await resolveToolApprovalRequired('once', { toolName: 't', args: {}, sessionId: 's' }, onceStore)).toBe(false);
    expect(await resolveToolApprovalRequired(async () => true, { toolName: 't', args: {}, sessionId: 's' })).toBe(true);
  });

  it('runToolApprovalGate publishes input events via bus and proceeds when approved', async () => {
    const events: unknown[] = [];
    const bus = createAgentStreamBus();
    bus.registerSink({
      name: 'test',
      handle: (event) => { events.push(event); },
    });
    const plugin = new Plugin('/virtual/approval.ts');
    const commMessage = mockCommMessage();
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: { path: '/tmp' },
      sessionId: 'sess-1',
      commMessage,
      policy: 'always',
      plugin,
      bus,
      port: new ImApprovalAdapter(plugin, commMessage),
      publishCtx: { sessionId: 'sess-1' },
      onceStore,
    });
    expect(denied).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        type: AgentStreamEventType.INPUT_REQUESTED,
        data: expect.objectContaining({ toolName: 'danger', kind: 'approval' }),
      }),
      expect.objectContaining({
        type: AgentStreamEventType.INPUT_COMPLETED,
        data: expect.objectContaining({ toolName: 'danger', approved: true }),
      }),
    ]);
  });
});
