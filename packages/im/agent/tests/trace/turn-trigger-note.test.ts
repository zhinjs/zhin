import { describe, expect, it, vi } from 'vitest';
import { TurnTraceCollector, registerTurnTrace } from '../../src/trace/index.js';
import { observeWithAdmission } from '../../src/plugin-runtime/ingress/ingress-delivery-helpers.js';

describe('observeWithAdmission trigger note (#1250)', () => {
  it('records the trigger message and admission facts once, on the first turn event', () => {
    let now = 40_000;
    const trace = new TurnTraceCollector({ turnId: 'turn-trigger', sessionKey: 's' }, () => now);
    const release = registerTurnTrace(trace);
    try {
      const inner = vi.fn();
      const markActed = vi.fn();
      const admission = { kind: 'run', markActed,
        facts: { queuedMs: 4_000, mergedMessages: 2, supersededPrevious: false } } as never;
      const observe = observeWithAdmission(inner, 'turn-trigger', admission, {
        text: '天气 北京', senderId: 'u1', senderName: 'Bob', conversation: { kind: 'private', id: 'u1' },
        messageId: 'm9', receivedAt: 15_000,
      });
      now = 41_000;
      observe({ type: 'iteration_start', iteration: 1 } as never);
      observe({ type: 'iteration_start', iteration: 2 } as never);
      expect(inner).toHaveBeenCalledTimes(2);
      const snapshot = trace.snapshot();
      expect(snapshot.trigger).toEqual({ text: '天气 北京', sender_id: 'u1', sender_name: 'Bob', conversation: 'private:u1',
        message_id: 'm9', received_at: 15_000, wait_before_start_ms: 25_000, merged_messages: 2, queued_ms: 4_000 });
      expect(snapshot.timeline.filter(entry => entry.kind === 'admission')).toHaveLength(1);
    } finally {
      release();
    }
  });

  it('passes events through untouched without admission or trigger', () => {
    const inner = vi.fn();
    expect(observeWithAdmission(inner, 't', undefined)).toBe(inner);
  });
});
