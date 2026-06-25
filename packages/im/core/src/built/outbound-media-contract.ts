import type { SendContent } from '../types.js';

/**
 * 出站两阶段契约（Adapter 实现参考）：
 *
 * 1. **resolveRichSegments**（Adapter.renderSendMessage 首步）
 *    语义段（html / tts / qrcode / markdown）→ 标准 IM 段（image / audio / text）
 *
 * 2. **materializeOutboundMedia**（Endpoint.$sendMessage 前，各 adapter 可选）
 *    标准段中的 base64 / 本地路径 → 平台 URL 或上传后的引用
 */

export interface OutboundMediaUploadContext {
  /** 上传二进制，返回平台可发送的 URL */
  uploadBuffer?(buffer: Buffer, mimeHint?: string): Promise<string>;
  /** 上传本地文件路径 */
  uploadFile?(filePath: string): Promise<string>;
  outboundDir?: string;
}

export type OutboundMediaMaterializer = (
  content: SendContent,
  ctx: OutboundMediaUploadContext,
) => Promise<SendContent>;

/** 契约测试：adapter 须声明 outboundRichSegmentPolicy */
export function assertAdapterDeclaresRichSegmentPolicy(
  adapterClass: { outboundRichSegmentPolicy?: Record<string, string> },
): void {
  if (!adapterClass.outboundRichSegmentPolicy) {
    throw new Error('Adapter must declare static outboundRichSegmentPolicy');
  }
  const policy = adapterClass.outboundRichSegmentPolicy;
  if (typeof policy !== 'object' || Object.keys(policy).length === 0) {
    throw new Error('outboundRichSegmentPolicy must be a non-empty object');
  }
}
