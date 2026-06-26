import type { Message } from '../../message.js';
import type { MessageMiddleware } from '../../types.js';
import { getActionFromMessage } from './action.js';
import type { InteractiveHandler, RegisteredInteractiveHandler } from './types.js';

const handlers: RegisteredInteractiveHandler[] = [];
let middlewareInstalled = false;

function findHandler(payload: string): InteractiveHandler | undefined {
  let match: RegisteredInteractiveHandler | undefined;
  for (const entry of handlers) {
    if (payload.startsWith(entry.prefix)) {
      if (!match || entry.prefix.length > match.prefix.length) {
        match = entry;
      }
    }
  }
  return match?.handler;
}

export function registerInteractiveHandler(
  prefix: string,
  handler: InteractiveHandler,
): () => void {
  const entry: RegisteredInteractiveHandler = { prefix, handler };
  handlers.push(entry);
  const dispose = () => {
    const idx = handlers.indexOf(entry);
    if (idx >= 0) handlers.splice(idx, 1);
  };
  return dispose;
}

export function getInteractiveHandlers(): readonly RegisteredInteractiveHandler[] {
  return handlers;
}

export function resetInteractiveHandlersForTests(): void {
  handlers.length = 0;
  middlewareInstalled = false;
}

/** 在根插件上安装一次性 action 路由中间件（幂等） */
export function ensureInteractiveMiddleware(
  addMiddleware: (mw: MessageMiddleware) => () => void,
): void {
  if (middlewareInstalled) return;
  middlewareInstalled = true;
  addMiddleware(async (message, next) => {
    const action = getActionFromMessage(message);
    if (!action) return next();

    const handler = findHandler(action.payload);
    if (!handler) return next();

    const handled = await handler(message);
    if (handled) return;
    return next();
  });
}

export async function dispatchInteractiveAction(message: Message<any>): Promise<boolean> {
  const action = getActionFromMessage(message);
  if (!action) return false;
  const handler = findHandler(action.payload);
  if (!handler) return false;
  return !!(await handler(message));
}
