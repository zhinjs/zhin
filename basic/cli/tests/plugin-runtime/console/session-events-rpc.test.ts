import { describe, expect, it } from 'vitest';
import { AiSessionEvents, DecisionEventLog } from '@zhin.js/agent';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import {
  SESSION_EVENTS_READ_PERMISSION,
  SESSION_EVENTS_WRITE_PERMISSION,
} from '../../../src/plugin-runtime/console/session-events-rpc.js';

const signal = new AbortController().signal;
const HOUR = 60 * 60 * 1000;

function harness(options: { bound?: boolean } = {}) {
  const status = new AssistantStatus();
  const log = new DecisionEventLog();
  const store = new AiSessionEvents({ audit: () => log });
  if (options.bound !== false) status.bindSessionEvents(() => store);
  const call = (name: string, input: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => status.consoleRpc.methods.get(name)!.handler(input as never, { signal })) as Promise<Record<string, any>>;
  const codes = async () => {
    await log.idle();
    return log.recent().map((row) => `${row.kind}:${row.outcome}:${row.reasonCode}:${row.actor}`);
  };
  return { status, store, call, codes };
}

const scene = { platform: 'icqq', sceneId: 'group:123' };

describe('session events Console RPC (ADR 0037 slice D)', () => {
  it('declares reads on control:read and writes on control:write', () => {
    const { status } = harness();
    for (const name of ['session-events', 'session-event']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: true, requiredPermissions: [SESSION_EVENTS_READ_PERMISSION] });
    }
    for (const name of ['session-event-create', 'session-event-update', 'session-event-cancel']) {
      expect(status.consoleRpc.methods.get(name)).toMatchObject({ readOnly: false, requiredPermissions: [SESSION_EVENTS_WRITE_PERMISSION] });
    }
  });

  it('creates, lists, updates and cancels with expectedRevision, auditing each step as the operator', async () => {
    const { call, codes } = harness();
    const at = Date.now() + 2 * HOUR;
    const created = await call('session-event-create', { ...scene, title: '社团周会', at, remindBefore: [HOUR] });
    expect(created).toMatchObject({ to: 'scheduled', reasonCode: 'schedule_event_created', event: { title: '社团周会', remindBefore: [HOUR], createdVia: 'console', revision: 1 } });
    const id = created.event.id as string;
    expect((await call('session-events', scene)).events.map((row: { id: string }) => row.id)).toEqual([id]);
    await expect(call('session-event-update', { id, expectedRevision: 9, title: 'x' })).rejects.toMatchObject({ code: 'conflict' });
    const updated = await call('session-event-update', { id, expectedRevision: 1, at: at + HOUR });
    expect(updated).toMatchObject({ reasonCode: 'schedule_event_updated', event: { at: at + HOUR, revision: 2 } });
    const cancelled = await call('session-event-cancel', { id, expectedRevision: 2 });
    expect(cancelled).toMatchObject({ to: 'cancelled', reasonCode: 'schedule_event_cancelled' });
    await expect(call('session-event-cancel', { id, expectedRevision: 3 })).rejects.toMatchObject({ code: 'conflict' });
    expect(await call('session-event', { id })).toMatchObject({ status: 'cancelled' });
    expect(await codes()).toEqual([
      'schedule:allow:schedule_event_created:operator',
      'schedule:allow:schedule_event_updated:operator',
      'schedule:allow:schedule_event_cancelled:operator',
    ]);
  });

  it('validates input and reports unavailable before binding', async () => {
    const { call } = harness();
    await expect(call('session-event-create', { ...scene, title: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('session-event-create', { ...scene, title: 'x', at: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('session-event-create', { ...scene, title: 'x', at: Date.now() + HOUR, bogus: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('session-events', { platform: 'icqq', sceneId: 'private:1' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('session-event', { id: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
    const unbound = harness({ bound: false });
    await expect(unbound.call('session-events', scene)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
