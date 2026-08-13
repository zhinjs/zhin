import { describe, it, expect } from 'vitest';
import {
  buildTurnContextEnvelope,
  prependTurnContextEnvelope,
  TURN_CONTEXT_BEGIN,
  TURN_CONTEXT_END,
} from '../../src/context/turn-envelope.js';
import {
  applyTurnContextToUserMessages,
  prependEnvelopeToFirstUserText,
} from '../../src/context/turn-user-message.js';
import { createUserMessage } from '@zhin.js/ai';

describe('buildTurnContextEnvelope', () => {
  it('包含 Model、Sdk 与 AGENTS 块', () => {
    const envelope = buildTurnContextEnvelope({
      modelLine: 'anyrouter/claude-haiku-4-5-20251001',
      sdk: 'anthropic',
      agentsContext: '[Agents instructions]\n\n## AGENTS.md\n\nBe helpful.',
    });
    expect(envelope).toContain('Model: anyrouter/claude-haiku-4-5-20251001');
    expect(envelope).toContain('Sdk: anthropic');
    expect(envelope).toContain('[Agents instructions]');
    expect(envelope).toContain('Be helpful.');
    const modelIdx = envelope!.indexOf('Model:');
    const sdkIdx = envelope!.indexOf('Sdk:');
    expect(modelIdx).toBeLessThan(sdkIdx);
  });

  it('包含时间、Session、deferred 与 profile', () => {
    const envelope = buildTurnContextEnvelope({
      turn: turnContext({
        origin: {
          kind: 'im', platform: 'icqq', endpoint: '8596238',
          scope: 'group', sceneId: '201193925',
        },
      }),
      profileSummary: 'User prefers concise answers.',
      toneHint: 'casual',
      deferredStats: 'weather(1)',
    });
    expect(envelope).toContain(TURN_CONTEXT_BEGIN);
    expect(envelope).toContain(TURN_CONTEXT_END);
    expect(envelope).toContain('Time:');
    expect(envelope).toContain('Session: platform:icqq');
    expect(envelope).toContain('Deferred catalog: weather(1)');
    expect(envelope).toContain('User prefers concise answers.');
    expect(envelope).toContain('[Tone hint] casual');
  });

  it('私聊也写入 Sender roles（无 group sender 前缀时模型仍能看见 master）', () => {
    const envelope = buildTurnContextEnvelope({
      turn: turnContext({
        origin: { kind: 'im', platform: 'qq', endpoint: '知音', scope: 'private', sceneId: 'user' },
        principal: { subjectId: '477561AD3A89AFCDABB6AFCB71FF54DF', roles: ['master'] },
      }),
    });
    expect(envelope).toContain('Sender: id=477561AD3A89AFCDABB6AFCB71FF54DF roles=master');
  });

  it('describes non-IM turns without fabricating platform or endpoint fields', () => {
    const envelope = buildTurnContextEnvelope({
      turn: turnContext({
        origin: { kind: 'schedule', jobId: 'daily-report' },
        session: { key: 'schedule:daily-report' },
        principal: { subjectId: 'owner', roles: ['trusted'] },
      }),
    });
    expect(envelope).toContain('Session: origin:schedule | job_id:daily-report');
    expect(envelope).toContain('Sender: id=owner roles=trusted');
    expect(envelope).not.toContain('platform:');
    expect(envelope).not.toContain('endpoint:');
  });

  it('prependTurnContextEnvelope 前缀到用户正文', () => {
    const envelope = `${TURN_CONTEXT_BEGIN}\nTime: test\n${TURN_CONTEXT_END}`;
    const out = prependTurnContextEnvelope('hello', envelope);
    expect(out.startsWith(TURN_CONTEXT_BEGIN)).toBe(true);
    expect(out.endsWith('hello')).toBe(true);
  });

  it('applyTurnContextToUserMessages 注入首批 user', () => {
    const envelope = `${TURN_CONTEXT_BEGIN}\ntest\n${TURN_CONTEXT_END}`;
    const [out] = applyTurnContextToUserMessages([createUserMessage('hi')], envelope);
    const text = out.content.find((b) => b.type === 'text');
    expect(text?.type === 'text' && text.text.includes(TURN_CONTEXT_BEGIN)).toBe(true);
    expect(text?.type === 'text' && text.text.includes('hi')).toBe(true);
  });

  it('prependEnvelopeToFirstUserText 保留多模态块', () => {
    const envelope = `${TURN_CONTEXT_BEGIN}\ntest\n${TURN_CONTEXT_END}`;
    const [out] = prependEnvelopeToFirstUserText([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
        timestamp: Date.now(),
      },
    ], envelope);
    expect(out.content).toHaveLength(2);
    const text = out.content[0];
    expect(text?.type === 'text' && text.text.includes(TURN_CONTEXT_BEGIN)).toBe(true);
    expect(out.content[1]?.type).toBe('image_url');
  });
});

function turnContext(overrides: Partial<import('../../src/turn/turn-ingress.js').TurnRequest> = {}) {
  return {
    identity: { traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-1' } as const,
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: 'hello' },
    session: { key: 'http:http-1' },
    policy: { permissions: ['user'], unattended: false },
    signal: new AbortController().signal,
    ports: {},
    ...overrides,
  } satisfies import('../../src/turn/turn-ingress.js').TurnRequest;
}
