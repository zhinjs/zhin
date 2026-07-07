import { z } from 'zod';

export const mediaRefSchema = z.object({
  kind: z.enum(['url', 'path', 'base64']),
  value: z.string(),
  mime_type: z.string().optional(),
});

export const textSegmentSchema = z.object({
  type: z.literal('text'),
  data: z.object({
    text: z.string(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const mentionSegmentSchema = z.object({
  type: z.literal('mention'),
  data: z.object({
    target: z.string(),
    name: z.string().optional(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const imageSegmentSchema = z.object({
  type: z.literal('image'),
  data: z.object({
    media: mediaRefSchema,
    alt: z.string().optional(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const replySegmentSchema = z.object({
  type: z.literal('reply'),
  data: z.object({
    message_id: z.string(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const forwardSegmentSchema = z.object({
  type: z.literal('forward'),
  data: z.object({
    forward_id: z.string(),
    title: z.string().optional(),
    messages: z.array(z.array(z.record(z.string(), z.unknown()))).optional(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const faceSegmentSchema = z.object({
  type: z.literal('face'),
  data: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const diceSegmentSchema = z.object({
  type: z.literal('dice'),
  data: z.object({
    result: z.number().optional(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

export const rpsSegmentSchema = z.object({
  type: z.literal('rps'),
  data: z.object({
    result: z.number().optional(),
  }),
  platform: z.record(z.string(), z.unknown()).optional(),
});

/** 当前已严格校验的 canonical 段（其余 type 由 assert 宽松接受） */
export const canonicalSegmentSchema = z.discriminatedUnion('type', [
  textSegmentSchema,
  mentionSegmentSchema,
  imageSegmentSchema,
  replySegmentSchema,
  forwardSegmentSchema,
  faceSegmentSchema,
  diceSegmentSchema,
  rpsSegmentSchema,
]);

export const segmentArraySchema = z.array(canonicalSegmentSchema);
