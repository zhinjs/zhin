/**
 * Canonical outbound segment 的 JSON Schema SSOT —— 供 AI structured output
 * （AI SDK `Output.object({ schema })`）约束模型直接输出 zhin 消息段数组。
 *
 * 与 validate.ts（@zhin.js/schema 运行时校验）表达同一组约束的 JSON Schema 形态；
 * 严格段类型集合必须与 assert.ts 的 STRICT_CANONICAL_TYPES 保持一致
 * （tests/segment-contract/json-schema.test.ts 有交叉防漂移测试）。
 *
 * 注意：解析侧 parseOutboundSegment 对严格段要求 canonical 形态
 * （如 image 必须携带 data.media: MediaRef），本 schema 与之对齐。
 */

type JsonSchemaObject = Record<string, unknown>;

const platformJsonSchema: JsonSchemaObject = {
  type: 'object',
  additionalProperties: true,
  description: '平台专有字段（一般无需输出）',
};

/** MediaRef（canonical 媒体引用）：types.ts 的 MediaRef 接口 */
export const mediaRefJsonSchema: JsonSchemaObject = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['url', 'path', 'base64'],
      description: 'url=http(s) 链接；path=本地文件路径；base64=内联 base64 数据',
    },
    value: { type: 'string', description: '媒体内容：URL / 文件路径 / 纯 base64' },
    mime_type: { type: 'string', description: '如 image/png、audio/mpeg' },
  },
  required: ['kind', 'value'],
  additionalProperties: false,
};

function strictBranch(
  type: string,
  data: JsonSchemaObject,
): JsonSchemaObject {
  return {
    type: 'object',
    properties: {
      type: { const: type },
      data,
      platform: platformJsonSchema,
    },
    required: ['type', 'data'],
    additionalProperties: false,
  };
}

function dataObject(
  properties: Record<string, JsonSchemaObject>,
  required: readonly string[],
): JsonSchemaObject {
  return { type: 'object', properties, required: [...required], additionalProperties: false };
}

/** 宽松分支：未纳入严格契约的段类型，仅约束顶层形状（与 isCanonicalSegment 宽松路径一致） */
const looseBranch: JsonSchemaObject = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['video', 'audio', 'voice', 'record', 'file', 'link', 'markdown', 'html', 'keyboard', 'action'],
    },
    data: { type: 'object' },
    platform: platformJsonSchema,
  },
  required: ['type', 'data'],
  additionalProperties: false,
};

/** 严格段类型集合（SSOT：assert.ts STRICT_CANONICAL_TYPES） */
export const STRICT_OUTBOUND_SEGMENT_TYPES = [
  'text', 'mention', 'image', 'reply', 'forward', 'face', 'dice', 'rps',
] as const;

/**
 * 单条 outbound 消息段的 JSON Schema。
 * 严格段镜像 validate.ts 的 data 约束；宽松段走 generic 分支。
 */
export const outboundSegmentJsonSchema: JsonSchemaObject = {
  description: 'zhin 消息段 {type, data, platform?}',
  anyOf: [
    strictBranch('text', dataObject({
      text: { type: 'string', description: '文本内容' },
    }, ['text'])),
    strictBranch('mention', dataObject({
      target: { type: 'string', description: '被 @ 用户的平台 id' },
      name: { type: 'string' },
    }, ['target'])),
    strictBranch('image', dataObject({
      media: mediaRefJsonSchema,
      alt: { type: 'string' },
    }, ['media'])),
    strictBranch('reply', dataObject({
      message_id: { type: 'string', description: '被引用消息的平台消息 id' },
    }, ['message_id'])),
    strictBranch('forward', dataObject({
      forward_id: { type: 'string' },
      title: { type: 'string' },
      messages: { type: 'array', items: { type: 'array' } },
    }, ['forward_id'])),
    strictBranch('face', dataObject({
      id: { anyOf: [{ type: 'string' }, { type: 'number' }], description: '平台表情 id' },
      name: { type: 'string' },
    }, ['id'])),
    strictBranch('dice', dataObject({
      result: { type: 'number' },
    }, [])),
    strictBranch('rps', dataObject({
      result: { type: 'number' },
    }, [])),
    looseBranch,
  ],
};

/**
 * AI 结构化出站根对象（ADR 0025 JSON DSL 的 schema 形态）。
 * 与 parseAiOutboundJson / ZhinAiOutboundPayload 对齐：text、mentions、segments
 * 均为可选（provider strict 模式兼容性考虑），"至少一项"由 prompt 与下游校验兜底。
 */
export const aiOutboundJsonSchema: JsonSchemaObject = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: '纯文本回复正文；与 segments 至少输出一项。使用 mentions 时必填',
    },
    mentions: {
      type: 'array',
      items: { type: 'string' },
      description: '要 @ 的会话成员引用（昵称或 id，由宿主解析为平台账号）；需配合 text 使用',
    },
    segments: {
      type: 'array',
      items: outboundSegmentJsonSchema,
      description: 'zhin 消息段数组，如 [{type:"image",data:{media:{kind:"url",value:"https://…"}}},{type:"text",data:{text:"…"}}]',
    },
  },
  additionalProperties: false,
};
