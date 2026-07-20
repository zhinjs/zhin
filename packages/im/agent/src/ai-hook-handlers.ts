/**
 * Module-level `registerAIHook` handler registry (legacy + Runtime shared).
 */
import { getLogger } from '@zhin.js/logger';
import type { AIHookEvent, AIHookHandler } from './orchestrator/types.js';

const logger = getLogger('AIHook');
const handlers = new Map<string, AIHookHandler[]>();

export function registerModuleAIHook(eventKey: string, handler: AIHookHandler): () => void {
  if (!handlers.has(eventKey)) {
    handlers.set(eventKey, []);
  }
  handlers.get(eventKey)!.push(handler);
  return () => unregisterModuleAIHook(eventKey, handler);
}

export function unregisterModuleAIHook(eventKey: string, handler: AIHookHandler): void {
  const eventHandlers = handlers.get(eventKey);
  if (!eventHandlers) return;
  const index = eventHandlers.indexOf(handler);
  if (index !== -1) eventHandlers.splice(index, 1);
  if (eventHandlers.length === 0) handlers.delete(eventKey);
}

export function clearModuleAIHooks(): void {
  handlers.clear();
}

export function getRegisteredModuleAIHookKeys(): string[] {
  return Array.from(handlers.keys());
}

/** Run `registerAIHook` handlers for type + type:action (errors isolated). */
export async function runModuleAIHookHandlers(event: AIHookEvent): Promise<void> {
  const typeHandlers = handlers.get(event.type) ?? [];
  const specificHandlers = handlers.get(`${event.type}:${event.action}`) ?? [];
  const allHandlers = [...typeHandlers, ...specificHandlers];
  if (allHandlers.length === 0) return;

  for (const handler of allHandlers) {
    try {
      await handler(event);
    } catch (err: unknown) {
      logger.error(`Hook 错误 [${event.type}:${event.action}]: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
