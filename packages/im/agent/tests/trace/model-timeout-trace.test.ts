import { TurnTraceCollector, formatTurnTrace } from '../../src/trace/index.js';

// #1250: a hung model request must leave a visible timeout on the turn trace timeline,
// not only `model_request #1` followed by a cancellation.
it('records a model timeout on the trace timeline', () => {
  const trace = new TurnTraceCollector({ turnId: 't1', sessionKey: 's1' });
  trace.note({ kind: 'model_timeout', phase: 'first_response', timeout_ms: 30_000, attempt: 1, provider: 'relay', model: 'gpt-x' });
  const snapshot = trace.snapshot();
  expect(snapshot.timeline).toEqual([
    expect.objectContaining({ kind: 'model_timeout', detail: 'relay/gpt-x no response after 30000ms (attempt 1)' }),
  ]);
  expect(formatTurnTrace(snapshot, { timeline: true })).toContain('model_timeout');
});
