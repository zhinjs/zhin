import type { JobContext } from '../types.js';

export type RegisteredHandler = (ctx: JobContext, payload?: unknown) => void | Promise<void>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, RegisteredHandler>();

  register(key: string, handler: RegisteredHandler): this {
    this.handlers.set(key, handler);
    return this;
  }

  get(key: string): RegisteredHandler | undefined {
    return this.handlers.get(key);
  }

  has(key: string): boolean {
    return this.handlers.has(key);
  }
}

export function createHandlerRegistry(entries?: Record<string, RegisteredHandler>): HandlerRegistry {
  const registry = new HandlerRegistry();
  if (entries) {
    for (const [key, handler] of Object.entries(entries)) {
      registry.register(key, handler);
    }
  }
  return registry;
}
