import { describe, it, expect } from 'vitest';
import {
  parseAiOutboundJson,
  parseOutboundSegment,
  extractEmbeddedAiOutboundJson,
  rewritePlainTextMentions,
  buildAiOutboundPromptHint,
  detectInboundHandoffIntent,
  isStructuredOutboundRequired,
  resolveAiOutboundToMessageElements,
} from '../../src/built/ai-outbound/index.js';
import type { Message } from '../../src/message.js';

const stubMessage = { $adapter: 'sandbox', $endpoint: 'ep1' } as Message;

describe('parseOutboundSegment', () => {
  it('parses canonical segment', () => {
    expect(parseOutboundSegment({ type: 'text', data: { text: 'hi' } })).toEqual({
      type: 'text',
      data: { text: 'hi' },
    });
  });

  it('maps legacy kind to type', () => {
    expect(parseOutboundSegment({ kind: 'mention', data: { target: '1' } })).toEqual({
      type: 'mention',
      data: { target: '1' },
    });
  });
});

describe('parseAiOutboundJson', () => {
  it('parses mentions and text', () => {
    expect(parseAiOutboundJson('{"mentions":["researcher"],"text":"hello"}')).toEqual({
      text: 'hello',
      mentions: ['researcher'],
      segments: undefined,
      extensions: undefined,
    });
  });

  it('parses fenced JSON', () => {
    expect(parseAiOutboundJson('```json\n{"text":"hi"}\n```')).toEqual({
      text: 'hi',
      mentions: undefined,
      segments: undefined,
      extensions: undefined,
    });
  });

  it('parses canonical segments array', () => {
    expect(parseAiOutboundJson(JSON.stringify({
      segments: [
        { type: 'text', data: { text: 'a' } },
        { kind: 'mention', data: { target: '9' } },
      ],
    }))).toEqual({
      text: undefined,
      mentions: undefined,
      segments: [
        { type: 'text', data: { text: 'a' } },
        { type: 'mention', data: { target: '9' } },
      ],
      extensions: undefined,
    });
  });
});

describe('extractEmbeddedAiOutboundJson', () => {
  it('splits prose and trailing JSON mentions', () => {
    const plain = `很好！Researcher已经完成了自我介绍。现在继续邀请下一位成员。

{"mentions":["1689919782"],"text":"你好，Evaluator！请向大家做一个简单的自我介绍。"}`;
    expect(extractEmbeddedAiOutboundJson(plain)).toEqual({
      prose: '很好！Researcher已经完成了自我介绍。现在继续邀请下一位成员。',
      jsonRaw: '{"mentions":["1689919782"],"text":"你好，Evaluator！请向大家做一个简单的自我介绍。"}',
    });
  });

  it('splits prose and fenced JSON handback block', () => {
    const plain = `已通过公开回复完成自我介绍。交还给 Planner。

\`\`\`json
{"mentions":["planner"],"text":"已完成：研究员的自我介绍已公开回复。"}
\`\`\``;
    expect(extractEmbeddedAiOutboundJson(plain)).toEqual({
      prose: '已通过公开回复完成自我介绍。交还给 Planner。',
      jsonRaw: '{"mentions":["planner"],"text":"已完成：研究员的自我介绍已公开回复。"}',
    });
  });
});

describe('rewritePlainTextMentions', () => {
  const resolver = (ref: string) => (ref === 'researcher' ? '210723495' : undefined);

  it('extracts @researcher from markdown body', () => {
    const plain = `好的，我先自我介绍！

@researcher 请先来～`;
    expect(rewritePlainTextMentions(plain, resolver)).toEqual({
      mentions: ['researcher'],
      text: '好的，我先自我介绍！\n\n 请先来～',
    });
  });

  it('returns null when no roster match', () => {
    expect(rewritePlainTextMentions('@unknown hi', resolver)).toBeNull();
  });
});

describe('detectInboundHandoffIntent', () => {
  it('detects handoff keywords', () => {
    expect(detectInboundHandoffIntent('@8596238 叫大家依次做个自我介绍')).toBe(true);
    expect(detectInboundHandoffIntent('hello')).toBe(false);
  });
});

describe('isStructuredOutboundRequired', () => {
  it('true when collaboration cell', () => {
    expect(isStructuredOutboundRequired({ collaborationCell: true })).toBe(true);
  });
});

describe('buildAiOutboundPromptHint', () => {
  it('includes force json line', () => {
    const hint = buildAiOutboundPromptHint({ forceJsonOnly: true });
    expect(hint).toContain('MUST reply with JSON only');
  });
});

describe('resolveAiOutboundToMessageElements', () => {
  const ctx = {
    message: stubMessage,
    mentionResolver: (ref: string) => (ref === 'researcher' ? 'ep-researcher' : undefined),
    atIdResolver: (endpointId: string) => `qq:${endpointId}`,
  };

  it('resolves mentions to canonical mention segments', async () => {
    const result = await resolveAiOutboundToMessageElements(
      { mentions: ['researcher'], text: 'hello' },
      ctx,
    );
    expect(result).toEqual([
      { type: 'mention', data: { target: 'qq:ep-researcher' } },
      { type: 'text', data: { text: ' hello' } },
    ]);
  });

  it('consumes payload.segments and filters AI-only types', async () => {
    const result = await resolveAiOutboundToMessageElements(
      {
        text: 'visible',
        segments: [
          { type: 'thinking', data: { text: 'hidden' } },
          { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
        ],
      },
      { message: stubMessage },
    );
    expect(result).toEqual([
      { type: 'text', data: { text: 'visible' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
    ]);
  });

  it('appends extension segments', async () => {
    const result = await resolveAiOutboundToMessageElements(
      { text: 'hi', extensions: { 'test.ext': { foo: 1 } } },
      {
        message: stubMessage,
        extensions: [{
          key: 'test.ext',
          schema: {},
          examples: ['{}'],
          toMessageElements: () => [{ type: 'text', data: { text: ' ext' } }],
        }],
      },
    );
    expect(result).toEqual([
      { type: 'text', data: { text: 'hi' } },
      { type: 'text', data: { text: ' ext' } },
    ]);
  });
});
