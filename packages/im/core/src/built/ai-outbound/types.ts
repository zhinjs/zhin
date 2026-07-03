import type { Message } from '../../message.js';
import type { MessageElement } from '../../types.js';
import type { InteractivePolicy } from '../interactive-segments/types.js';

/** AI 结构化出站 payload — 平台无关 DSL（Adapter extensions 承载平台特有段）。 */
export interface ZhinAiOutboundPayload {
  text?: string;
  mentions?: string[];
  segments?: AiOutboundSegment[];
  extensions?: Record<string, unknown>;
}

export interface AiOutboundSegment {
  kind: string;
  mode?: string;
  data?: Record<string, unknown>;
}

export interface AiOutboundCapabilities {
  mentions?: boolean;
  richSegments?: readonly string[];
  interactive?: InteractivePolicy;
}

export interface AiOutboundExtensionDefinition {
  /** 平台扩展字段名，如 qq.ark / onebot.keyboard */
  key: string;
  /** JSON Schema 子集，对齐平台 SDK 文档 */
  schema: Record<string, unknown>;
  examples: readonly string[];
  toMessageElements?: (
    ext: unknown,
    ctx: AiOutboundParseContext,
  ) => MessageElement[] | Promise<MessageElement[]>;
}

export interface AiOutboundMentionResolver {
  (ref: string): string | undefined;
}

export interface AiOutboundAtIdResolver {
  (endpointId: string): string;
}

/** 解析 AI 出站 JSON 时的上下文。 */
export interface AiOutboundParseContext {
  message: Message;
  /** 将 peer ref（role/endpoint/primary）解析为 endpointId */
  mentionResolver?: AiOutboundMentionResolver;
  /** 将 endpointId 解析为 platform @ id */
  atIdResolver?: AiOutboundAtIdResolver;
  /** Adapter 声明的 extensions（运行时从 Adapter 静态属性注入） */
  extensions?: readonly AiOutboundExtensionDefinition[];
}

export interface StructuredOutboundDetectInput {
  /** 协作 Cell 活跃且可能 @ peer */
  collaborationCell?: boolean;
  /** 工具链要求结构化出站（如 group_delegate message JSON） */
  toolRequiresStructured?: boolean;
  /** 用户入站含 handoff / @ 意图 */
  inboundHandoffIntent?: boolean;
  /** Adapter 声明 extensions 且非空 */
  adapterHasExtensions?: boolean;
}

export const DEFAULT_AI_OUTBOUND_CAPABILITIES: AiOutboundCapabilities = {
  mentions: true,
  richSegments: ['qrcode', 'html', 'markdown', 'tts'],
  interactive: 'text',
};
