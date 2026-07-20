import type { CapabilityContext } from '@zhin.js/feature-kit';

const middlewareBrand = 'zhin.middleware/1' as const;

export type MiddlewarePhase = 'before-dispatch' | 'after-dispatch';
export type MiddlewareTarget = 'inbound' | 'outbound';
export type MiddlewareNext = () => Promise<void>;

export interface MiddlewareContext<TInput = unknown, TConfig = unknown>
  extends CapabilityContext<TConfig> {
  readonly input: TInput;
}

export interface MiddlewareDefinition<TInput = unknown, TConfig = unknown> {
  readonly $feature: typeof middlewareBrand;
  readonly phase: MiddlewarePhase;
  readonly target: MiddlewareTarget;
  readonly order: number;
  handle(context: MiddlewareContext<TInput, TConfig>, next: MiddlewareNext): void | Promise<void>;
}

export function defineMiddleware<TInput = unknown, TConfig = unknown>(
  definition: Omit<
    MiddlewareDefinition<TInput, TConfig>,
    '$feature' | 'phase' | 'target' | 'order'
  > & {
    readonly phase?: MiddlewarePhase;
    readonly target?: MiddlewareTarget;
    readonly order?: number;
  },
): Readonly<MiddlewareDefinition<TInput, TConfig>> {
  if (typeof definition.handle !== 'function') {
    throw new TypeError('Middleware handle must be a function');
  }
  const phase = definition.phase ?? 'before-dispatch';
  if (phase !== 'before-dispatch' && phase !== 'after-dispatch') {
    throw new TypeError(`Invalid Middleware phase: ${String(phase)}`);
  }
  const target = definition.target ?? 'inbound';
  if (target !== 'inbound' && target !== 'outbound') {
    throw new TypeError(`Invalid Middleware target: ${String(target)}`);
  }
  const order = definition.order ?? 0;
  if (!Number.isSafeInteger(order)) throw new TypeError('Middleware order must be a safe integer');
  return Object.freeze({ ...definition, $feature: middlewareBrand, phase, target, order });
}

export function parseMiddlewareDefinition(value: unknown): MiddlewareDefinition {
  if (!value || typeof value !== 'object') throw invalidMiddleware();
  const definition = value as Partial<MiddlewareDefinition>;
  if (
    definition.$feature !== middlewareBrand
    || typeof definition.handle !== 'function'
    || (definition.phase !== 'before-dispatch' && definition.phase !== 'after-dispatch')
    || (definition.target !== 'inbound' && definition.target !== 'outbound')
    || !Number.isSafeInteger(definition.order)
  ) throw invalidMiddleware();
  return definition as MiddlewareDefinition;
}

function invalidMiddleware(): TypeError {
  return new TypeError('Middleware module must default-export defineMiddleware(...)');
}
