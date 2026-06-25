/**
 * 出站 `qrcode` 消息段（legacy 导出；新代码请用 rich-segments）。
 * @deprecated 出站渲染由 Adapter.renderSendMessage → resolveRichSegments 统一处理
 */
import type { MessageElement, SendContent } from '../types.js';
import { segment } from '../utils.js';
import { GeneratedQrCode } from './generated-qrcode.js';
import {
  QrcodeSegment,
  readQrcodeSegmentData,
  type QrcodeSegmentData,
} from './rich-segments/qrcode-segment.js';

export type { QrcodeSegmentData };
export { QrcodeSegment, readQrcodeSegmentData };

export type QrcodeOutboundMode = 'image' | 'terminal' | 'text';

function asArray(content: SendContent): (string | MessageElement)[] {
  return Array.isArray(content) ? content : [content];
}

function packSegments(out: (string | MessageElement)[]): SendContent {
  if (out.length === 0) return segment.text('');
  if (out.length === 1) return out[0]!;
  return out;
}

export function hasQrcodeSegment(content: SendContent | undefined): boolean {
  if (content == null) return false;
  return asArray(content).some((item) => typeof item !== 'string' && item?.type === 'qrcode');
}

/** 创建 qrcode 出站段 */
export function qrcodeSegment(
  text: string,
  options: Omit<QrcodeSegmentData, 'text'> = {},
): QrcodeSegment {
  return new QrcodeSegment({ text, ...options });
}

const LEGACY_QRCODE_ONLY_POLICY = {
  qrcode: 'image' as const,
  html: 'origin' as const,
  markdown: 'origin' as const,
};

/** IM 适配器：qrcode → image(data URL + base64) */
export async function resolveQrcodeSegmentsToImages(
  content: SendContent | undefined,
): Promise<SendContent | undefined> {
  if (content == null) return content;
  const { resolveRichSegments } = await import('./rich-segments/index.js');
  return resolveRichSegments(content, LEGACY_QRCODE_ONLY_POLICY);
}

/** process 适配器：终端 ASCII + 文本占位（legacy；process endpoint 现解释 origin qrcode） */
export async function resolveQrcodeSegmentsToTerminal(
  content: SendContent | undefined,
): Promise<SendContent | undefined> {
  if (content == null) return content;
  if (!hasQrcodeSegment(content)) return content;

  const items = asArray(content);
  const out: (string | MessageElement)[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item.type !== 'qrcode') {
      out.push(item);
      continue;
    }

    const payload = readQrcodeSegmentData(item.data ?? {});
    const qr = await GeneratedQrCode.generate(payload.text, payload);
    await qr.printToTerminal({ small: payload.small ?? true });
    out.push(segment.text(`[二维码] ${payload.text}`));
  }

  return packSegments(out);
}

/** 不支持图片的平台：仅输出链接文本 */
export function coerceQrcodeSegmentsToText(content: SendContent): SendContent {
  const items = asArray(content);
  const out: (string | MessageElement)[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item?.type === 'qrcode') {
      const text = typeof item.data?.text === 'string' ? item.data.text : '';
      if (text) out.push(segment.text(`[二维码] ${text}`));
      continue;
    }
    out.push(item);
  }
  return packSegments(out);
}
