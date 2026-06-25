import type { MessageElement } from '../../types.js';
import type { ContentChainLogFields } from '@zhin.js/logger';

/** 内置 kind 常量（外部可增删，registry 为 SSOT） */
export const BUILTIN_RICH_SEGMENT_KINDS = {
  QRCODE: 'qrcode',
  HTML: 'html',
  MARKDOWN: 'markdown',
  TTS: 'tts',
} as const;

export type BuiltinRichSegmentKind =
  (typeof BUILTIN_RICH_SEGMENT_KINDS)[keyof typeof BUILTIN_RICH_SEGMENT_KINDS];

/** 通用 mode 名；各 kind 在 registry 中声明支持的子集 */
export const RICH_SEGMENT_MODE = {
  ORIGIN: 'origin',
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
  URL: 'url',
  AUDIO: 'audio',
  VIDEO: 'video',
} as const;

export type RichSegmentMode = (typeof RICH_SEGMENT_MODE)[keyof typeof RICH_SEGMENT_MODE] | string;

/** 任意已注册 kind → 渲染 mode */
export type OutboundRichSegmentPolicy = Record<string, string>;

/** @deprecated 使用 OutboundRichSegmentPolicy；保留别名便于迁移 */
export type RichSegmentKind = string;
export type RichRenderMode = string;

/** html-renderer 可选包契约 */
export interface HtmlRendererForRichSegment {
  render(
    html: string,
    options?: { width?: number; format?: 'png'; backgroundColor?: string },
  ): Promise<{ format: string; data: Buffer | string }>;
}

/** speech 可选包契约（@zhin.js/speech） */
export interface SpeechPipelineForRichSegment {
  transcribe(input: { data: Buffer; mimeType?: string }): Promise<string>;
  synthesize(input: {
    text: string;
    voice?: string;
    format?: 'mp3' | 'wav';
    speed?: number;
    provider?: string;
  }): Promise<{ data: Buffer; format: 'mp3' | 'wav' }>;
}

/** 未来 media-pipeline / ffmpeg 等 optional 包可复用同一 id */
export type RichSegmentCapabilityId = 'html-renderer' | 'speech' | 'media-pipeline' | string;

export interface RichSegmentRenderContext {
  /** 按 id 懒加载能力（core 或 optional 包 register loader） */
  resolveCapability: <T>(id: RichSegmentCapabilityId) => Promise<T | undefined>;
  /** @deprecated 请用 resolveCapability('html-renderer') */
  getHtmlRenderer?: () => Promise<HtmlRendererForRichSegment | undefined>;
  /** 可选：rich_segment stage 结构化日志 */
  logContentChain?: (fields: ContentChainLogFields) => void;
  warn?: (message: string) => void;
}

export type RichSegmentRenderResult = MessageElement | MessageElement[];

export interface RichSegmentLike {
  readonly segmentType: string;
  render(mode: string, ctx?: RichSegmentRenderContext): Promise<RichSegmentRenderResult>;
}

export interface RichSegmentKindDefinition {
  kind: string;
  /** policy 未指定时使用的 mode */
  defaultMode: string;
  /** 该 kind 支持的 mode 列表（policy 非法值会回退 defaultMode） */
  modes: readonly string[];
  wrap: (data: Record<string, unknown>) => RichSegmentLike;
}

export interface RichSegmentCapabilityLoaderOptions {
  warn?: (message: string) => void;
  getConfig?: () => Record<string, unknown> | undefined;
  logContentChain?: RichSegmentRenderContext['logContentChain'];
}

export type RichSegmentCapabilityLoader = (
  options: RichSegmentCapabilityLoaderOptions,
) => Promise<unknown>;
