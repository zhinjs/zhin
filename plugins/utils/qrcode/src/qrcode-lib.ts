import { generateQrCode } from 'zhin.js/qrcode';

/**
 * Render `text` as a PNG data URL in this process. The content never leaves the host:
 * chat command, Agent tool and Console action all use this same local generator.
 */
export async function buildQrDataUrl(text: string, size = 300): Promise<string> {
  if (!Number.isInteger(size) || size < 64 || size > 1024) throw new TypeError('QR size must be an integer between 64 and 1024');
  return (await generateQrCode(text, { width: size })).toDataUrl();
}

export async function qrImageSegment(text: string, size = 300) {
  return [{ type: 'image' as const, data: { url: await buildQrDataUrl(text, size) } }];
}

/** `scan` hands the image URL to the decoding service: only plain http(s) URLs are forwarded. */
export function isScannableImageUrl(input: string): boolean {
  if (input.length > 2048) return false;
  try {
    const url = new URL(input);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.hostname.includes('.');
  } catch {
    return false;
  }
}
