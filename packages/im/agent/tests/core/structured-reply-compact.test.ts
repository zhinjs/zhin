import { describe, expect, it } from 'vitest';
import { AI_OUTBOUND_SEGMENT_TYPES, type AiOutboundSegmentProfile } from '@zhin.js/core';
import { compactStructuredReplyPrompt, decodeStructuredReply, structuredReplySchema } from '../../src/outbound/structured-reply.js';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';

// Required data keys per segment type, as the schema declares them (ADR 0042 §6).
const DATA_KEYS: Record<string, readonly string[]> = {
  text: ['text'], mention: ['target'], image: ['media', 'kind', 'value'], audio: ['media'], video: ['media'], file: ['media'],
  markdown: ['content'], keyboard: ['rows', 'label', 'payload'], share: ['url', 'title'], dice: [], rps: [],
};

const full: AiOutboundSegmentProfile = {
  types: AI_OUTBOUND_SEGMENT_TYPES,
  reaction: { values: [{ value: '76', label: '赞' }] },
};

describe('compact prompt-mode reply schema (ADR 0042 §6)', () => {
  it('covers every segment type of the schema with its data keys', () => {
    const text = compactStructuredReplyPrompt(structuredReplySchema(full), full);
    for (const type of AI_OUTBOUND_SEGMENT_TYPES) {
      expect(text, type).toMatch(new RegExp(`- (?:[a-z]+\\|)*${type}(?:\\|[a-z]+)*: data=`));
      for (const key of DATA_KEYS[type]!) expect(text, `${type}.${key}`).toContain(key);
    }
    expect(text).toContain('"url"|"path"|"base64"|"file"');
    expect(text).toContain('"reaction": ""|"76"');
  });

  it('lists only the offered types and no reaction line without a reaction profile', () => {
    const profile: AiOutboundSegmentProfile = { types: ['text', 'dice'] };
    const text = compactStructuredReplyPrompt(structuredReplySchema(profile), profile);
    expect(text).toContain('- text: data={text:str}');
    expect(text).toContain('- dice: data={}');
    expect(text).not.toContain('mention');
    expect(text).not.toContain('reaction');
  });

  it('mentions adapter-declared extra fields', () => {
    const profile: AiOutboundSegmentProfile = { types: ['text', 'share'], extensions: { share: { fields: ['description'] } } };
    const text = compactStructuredReplyPrompt(structuredReplySchema(profile), profile);
    expect(text).toContain('- share: data={url:str,title:str,description:str}');
    expect(text).toContain('write "" when unknown');
  });

  it('is deterministic and far smaller than the JSON Schema text', () => {
    const schema = structuredReplySchema(full);
    const text = compactStructuredReplyPrompt(schema, full);
    expect(compactStructuredReplyPrompt(schema, full)).toBe(text);
    expect(estimatePromptTokens(text)).toBeLessThan(estimatePromptTokens(JSON.stringify(schema)) / 3);
  });

  it('its example is a reply decodeStructuredReply accepts; the schema stays the validator', () => {
    const text = compactStructuredReplyPrompt(structuredReplySchema(full), full);
    const example = text.split('\n')[1]!;
    expect(decodeStructuredReply(example, full)).toEqual([{ type: 'message', segments: [{ type: 'text', data: { text: '好的' } }] }]);
    expect(() => decodeStructuredReply('{"messages":[{"segments":[{"type":"text","data":{}}]}]}', full)).toThrow();
  });
});
