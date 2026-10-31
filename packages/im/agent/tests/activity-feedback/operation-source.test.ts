import { operationSession } from '../../../feature-kit/src/operation-session.js';
import type { Message } from '@zhin.js/core';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import { activityFeedbackSource, bindActivityFeedbackSource, bindActivityFeedbackTurnSource } from '../../src/activity-feedback/operation-source.js';
import { createTurnActivityProjector } from '../../src/activity-feedback/turn-event-projector.js';
import type { AIEventPayload } from '../../src/ai-event-contract.js';

it('keeps the native Client out of event JSON while preserving exact authority through projections', () => {
  const controller = new AbortController();
  const client = { toJSON() { throw new Error('Native Client must never be serialized'); } };
  const target = { endpoint: { adapter: 'synthetic', id: 'canonical\0account' }, kind: 'private' as const,
    id: 'alice', parent: { kind: 'group' as const, id: 'group' }, threadId: 'thread' };
  const input = { conversation: target, sender: { id: 'alice' }, locale: 'en', id: 'incoming',
    [operationSession]: () => ({ scene: target, endpoint: client, signal: controller.signal }) };
  const payload = new ZhinAgentEventEmitter().createPayload('session', input as unknown as Message, 'text');
  expect(payload[activityFeedbackSource]).toEqual({ target, client, signal: controller.signal });
  expect(Object.getOwnPropertyDescriptor(payload, activityFeedbackSource)?.enumerable).toBe(false);
  expect(Object.isFrozen(client)).toBe(false);
  expect(() => JSON.stringify(payload)).not.toThrow();
  expect(JSON.stringify(payload)).not.toContain('toJSON');
  const projected: AIEventPayload[] = [];
  const project = createTurnActivityProjector({ payload, publish: (_event, next) => projected.push(next), thinkingPreview: true, thinkingMaxLength: 100 });
  project({ type: 'iteration_start', iteration: 2, maxIterations: 10 });
  project({ type: 'thinking', text: 'synthetic thought' });
  for (const next of projected) {
    expect(next[activityFeedbackSource]).toBe(payload[activityFeedbackSource]);
    expect(() => JSON.stringify(next)).not.toThrow();
  }
});

it('does not treat similarly named metadata or a retired operation as a platform capability', () => {
  const input = { metadata: { session: { endpoint: {} }, signal: new AbortController().signal }, conversation: {} };
  expect(bindActivityFeedbackSource({}, input)[activityFeedbackSource]).toBeUndefined();
  const controller = new AbortController(); controller.abort();
  expect(bindActivityFeedbackSource({}, { [operationSession]: () => ({ endpoint: {}, signal: controller.signal }) })[activityFeedbackSource]).toBeUndefined();
});

it('binds a FullAgent turn only through its real Client port and exact origin conversation', () => {
  const target = { endpoint: { adapter: 'synthetic', id: 'canonical' }, kind: 'channel' as const, id: 'channel', threadId: 'thread' };
  const client = {}, signal = new AbortController().signal;
  const payload = bindActivityFeedbackTurnSource({}, { origin: { kind: 'im', conversation: target }, ports: { client: { get: () => client } }, signal } as never);
  expect(payload[activityFeedbackSource]).toEqual({ target, client, signal });
  expect(JSON.stringify(payload)).toBe('{}');
});
