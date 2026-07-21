import type { ServerResponse } from 'node:http';

/**
 * Console 实时事件枢纽（Plugin Runtime Host 的 `/api/events` SSE 事件源）。
 * 单进程内 fan-out：`publish` 向所有已订阅的 SSE response 写帧；
 * write 失败或连接断开自动摘除订阅。
 */
export interface ConsoleEventHub {
  publish(type: string, data: unknown): void;
  /** 订阅事件流；返回 unsubscribe。连接断开时也会自动摘除。 */
  subscribe(response: ServerResponse): () => void;
  readonly subscriberCount: number;
}

export function createConsoleEventHub(): ConsoleEventHub {
  let nextId = 0;
  const subscribers = new Set<ServerResponse>();

  const remove = (response: ServerResponse): void => {
    subscribers.delete(response);
  };

  return {
    get subscriberCount() {
      return subscribers.size;
    },
    publish(type, data) {
      nextId += 1;
      const frame = `id: ${nextId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const response of [...subscribers]) {
        try {
          response.write(frame, (error) => {
            if (error) remove(response);
          });
        } catch {
          remove(response);
        }
      }
    },
    subscribe(response) {
      subscribers.add(response);
      response.once('close', () => remove(response));
      response.once('error', () => remove(response));
      return () => remove(response);
    },
  };
}
