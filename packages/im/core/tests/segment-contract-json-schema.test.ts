import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import {
  aiOutboundJsonSchema,
  buildAiOutboundJsonSchema,
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
      { type: 'audio', data: { media: { kind: 'url', value: 'https://x/a.mp3' }, duration: 42 } },
      { type: 'video', data: { media: { kind: 'url', value: 'https://x/v.mp4' }, alt: 'clip' } },
      { type: 'file', data: { media: { kind: 'file', value: 'file-1' }, name: 'a.zip' } },
      { type: 'reply', data: { message_id: 'm-1' } },
      { type: 'face', data: { id: 14 } },
      { type: 'face', data: { id: 'smile', name: '微笑' } },
      { type: 'dice', data: {} },
      { type: 'rps', data: { result: 2 } },
      {
        type: 'share',
        data: {
          url: 'https://example.com/song',
          title: 'Song',
          description: 'Artist',
          audio: 'https://example.com/song.mp3',
          config: { appid: 100495085 },
        },
      },
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
    expect(validateSegment({ type: 'audio', data: { url: 'https://x/a.mp3' } })).toBe(false);
    expect(validateSegment({ type: 'video', data: { url: 'https://x/v.mp4' } })).toBe(false);
    expect(validateSegment({ type: 'file', data: { url: 'https://x/a.zip' } })).toBe(false);
    expect(validateSegment({ type: 'reply', data: {} })).toBe(false);
    expect(validateSegment({ type: 'share', data: { title: 'missing url' } })).toBe(false);
    expect(validateSegment({ type: 'share', data: { url: 'https://example.com' } })).toBe(false);
    expect(validateSegment({ data: { text: 'x' } })).toBe(false);
  });

  it('accepts loose segment types with only top-level shape', () => {
    expect(validateSegment({ type: 'markdown', data: { content: '# t' } })).toBe(true);
  });

  it('keeps a branch for every strict canonical type (anti-drift vs validate.ts)', () => {
    const anyOf = outboundSegmentJsonSchema.anyOf as Array<Record<string, unknown>>;
    const strictBranchTypes = anyOf
      .map((branch) => (branch.properties as Record<string, { const?: string }>).type?.const)
      .filter((v): v is string => typeof v === 'string');
    expect([...strictBranchTypes].sort()).toEqual([...STRICT_OUTBOUND_SEGMENT_TYPES, 'keyboard', 'action'].sort());
    expect(STRICT_OUTBOUND_SEGMENT_TYPES).toEqual([
      'text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward',
      'face', 'dice', 'rps', 'share',
    ]);
  });
});

/** One-message reply envelope. */
const reply = (segments: unknown) => ({ messages: [{ segments }] });

describe('aiOutboundJsonSchema', () => {
  it('accepts ordered chat messages of canonical segments', () => {
    expect(validateOutbound(reply([
      { type: 'mention', data: { target: '1001' } },
      { type: 'text', data: { text: '看这个' } },
      { type: 'markdown', data: { content: '**说明**' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
    ]))).toBe(true);
    expect(validateOutbound({ messages: [
      { segments: [{ type: 'text', data: { text: '调好了' } }] },
      { segments: [{ type: 'text', data: { text: '你再试试' } }] },
    ] })).toBe(true);
    expect(validateOutbound({ messages: [] })).toBe(true);
    expect(validateOutbound({ segments: [{ type: 'text', data: { text: '旧单条格式' } }] })).toBe(false);
    expect(validateOutbound({ text: '你好' })).toBe(false);
    expect(validateOutbound({ mentions: ['1001'], text: '请查收' })).toBe(false);
    expect(validateOutbound({})).toBe(false);
  });

  it('is closed with all fields required throughout the provider-facing schema', () => {
    function check(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(check); return; }
      const node = value as Record<string, unknown>;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
      Object.values(node).forEach(check);
    }
    check(aiOutboundJsonSchema);
  });

  it('rejects malformed segments inside the payload', () => {
    expect(validateOutbound(reply([{ type: 'text', data: {} }]))).toBe(false);
    expect(validateOutbound(reply('not-an-array'))).toBe(false);
    expect(validateOutbound({ messages: 'not-an-array' })).toBe(false);
  });
});

describe('buildAiOutboundJsonSchema', () => {
  const validate = (types: Parameters<typeof buildAiOutboundJsonSchema>[0]) => ajv.compile(buildAiOutboundJsonSchema(types));
  const share = { type: 'share', data: { url: 'https://example.com', title: '链接' } };
  const quickReply = { type: 'keyboard', data: { rows: [[{ label: '详情', payload: '/detail 1' }]] } };

  it('accepts exactly the requested segment types', () => {
    expect(validateOutbound(reply([share]))).toBe(false);
    expect(validate(['text', 'share'])(reply([share]))).toBe(true);
    expect(validate(['text'])(reply([quickReply]))).toBe(false);
    expect(validateOutbound(reply([quickReply]))).toBe(true);
  });

  it('never offers ids the model cannot know', () => {
    const all = validate(['text', 'mention', 'image', 'audio', 'video', 'file', 'markdown', 'keyboard', 'share', 'dice', 'rps']);
    for (const segment of [
      { type: 'reply', data: { message_id: '1' } },
      { type: 'forward', data: { forward_id: '1' } },
      { type: 'face', data: { id: '1' } },
      { type: 'keyboard', data: { rows: [[{ id: 'x', label: 'a', payload: 'b' }]] } },
    ]) expect(all(reply([segment]))).toBe(false);
    expect(all(reply([{ type: 'dice', data: {} }, { type: 'rps', data: {} }]))).toBe(true);
  });
});

describe('compact provider schema', () => {
  it('shares identical media shapes without narrowing kinds or accepting cross-shape fields', () => {
    const all = ['image', 'audio', 'video', 'file'] as const;
    const schema = buildAiOutboundJsonSchema(all);
    const combined = ajv.compile(schema);
    const singles = all.map(type => ajv.compile(buildAiOutboundJsonSchema([type])));
    for (const type of [...all, 'text', 'share']) {
      for (const kind of ['url', 'path', 'base64', 'file', 'invalid']) {
        for (const data of [{ media: { kind, value: 'x' } }, { media: { kind } }, { media: { kind, value: 3 } }, { media: { kind, value: 'x' }, alt: 'a' }]) {
          const value = reply([{ type, data }]);
          expect(combined(value), JSON.stringify(value)).toBe(singles.some(validate => validate(value)));
        }
      }
    }
    expect(JSON.stringify(schema).length).toBeLessThan(1000);
    const extended = ajv.compile(buildAiOutboundJsonSchema(all, { image: { fields: ['alt'] } }));
    expect(extended(reply([{ type: 'image', data: { media: { kind: 'url', value: 'x' }, alt: '' } }]))).toBe(true);
    expect(extended(reply([{ type: 'image', data: { media: { kind: 'url', value: 'x' } } }]))).toBe(false);
    expect(extended(reply([{ type: 'audio', data: { media: { kind: 'url', value: 'x' } } }]))).toBe(true);
    expect(extended(reply([{ type: 'audio', data: { media: { kind: 'url', value: 'x' }, alt: '' } }]))).toBe(false);
  });
});
