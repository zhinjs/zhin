import { Schema } from '@zhin.js/schema';
import type { MediaRef, Segment } from './types.js';

const platformSchema = Schema.dict(Schema.any());

const mediaKindSchema = Schema.union([
  Schema.const('url'),
  Schema.const('path'),
  Schema.const('base64'),
]);
export const mediaRefSchema = Schema.object({
  kind: mediaKindSchema.required() as unknown as Schema,
  value: Schema.string().required(),
  mime_type: Schema.string(),
});

export const textSegmentSchema = Schema.object({
  type: Schema.const('text'),
  data: Schema.object({ text: Schema.string().required() }).required(),
  platform: platformSchema,
});

export const mentionSegmentSchema = Schema.object({
  type: Schema.const('mention'),
  data: Schema.object({
    target: Schema.string().required(),
    name: Schema.string(),
  }).required(),
  platform: platformSchema,
});

export const imageSegmentSchema = Schema.object({
  type: Schema.const('image'),
  data: Schema.object({
    media: mediaRefSchema.required(),
    alt: Schema.string(),
  }).required(),
  platform: platformSchema,
});

export const replySegmentSchema = Schema.object({
  type: Schema.const('reply'),
  data: Schema.object({ message_id: Schema.string().required() }).required(),
  platform: platformSchema,
});

export const forwardSegmentSchema = Schema.object({
  type: Schema.const('forward'),
  data: Schema.object({
    forward_id: Schema.string().required(),
    title: Schema.string(),
    messages: Schema.list(Schema.list(Schema.any())),
  }).required(),
  platform: platformSchema,
});

const stringOrNumberSchema = Schema.union([
  Schema.string(),
  Schema.number(),
]);

export const faceSegmentSchema = Schema.object({
  type: Schema.const('face'),
  data: Schema.object({
    id: stringOrNumberSchema.required() as unknown as Schema,
    name: Schema.string(),
  }).required(),
  platform: platformSchema,
});

export const diceSegmentSchema = Schema.object({
  type: Schema.const('dice'),
  data: Schema.object({ result: Schema.number() }).required(),
  platform: platformSchema,
});

export const rpsSegmentSchema = Schema.object({
  type: Schema.const('rps'),
  data: Schema.object({ result: Schema.number() }).required(),
  platform: platformSchema,
});

export const canonicalSegmentSchema = Schema.discriminatedUnion('type', {
  text: {
    data: Schema.object({ text: Schema.string().required() }).required(),
    platform: platformSchema,
  },
  mention: {
    data: Schema.object({
      target: Schema.string().required(),
      name: Schema.string(),
    }).required(),
    platform: platformSchema,
  },
  image: {
    data: Schema.object({
      media: mediaRefSchema.required(),
      alt: Schema.string(),
    }).required(),
    platform: platformSchema,
  },
  reply: {
    data: Schema.object({ message_id: Schema.string().required() }).required(),
    platform: platformSchema,
  },
  forward: {
    data: Schema.object({
      forward_id: Schema.string().required(),
      title: Schema.string(),
      messages: Schema.list(Schema.list(Schema.any())),
    }).required(),
    platform: platformSchema,
  },
  face: {
    data: Schema.object({
      id: stringOrNumberSchema.required() as unknown as Schema,
      name: Schema.string(),
    }).required(),
    platform: platformSchema,
  },
  dice: {
    data: Schema.object({ result: Schema.number() }).required(),
    platform: platformSchema,
  },
  rps: {
    data: Schema.object({ result: Schema.number() }).required(),
    platform: platformSchema,
  },
});

export const segmentArraySchema = Schema.list(canonicalSegmentSchema);

export function isMediaRef(value: unknown): value is MediaRef {
  return mediaRefSchema.safeParse(value).success;
}

/** 严格 canonical 段校验（@zhin.js/schema validate-only） */
export function isStrictCanonicalSegment(value: unknown): value is Segment {
  return canonicalSegmentSchema.safeParse(value).success;
}
