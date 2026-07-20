/** Minimal WS surface used by the endpoint (real `ws` or test mock). */
export interface OneBot12WsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void;
}

export interface OneBot12WsCreateOptions {
  readonly headers?: Record<string, string>;
}

export const WS_OPEN = 1;

export interface OneBot12PendingAction {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}
