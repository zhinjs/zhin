import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRunJournal, AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { createAgentStreamBus } from '../../src/event/agent-stream-bus.js';
import { ToolApprovalOnceStore } from '../../src/tool/tool-approval-once-store.js';
import {
  resolveToolApprovalRequired,
  runToolApprovalGate,
} from '../../src/tool/tool-approval-gate.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('tool-approval-gate', () => {
  let onceStore: ToolApprovalOnceStore;

  beforeEach(() => {
    onceStore = new ToolApprovalOnceStore();
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
    const commMessage = mockCommMessage();
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: { path: '/tmp' },
      sessionId: 'sess-1',
      commMessage,
      policy: 'always',
      bus,
      port: { requestApproval: async () => true },
      publishCtx: { sessionId: 'sess-1' },
      onceStore,
      signal: new AbortController().signal,
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

  it('fails closed for on-risk when no ApprovalPort is available', async () => {
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: {},
      sessionId: 'sess-1',
      commMessage: mockCommMessage(),
      policy: 'on-risk',
      signal: new AbortController().signal,
    });

    expect(denied).toBe('Error: approval required but ApprovalPort unavailable');
  });

  it('records approved request and result in the ordered turn journal', async () => {
    const journal = new AgentRunJournal({ sessionId: 'sess-1', turnId: 'turn-1' });
    const events: unknown[] = [];
    const bus = createAgentStreamBus();
    bus.registerSink({ name: 'test', handle: (event) => { events.push(event); } });
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: { path: '/tmp' },
      sessionId: 'sess-1',
      commMessage: mockCommMessage(),
      policy: 'on-risk',
      port: { requestApproval: async () => true },
      bus,
      journal,
      signal: new AbortController().signal,
    });

    expect(denied).toBeNull();
    expect(journal.replay()).toMatchObject([
      {
        type: AgentStreamEventType.INPUT_REQUESTED,
        run: { sessionId: 'sess-1', turnId: 'turn-1' },
        sequence: 1,
        data: { kind: 'approval', toolName: 'danger' },
      },
      {
        type: AgentStreamEventType.INPUT_COMPLETED,
        run: { sessionId: 'sess-1', turnId: 'turn-1' },
        sequence: 2,
        data: { kind: 'approval', toolName: 'danger', approved: true },
      },
    ]);
    expect(events).toMatchObject(journal.replay());
  });
});
