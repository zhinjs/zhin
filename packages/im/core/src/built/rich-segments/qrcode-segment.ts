import { segment } from '../../utils.js';
import type { MessageElement } from '../../types.js';
import { GeneratedQrCode, type GenerateQrCodeOptions } from '../generated-qrcode.js';
import { RichSegment } from './base.js';
import type { RichSegmentRenderContext, RichSegmentRenderResult } from './types.js';
import { RICH_SEGMENT_MODE } from './types.js';

export interface QrcodeSegmentData extends GenerateQrCodeOptions {
  text: string;
  /** process origin 模式终端渲染时使用 */
  small?: boolean;
}

export function readQrcodeSegmentData(data: Record<string, unknown>): QrcodeSegmentData {
  const text = typeof data.text === 'string' ? data.text : '';
  if (!text) {
    throw new Error('qrcode segment: missing data.text');
  }
  return {
    text,
    width: typeof data.width === 'number' ? data.width : undefined,
    margin: typeof data.margin === 'number' ? data.margin : undefined,
    errorCorrectionLevel:
      data.errorCorrectionLevel === 'L'
      || data.errorCorrectionLevel === 'M'
      || data.errorCorrectionLevel === 'Q'
      || data.errorCorrectionLevel === 'H'
        ? data.errorCorrectionLevel
        : undefined,
    small: data.small === true ? true : undefined,
  };
}

export class QrcodeSegment extends RichSegment<QrcodeSegmentData> {
  readonly segmentType = 'qrcode' as const;
  readonly type = 'qrcode' as const;

  async render(
    mode: string,
    _ctx?: RichSegmentRenderContext,
  ): Promise<RichSegmentRenderResult> {
    if (mode === RICH_SEGMENT_MODE.ORIGIN) {
      return this.toJSON();
    }

    if (mode === RICH_SEGMENT_MODE.TEXT) {
      return segment.text(`[二维码] ${this.data.text}`);
    }

    if (mode === RICH_SEGMENT_MODE.IMAGE) {
      const qr = await GeneratedQrCode.generate(this.data.text, this.data);
      return segment('image', {
        url: qr.toDataUrl(),
        base64: qr.toString('base64'),
      });
    }

    return this.render(RICH_SEGMENT_MODE.TEXT, _ctx);
  }
}

export function wrapQrcodeSegment(data: Record<string, unknown>): QrcodeSegment {
  return new QrcodeSegment(readQrcodeSegmentData(data));
}

/** process endpoint：origin qrcode 段 → 终端 ASCII + 文本占位 */
export async function interpretOriginQrcodeForProcess(
  content: MessageElement | string | (MessageElement | string)[],
): Promise<MessageElement | string | (MessageElement | string)[]> {
  const items = Array.isArray(content) ? content : [content];
  const out: (MessageElement | string)[] = [];
  let changed = false;

  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item.type !== 'qrcode') {
      out.push(item);
      continue;
    }

    changed = true;
    const payload = readQrcodeSegmentData(item.data ?? {});
    const qr = await GeneratedQrCode.generate(payload.text, payload);
    await qr.printToTerminal({ small: payload.small ?? true });
    out.push(segment.text(`[二维码] ${payload.text}`));
  }

  if (!changed) return content;
  if (out.length === 0) return segment.text('');
  if (out.length === 1) return out[0]!;
  return out;
}
