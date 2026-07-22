import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import {
  aiOutboundJsonSchema,
  outboundSegmentJsonSchema,
  STRICT_OUTBOUND_SEGMENT_TYPES,
} from '../src/built/segment-contract/json-schema.js';
import { isStrictCanonicalSegment } from '../src/built/segment-contract/validate.js';

const ajv = new Ajv({ allErrors: true });
const validateSegment = ajv.compile(outboundSegmentJsonSchema);
const validateOutbound = ajv.compile(aiOutboundJsonSchema);

describe('outboundSegmentJsonSchema', () => {
  it('accepts strict canonical segments (text / mention / image / reply / face)', () => {
    const valid = [
      { type: 'text', data: { text: 'hi' } },
      { type: 'mention', data: { target: '1001' } },
      { type: 'mention', data: { target: '1001', name: 'alice' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
      { type: 'image', data: { media: { kind: 'base64', value: 'aGVsbG8=', mime_type: 'image/png' }, alt: 'p' } },
      { type: 'reply', data: { message_id: 'm-1' } },
      { type: 'face', data: { id: 14 } },
      { type: 'face', data: { id: 'smile', name: '微笑' } },
      { type: 'dice', data: {} },
      { type: 'rps', data: { result: 2 } },
    ];
    for (const seg of valid) {
      expect(validateSegment(seg), JSON.stringify(validateSegment.errors)).toBe(true);
      // 与运行时校验器双口径一致（dice/rps 无 result 字段时 data 为空对象，strict schema 要求 data 存在）
      expect(isStrictCanonicalSegment(seg)).toBe(true);
    }
  });

  it('rejects segments missing required data fields', () => {
    expect(validateSegment({ type: 'text', data: {} })).toBe(false);
    expect(validateSegment({ type: 'mention', data: {} })).toBe(false);
    // image 必须是 canonical media 形态（legacy url/base64 直挂 data 不被解析侧接受）
    expect(validateSegment({ type: 'image', data: { url: 'https://x/y.png' } })).toBe(false);
    expect(validateSegment({ type: 'image', data: {} })).toBe(false);
    expect(validateSegment({ type: 'reply', data: {} })).toBe(false);
    expect(validateSegment({ data: { text: 'x' } })).toBe(false);
  });

  it('accepts loose segment types with only top-level shape', () => {
    expect(validateSegment({ type: 'video', data: { url: 'https://x/v.mp4' } })).toBe(true);
    expect(validateSegment({ type: 'file', data: { url: 'https://x/a.zip', name: 'a.zip' } })).toBe(true);
    expect(validateSegment({ type: 'markdown', data: { content: '# t' } })).toBe(true);
  });

  it('keeps a branch for every strict canonical type (anti-drift vs validate.ts)', () => {
    const anyOf = outboundSegmentJsonSchema.anyOf as Array<Record<string, unknown>>;
    const strictBranchTypes = anyOf
      .map((branch) => (branch.properties as Record<string, { const?: string }>).type?.const)
      .filter((v): v is string => typeof v === 'string');
    expect([...strictBranchTypes].sort()).toEqual([...STRICT_OUTBOUND_SEGMENT_TYPES].sort());
    expect(STRICT_OUTBOUND_SEGMENT_TYPES).toEqual([
      'text', 'mention', 'image', 'reply', 'forward', 'face', 'dice', 'rps',
    ]);
  });
});

describe('aiOutboundJsonSchema', () => {
  it('accepts the ADR 0025 outbound DSL shapes', () => {
    expect(validateOutbound({ text: '你好' })).toBe(true);
    expect(validateOutbound({ mentions: ['1001'], text: '请查收' })).toBe(true);
    expect(validateOutbound({
      segments: [
        { type: 'text', data: { text: '看图' } },
        { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
      ],
    })).toBe(true);
    expect(validateOutbound({
      text: '组合',
      segments: [{ type: 'mention', data: { target: '1001' } }],
    })).toBe(true);
  });

  it('rejects malformed segments inside the payload', () => {
    expect(validateOutbound({ segments: [{ type: 'text', data: {} }] })).toBe(false);
    expect(validateOutbound({ segments: 'not-an-array' })).toBe(false);
    expect(validateOutbound({ mentions: 'not-an-array' })).toBe(false);
  });
});
