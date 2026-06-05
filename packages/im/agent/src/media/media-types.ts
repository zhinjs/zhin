import type { ContentPart } from '@zhin.js/ai';

export type MediaKind = 'image' | 'audio' | 'video' | 'file';

export interface MediaBinaryPayload {
  kind: MediaKind;
  base64: string;
  mimeType: string;
  fileName?: string;
  meta?: {
    duration?: number;
    alt?: string;
    width?: number;
    height?: number;
    format?: 'wav' | 'mp3';
  };
}

export interface MultimodalConfig {
  enabled: boolean;
  maxFileBytes: number;
  inboundDir: string;
  outboundDir: string;
  image: { maxDimension: number; preferNativeVision: boolean };
  audio: { strategy: 'mcp' | 'plugin-voice' | 'text-only' };
  video: { strategy: 'mcp' | 'text-only'; maxFrames: number };
  outbound: { splitMessages: 'auto' | 'single' | 'always_split' };
}

export const DEFAULT_MULTIMODAL_CONFIG: MultimodalConfig = {
  enabled: true,
  maxFileBytes: 26_214_400,
  inboundDir: 'data/media/inbound',
  outboundDir: 'data/media/outbound',
  image: { maxDimension: 2048, preferNativeVision: true },
  audio: { strategy: 'text-only' },
  video: { strategy: 'text-only', maxFrames: 8 },
  outbound: { splitMessages: 'auto' },
};

export interface PreprocessInboundResult {
  textAppend: string;
  visionParts: ContentPart[];
  payloads: MediaBinaryPayload[];
}

export interface OutboundMediaCapabilities {
  image?: boolean;
  audio?: boolean;
  video?: boolean;
  file?: boolean;
  maxAttachmentBytes?: number;
}

export const DEFAULT_OUTBOUND_CAPABILITIES: OutboundMediaCapabilities = {
  image: true,
  audio: true,
  video: true,
  file: true,
  maxAttachmentBytes: 26_214_400,
};
