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
      enum: ['url', 'path', 'base64', 'file'],
      description: 'url=http(s) 链接；path=本地文件路径；base64=内联 base64 数据；file=平台不透明文件引用（如 Telegram file_id）',
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

/** Interactive extension guards validate known fields while preserving platform-specific extras. */
function interactiveDataObject(
  properties: Record<string, JsonSchemaObject>,
  required: readonly string[],
): JsonSchemaObject {
  return { type: 'object', properties, required: [...required], additionalProperties: true };
}

const buttonJsonSchema = interactiveDataObject({
  id: { type: 'string' },
  label: { type: 'string' },
  payload: { type: 'string' },
  disabled: { type: 'boolean' },
  style: { type: 'string', enum: ['primary', 'danger', 'secondary'] },
  mode: { type: 'string', enum: ['callback', 'command'] },
  command: interactiveDataObject({
    enter: { type: 'boolean' },
    reply: { type: 'boolean' },
  }, []),
}, ['id', 'label', 'payload']);

/** 宽松分支：未纳入严格契约的段类型，仅约束顶层形状（与 isCanonicalSegment 宽松路径一致） */
const looseBranch: JsonSchemaObject = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['voice', 'record', 'link', 'markdown', 'html', 'card'],
    },
    data: { type: 'object' },
    platform: platformJsonSchema,
  },
  required: ['type', 'data'],
  additionalProperties: false,
};

/** 严格段类型集合（SSOT：assert.ts STRICT_CANONICAL_TYPES） */
export const STRICT_OUTBOUND_SEGMENT_TYPES = [
  'text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward',
  'face', 'dice', 'rps', 'share',
] as const;

/**
 * 单条 outbound 消息段的 JSON Schema。
 * 严格段镜像 validate.ts，交互段镜像 interactive-segments/types.ts；其他扩展段走宽松分支。
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
    strictBranch('audio', dataObject({
      media: mediaRefJsonSchema,
      duration: { type: 'number' },
    }, ['media'])),
    strictBranch('video', dataObject({
      media: mediaRefJsonSchema,
      duration: { type: 'number' },
      alt: { type: 'string' },
    }, ['media'])),
    strictBranch('file', dataObject({
      media: mediaRefJsonSchema,
      name: { type: 'string' },
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
    strictBranch('share', dataObject({
      url: { type: 'string', description: '分享跳转地址' },
      title: { type: 'string', description: '分享标题' },
      description: { type: 'string', description: '分享摘要' },
      image: { type: 'string', description: '预览图地址' },
      audio: { type: 'string', description: '音频地址' },
      content: { type: 'string', description: '消息列表中的显示文字' },
      artist: { type: 'string', description: '音乐分享的艺术家' },
      duration: { type: 'number', description: '音频时长（秒）' },
      platform: { type: 'string', description: '歌曲所属音乐平台：qq / netease / kugou / kuwo / migu' },
      config: dataObject({
        appid: { type: 'number' },
        package: { type: 'string' },
        sign: { type: 'string' },
        icon: { type: 'string' },
        version: { type: 'string' },
      }, ['appid']),
    }, ['url', 'title'])),
    strictBranch('keyboard', interactiveDataObject({
      rows: { type: 'array', items: { type: 'array', items: buttonJsonSchema } },
      fallback: interactiveDataObject({
        hint: { type: 'string' },
        map: { type: 'object', additionalProperties: { type: 'string' } },
      }, ['hint', 'map']),
    }, ['rows'])),
    strictBranch('action', interactiveDataObject({
      id: { type: 'string' },
      payload: { type: 'string' },
      sourceMessageId: { type: 'string' },
    }, ['id', 'payload'])),
    looseBranch,
  ],
};

/**
 * Provider-facing subset of the canonical contract. Only required fields are
 * exposed: strict structured-output providers require closed objects with all
 * properties required. Optional presentation/platform fields belong to renderers
 * and tools, not to model-generated replies.
 */
function requiredFieldsOnly(schema: JsonSchemaObject): JsonSchemaObject {
  if (schema.type === 'object') {
    const required = (schema.required ?? []) as string[];
    const properties = schema.properties as Record<string, JsonSchemaObject>;
    return {
      type: 'object',
      properties: Object.fromEntries(required.map(key => [key, requiredFieldsOnly(properties[key]!)])),
      required,
      additionalProperties: false,
    };
  }
  if (typeof schema.const === 'string') return { type: 'string', ...schema };
  return schema;
}

/**
 * Segment types a model may author in a final reply. reply / forward / face are
 * left out: they carry platform ids (message, forward, emoji) the model has no
 * reliable source for.
 */
export const AI_OUTBOUND_SEGMENT_TYPES = [
  'text', 'mention', 'image', 'audio', 'video', 'file', 'markdown', 'keyboard', 'share', 'dice', 'rps',
] as const;
export type AiOutboundSegmentType = typeof AI_OUTBOUND_SEGMENT_TYPES[number];

/**
 * Adapter-declared model extension for one segment type (`segments.model`):
 * optional string fields of the canonical segment the model may fill, and a
 * platform hint appended to the reply instruction.
 */
export interface AiSegmentExtension {
  readonly fields?: readonly string[];
  readonly hint?: string;
}
export type AiSegmentExtensions = Readonly<Partial<Record<AiOutboundSegmentType, AiSegmentExtension>>>;

