import {
  defineMiddleware,
  type MiddlewareDefinition,
  type MiddlewareNext,
  type MiddlewarePhase,
  type MiddlewareTarget,
} from '@zhin.js/next-feature-middleware';

export type LegacyMiddleware<TInput = unknown> = (
  input: TInput,
  next: MiddlewareNext,
) => void | Promise<void>;

export interface LegacyMiddlewareOptions {
  readonly phase?: MiddlewarePhase;
  readonly target?: MiddlewareTarget;
  readonly order?: number;
}

/** Adapts only callback shape; it does not recreate a global Plugin registry. */
export function defineLegacyMiddleware<TInput = unknown, TConfig = unknown>(
  middleware: LegacyMiddleware<TInput>,
  options: LegacyMiddlewareOptions = {},
): Readonly<MiddlewareDefinition<TInput, TConfig>> {
  if (typeof middleware !== 'function') {
    throw new TypeError('Legacy Middleware must be a function');
  }
  return defineMiddleware<TInput, TConfig>({
    ...options,
    handle: ({ input }, next) => middleware(input, next),
  });
}
