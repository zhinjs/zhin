/** Minimal WS surface used by the endpoint (real `ws` or test mock). */
export interface NapCatWsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  on(event: 'open' | 'message' | 'close' | 'error' | 'pong', listener: (...args: unknown[]) => void): void;
}

export interface NapCatWsCreateOptions {
  readonly headers?: Record<string, string>;
}

export const WS_OPEN = 1;
