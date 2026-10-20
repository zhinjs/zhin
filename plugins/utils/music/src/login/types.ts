export type QrLoginSource = 'qq' | 'netease';

export interface QrPollResult {
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
  message: string;
  cookie?: string;
}

export interface QrCreateResult {
  imageSegment: { type: 'image'; data: Record<string, unknown> };
  pollData: Record<string, string>;
}

export interface QrLoginProvider {
  createQr(): Promise<QrCreateResult>;
  pollQr(pollData: Record<string, string>): Promise<QrPollResult>;
}

export function extractSetCookies(headers: Headers): string {
  const raw = headers.getSetCookie?.() ?? [];
  const cookies: string[] = [];
  for (const entry of raw) {
    const match = entry.match(/^([^;]+)/);
    if (match) cookies.push(match[1]!);
  }
  return cookies.join('; ');
}