/** Reactions the model may put on the message it answers (platform value + meaning). */
export interface AiReactionProfile {
  readonly values: readonly { readonly value: string; readonly label: string }[];
}

/** What one reply endpoint lets the model author: offered types plus their declared extensions. */
export interface AiOutboundSegmentProfile {
  readonly types: readonly AiOutboundSegmentType[];
  readonly extensions?: AiSegmentExtensions;
  /** Present when the endpoint can react to the current message in this conversation. */
  readonly reaction?: AiReactionProfile;
}

/** Offered when the adapter declares no `segments.supported` list. */
export const DEFAULT_AI_OUTBOUND_SEGMENT_TYPES: readonly AiOutboundSegmentType[] = [
  'text', 'mention', 'image', 'audio', 'video', 'file', 'markdown', 'keyboard',
];

// Concrete closed shapes for renderer extensions; the publisher fills in ids,
// interaction mode and the text fallback for keyboards.
const aiExtensionBranches: Partial<Record<AiOutboundSegmentType, JsonSchemaObject>> = {
  markdown: strictBranch('markdown', dataObject({
    content: { type: 'string', description: 'Markdown source; rendered by the unified outbound pipeline' },
  }, ['content'])),
  keyboard: strictBranch('keyboard', dataObject({
    rows: {
      type: 'array',
      description: 'Quick-reply buttons, at most 5 per row; tapping one sends its payload as the user\'s next message',
      items: {
        type: 'array',
        items: dataObject({
          label: { type: 'string', description: 'Button text' },
          payload: { type: 'string', description: 'Message sent when tapped, e.g. a command' },
        }, ['label', 'payload']),
      },
    },
  }, ['rows'])),
};

/**
 * Promote declared optional string fields to required ones; the model writes ""
 * when it has no value, and the decoder drops those empty fields again.
 */
function withModelFields(branch: JsonSchemaObject, fields: readonly string[]): JsonSchemaObject {
  const branchProperties = branch.properties as Record<string, JsonSchemaObject>;
  const data = branchProperties.data!;
  const properties = data.properties as Record<string, JsonSchemaObject>;
  const extra = fields.filter(field => properties[field]?.type === 'string' && !(data.required as string[]).includes(field));
  return {
    ...branch,
    properties: {
      ...branchProperties,
      data: {
        ...data,
        properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key,
          extra.includes(key) ? { ...value, description: `${value.description ?? key}; "" when unknown` } : value])),
        required: [...(data.required as string[]), ...extra],
      },
    },
  };
}

/** Merge only branches whose complete constraints match apart from the type tag.
 * Inline enums work across strict output providers without introducing $ref dialects.
 */
function mergeEquivalentBranches(branches: JsonSchemaObject[]): JsonSchemaObject[] {
  const groups = new Map<string, { branch: JsonSchemaObject; types: string[] }>();
  for (const branch of branches) {
    const properties = branch.properties as Record<string, JsonSchemaObject>;
    const tag = properties.type!;
    const type = tag.const as string;
    const shape = { ...branch, properties: { ...properties, type: { type: 'string' } } };
    const key = JSON.stringify(shape);
    const group = groups.get(key);
    if (group) {
      if (!group.types.includes(type)) group.types.push(type);
    } else groups.set(key, { branch, types: [type] });
  }
  return [...groups.values()].map(({ branch, types }) => types.length === 1 ? branch : {
    ...branch,
    properties: { ...(branch.properties as object), type: { type: 'string', enum: types } },
  });
}

/**
 * The model's final reply: one or more chat messages, sent in order. Each message
 * is an ordered segment array; the model decides how to split, like a person
 * sending a few short messages. No text/mentions shorthand.
 */
export function buildAiOutboundJsonSchema(
  types: readonly AiOutboundSegmentType[] = DEFAULT_AI_OUTBOUND_SEGMENT_TYPES,
  extensions: AiSegmentExtensions = {},
  reaction?: AiReactionProfile,
): JsonSchemaObject {
  const branches = (outboundSegmentJsonSchema.anyOf as JsonSchemaObject[]).flatMap(branch => {
    const type = (branch.properties as Record<string, { const?: string }>).type?.const as AiOutboundSegmentType | undefined;
    if (type === undefined || type in aiExtensionBranches || !types.includes(type)) return [];
    const fields = extensions[type]?.fields;
    return [fields?.length ? withModelFields(branch, fields) : branch];
  });
  for (const type of types) {
    const branch = aiExtensionBranches[type];
    if (branch) branches.push(branch);
  }
  return {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            segments: {
              type: 'array',
              items: { anyOf: mergeEquivalentBranches(branches.map(requiredFieldsOnly)) },
            },
          },
          required: ['segments'],
          additionalProperties: false,
        },
      },
      // Required with "" for none, like extension fields: strict structured outputs reject optional keys.
      ...(reaction ? {
        reaction: {
          type: 'string',
          enum: ['', ...reaction.values.map(item => item.value)],
          description: 'Reaction to put on the message being answered; "" for none.',
        },
      } : {}),
    },
    required: reaction ? ['messages', 'reaction'] : ['messages'],
    additionalProperties: false,
  };
}

export const aiOutboundJsonSchema: JsonSchemaObject = buildAiOutboundJsonSchema();
