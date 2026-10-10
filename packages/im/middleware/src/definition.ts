/**
 * Middleware authoring API consumed from `zhin.js/middleware`.
 * @module zhin.js/middleware
 */
import type {
  AdapterClient,
  CapabilityContext,
  RegisteredAdapterName,
} from '@zhin.js/feature-kit';
import type { MiddlewareContinuation } from './continuation.js';
export type { MiddlewareContinuation } from './continuation.js';

const middlewareBrand = 'zhin.middleware/1' as const;

export type MiddlewarePhase = 'before-dispatch' | 'after-dispatch';
export type MiddlewareTarget = 'inbound' | 'outbound';
export type MiddlewareNext = () => Promise<MiddlewareContinuation>;
export type OutboundMiddlewareNext = () => Promise<void>;

export interface MiddlewareContext<
  TInput = unknown,
  TConfig = unknown,
  TAdapter extends string | undefined = undefined,
>
  extends CapabilityContext<TConfig> {
  readonly input: TInput;
  /** Lazily resolved native Client. Without `adapter`, its static type is `unknown`. */
  readonly $client: AdapterClient<TAdapter>;
}

/** Shared metadata for the public inbound and outbound definition contracts. */
export interface MiddlewareDefinitionBase<
  TAdapter extends string | undefined = string | undefined,
> {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof middlewareBrand;
  readonly phase: MiddlewarePhase;
  readonly order: number;
  readonly adapter?: TAdapter;
}

export type MiddlewareDefinition<
  TInput = unknown,
  TConfig = unknown,
  TAdapter extends string | undefined = string | undefined,
> = MiddlewareDefinitionBase<TAdapter> & (
  | { readonly target: 'inbound'; handle(context: MiddlewareContext<TInput, TConfig, TAdapter>, next: MiddlewareNext): unknown }
  | { readonly target: 'outbound'; handle(context: MiddlewareContext<TInput, TConfig, TAdapter>, next: OutboundMiddlewareNext): void | Promise<void> }
);

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addMiddleware<TInput = unknown>(
      localName: string,
      definition: MiddlewareDefinition<TInput, TConfig, string | undefined>,
    ): void;
  }
}

/**
 * Define ordered inbound or outbound middleware.
 * Call `next()` to continue the chain; omit it to stop dispatch deliberately.
 *
 * @public
 */
type AuthoringForAdapter<TInput, TConfig, TAdapter extends string | undefined> =
  Omit<MiddlewareDefinitionBase<TAdapter>, '$feature' | 'phase' | 'order'> & {
    readonly phase?: MiddlewarePhase;
    readonly order?: number;
  } & (
    | { readonly target?: 'inbound'; handle(context: MiddlewareContext<TInput, TConfig, TAdapter>, next: MiddlewareNext): unknown }
    | { readonly target: 'outbound'; handle(context: MiddlewareContext<TInput, TConfig, TAdapter>, next: OutboundMiddlewareNext): void | Promise<void> }
  );

type MiddlewareAuthoringDefinition<TInput, TConfig> =
  | AuthoringForAdapter<TInput, TConfig, undefined>
  | {
      [TAdapter in RegisteredAdapterName]: AuthoringForAdapter<TInput, TConfig, TAdapter> & {
        readonly adapter: TAdapter;
      }
    }[RegisteredAdapterName];

export function defineMiddleware<TInput = unknown, TConfig = unknown>(
  definition: Extract<MiddlewareAuthoringDefinition<TInput, TConfig>, { readonly target: 'outbound' }>,
): Readonly<Extract<MiddlewareDefinition<TInput, TConfig>, { readonly target: 'outbound' }>>;
export function defineMiddleware<TInput = unknown, TConfig = unknown>(
  definition: Extract<MiddlewareAuthoringDefinition<TInput, TConfig>, { readonly target?: 'inbound' }>,
): Readonly<Extract<MiddlewareDefinition<TInput, TConfig>, { readonly target: 'inbound' }>>;
export function defineMiddleware<TInput = unknown, TConfig = unknown>(
  definition: MiddlewareAuthoringDefinition<TInput, TConfig>,
): Readonly<MiddlewareDefinition<TInput, TConfig, string | undefined>> {
  if (typeof definition.handle !== 'function') {
    throw new TypeError('Middleware handle must be a function');
  }
  const adapter = (definition as { readonly adapter?: unknown }).adapter;
  if (adapter !== undefined
    && (typeof adapter !== 'string' || adapter.trim() === '')) {
    throw new TypeError('Middleware adapter must be a non-empty string');
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
  return Object.freeze({ ...definition, $feature: middlewareBrand, phase, target, order }) as Readonly<
    MiddlewareDefinition<TInput, TConfig, string | undefined>
  >;
}

/** @internal Runtime validation for convention-discovered modules. */
export function parseMiddlewareDefinition(value: unknown): MiddlewareDefinition {
  if (!value || typeof value !== 'object') throw invalidMiddleware();
  const definition = value as Partial<MiddlewareDefinition>;
  if (
    definition.$feature !== middlewareBrand
    || typeof definition.handle !== 'function'
    || (definition.phase !== 'before-dispatch' && definition.phase !== 'after-dispatch')
    || (definition.target !== 'inbound' && definition.target !== 'outbound')
    || !Number.isSafeInteger(definition.order)
    || !validAdapterName((definition as { readonly adapter?: unknown }).adapter)
  ) throw invalidMiddleware();
  return definition as MiddlewareDefinition;
}

function invalidMiddleware(): TypeError {
  return new TypeError('Middleware module must default-export defineMiddleware(...)');
}

function validAdapterName(adapter: unknown): boolean {
  return adapter === undefined || (typeof adapter === 'string' && adapter.trim() !== '');
}
