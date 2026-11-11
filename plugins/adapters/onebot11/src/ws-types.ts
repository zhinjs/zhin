import type { WsConnection } from '@zhin.js/host-http';

/** Minimal WS surface used by the endpoint (real `ws` or test mock). */
export interface OneBot11WsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  ping?(): void;
  on(event: 'open' | 'message' | 'close' | 'error' | 'pong', listener: (...args: unknown[]) => void): void;
}

export interface OneBot11WsCreateOptions {
  readonly headers?: Record<string, string>;
}

export const WS_OPEN = 1;

/**
 * A Host reverse-WebSocket connection seen through the OneBot11WsSocket surface. Protocol
 * keepalive (ping / pong) belongs to the Host transport, so `ping` is absent.
 */
export function socketOfConnection(connection: WsConnection): OneBot11WsSocket {
  let readyState = 1;
  connection.onClose(() => { readyState = 3; });
  const subscriptions = new Map<(...args: unknown[]) => void, () => void>();
  const off = (_event: string, listener: (...args: unknown[]) => void): void => {
    subscriptions.get(listener)?.();
    subscriptions.delete(listener);
  };
  return {
    get readyState() { return readyState; },
    send: (data: string) => connection.send(data),
    close: (code?: number, reason?: string) => connection.close(code, reason),
    terminate: () => connection.close(),
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === 'message') {
        subscriptions.set(listener, connection.onMessage((data) => {
          listener(typeof data === 'string' ? data : Buffer.from(data));
        }));
      } else if (event === 'close') {
        subscriptions.set(listener, connection.onClose((code, reason) => listener(code, reason)));
      }
      // 'error' surfaces as a close on a WsConnection; 'open' already happened.
    },
    off,
    removeListener: off,
  } as OneBot11WsSocket;
}
