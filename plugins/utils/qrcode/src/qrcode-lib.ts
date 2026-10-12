const QR_API_BASE = 'https://api.qrserver.com/v1';

export function buildQrImageUrl(text: string, size = 300): string {
  return `${QR_API_BASE}/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

export function qrImageSegment(text: string) {
  const qrUrl = buildQrImageUrl(text);
  return [{ type: 'image' as const, data: { url: qrUrl } }];
}
