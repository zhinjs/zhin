import { describe, expect, it } from 'vitest';
import { turnOriginLabelOf } from '@zhin.js/agent/trace';
import { sessionPartsOf } from '@zhin.js/gateway/usage';

/**
 * #1250 b63: the Agent's trace-session / approval-card labels and the gateway usage stats name a
 * conversation by the same rules (kept in two packages: the Agent must not import the gateway).
 */
describe('turn origin label parity with the usage stats', () => {
  const conversation = (kind: string, id: string, name?: string) => ({ endpoint: { adapter: 'sandbox', id: 'bot' }, kind, id, ...(name ? { name } : {}) });
  const cases: Array<[string, { origin: unknown; principal?: { display_name?: string } }]> = [
    ['named group', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: 'g1', conversation: conversation('group', 'g1', '开发群') } }],
    ['unnamed group', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: 'g2' } }],
    ['private by principal', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'u1' }, principal: { display_name: 'Developer' } }],
    ['direct scope', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'direct', sceneId: 'u2' } }],
    ['guild scope', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'guild', sceneId: 'c1', conversation: conversation('channel', 'c1') } }],
    ['schedule', { origin: { kind: 'schedule', jobId: 'sched_1' } }],
    ['internal', { origin: { kind: 'internal', source: 'heartbeat' } }],
    ['http', { origin: { kind: 'http', sessionId: 's' } }],
    ['a2a', { origin: { kind: 'a2a', taskId: 't' } }],
    ['mcp', { origin: { kind: 'mcp', requestId: 'r' } }],
    ['none', { origin: undefined }],
  ];
  it.each(cases)('%s', (_name, trace) => {
    const { scopeKind, sceneLabel } = turnOriginLabelOf(trace.origin, trace.principal?.display_name);
    expect({ ...(scopeKind ? { scopeKind } : {}), ...(sceneLabel ? { sceneLabel } : {}) }).toEqual(sessionPartsOf(trace));
  });
});
