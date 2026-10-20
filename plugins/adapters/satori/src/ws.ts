import WebSocket from 'ws';

export const WS_OPEN = 1;

export interface SatoriWsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void;
}

export type CreateSatoriWebSocket = (
  url: string,
  options?: { readonly headers?: Record<string, string> },
) => SatoriWsSocket;

export function defaultCreateWebSocket(
  url: string,
  options?: { readonly headers?: Record<string, string> },
): SatoriWsSocket {
  return new WebSocket(url, { headers: options?.headers }) as unknown as SatoriWsSocket;
}
