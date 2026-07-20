/** Minimal WS surface used by the endpoint (real `ws` or test mock). */
export interface OneBot11WsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void;
}

export interface OneBot11WsCreateOptions {
  readonly headers?: Record<string, string>;
}

export const WS_OPEN = 1;

export interface OneBot11PendingAction {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}
