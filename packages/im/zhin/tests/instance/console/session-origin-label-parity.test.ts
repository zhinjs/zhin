import { describe, expect, it } from 'vitest';
import { sanitizeOriginText, turnOriginLabelOf } from '@zhin.js/agent/trace';
import { sanitizeSessionText, sessionDisplayNameOf, sessionPartsOf } from '@zhin.js/gateway/usage';

/**
 * #1250 b63: the Agent's trace-session / approval-card labels and the gateway usage stats name a
 * conversation by the same rules and in the same format (kept in two packages: the Agent must not
 * import the gateway).
 */
describe('turn origin label parity with the usage stats', () => {
  const conversation = (kind: string, id: string, name?: string) => ({ endpoint: { adapter: 'sandbox', id: 'bot' }, kind, id, ...(name !== undefined ? { name } : {}) });
  const cases: Array<[string, { origin: unknown; principal?: { display_name?: string } }]> = [
    ['named group', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: 'g1', conversation: conversation('group', 'g1', '开发群') } }],
    ['unnamed group', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: 'g2' } }],
    ['private by principal', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'u1' }, principal: { display_name: 'Developer' } }],
    ['direct with principal', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'direct', sceneId: 'u3' }, principal: { display_name: '  Alice ' } }],
    ['direct scope', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'direct', sceneId: 'u2' } }],
    ['guild scope', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'guild', sceneId: 'c1', conversation: conversation('channel', 'c1') } }],
    ['whitespace-only names', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: 'g3', conversation: conversation('group', 'g3', '   ') }, principal: { display_name: ' ' } }],
    ['missing scope falls back to conversation.kind', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: '', sceneId: 'g4', conversation: conversation('group', 'g4') } }],
    ['blank scope falls back to conversation.kind', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: '  ', sceneId: 'g5', conversation: conversation('channel', 'g5') } }],
    ['missing sceneId falls back to conversation.id', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: ' ', conversation: conversation('group', 'g6') } }],
    ['missing platform falls back to the adapter', { origin: { kind: 'im', endpoint: 'bot', scope: 'group', sceneId: 'g7', conversation: conversation('group', 'g7') } }],
    ['unknown IM scope', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'forum', sceneId: 'f1' } }],
    ['control characters in names', { origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'group', sceneId: 'g8', conversation: conversation('group', 'g8', '坏\u001b[2J\u202E群\n名') } }],
    ['schedule', { origin: { kind: 'schedule', jobId: 'sched_1' } }],
    ['schedule without jobId', { origin: { kind: 'schedule' } }],
    ['internal', { origin: { kind: 'internal', source: 'heartbeat' } }],
    ['http', { origin: { kind: 'http', sessionId: 's' } }],
    ['a2a', { origin: { kind: 'a2a', taskId: 't' } }],
    ['mcp', { origin: { kind: 'mcp', requestId: 'r' } }],
    ['unknown kind', { origin: { kind: 'carrier-pigeon', id: 'x' } }],
    ['none', { origin: undefined }],
  ];
  it.each(cases)('%s', (_name, trace) => {
    const { platform, scopeKind, sceneLabel, displayName } = turnOriginLabelOf(trace.origin, trace.principal?.display_name);
    expect({ ...(scopeKind ? { scopeKind } : {}), ...(sceneLabel ? { sceneLabel } : {}) }).toEqual(sessionPartsOf(trace));
    // Same platform (the gateway's name starts with it) and the same readable format.
    expect(displayName).toBe(sessionDisplayNameOf(trace));
    if (platform) expect(sessionDisplayNameOf(trace)?.startsWith(`${platform} · `) || sessionDisplayNameOf(trace) === platform).toBe(true);
  });

  it('clean names identically', () => {
    for (const value of ['\u001b[31m红\u001b[0m', ' a\u2028b\u2029c ', 'x\u202Ay\u2066z', '😀'.repeat(200), '\u0085', '  ', 7]) {
      expect(sanitizeOriginText(value)).toBe(sanitizeSessionText(value));
    }
  });
});
