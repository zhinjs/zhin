/** Minimal WS surface used by the endpoint (real `ws` or test mock). */
export interface MilkyWsSocket {
  readonly readyState: number;
  send?(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void;
}

export interface MilkyWsCreateOptions {
  readonly headers?: Record<string, string>;
}
