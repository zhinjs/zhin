/**
 * Middleware authoring API consumed from `zhin.js/middleware`.
 * @module zhin.js/middleware
 */
import type {
  AdapterClient,
  OperationSession,
  CapabilityContext,
  RegisteredAdapterName,
} from '@zhin.js/feature-kit';
import { assertPermitSyntax } from '@zhin.js/permission';
import type { MiddlewareContinuation } from './continuation.js';
export type { MiddlewareContinuation } from './continuation.js';

const middlewareBrand = 'zhin.middleware/1' as const;

export type MiddlewarePhase = 'before-dispatch' | 'after-dispatch';
export type MiddlewareTarget = 'inbound' | 'outbound';
export type MiddlewareNext = () => Promise<MiddlewareContinuation>;
export type OutboundMiddlewareNext = () => Promise<void>;

export interface InboundDispatchSummary {
  readonly matched: boolean;
  readonly path: 'button' | 'command' | 'handler' | 'none';
  readonly handlerId?: string;
  readonly replied: boolean;
}

export interface MiddlewareContext<
  TInput = unknown,
  TConfig = unknown,
  TAdapter extends string | undefined = undefined,
>
  extends CapabilityContext<TConfig> {
  readonly input: TInput;
  /** Lazily resolved native Client. Without `adapter`, its static type is `unknown`. */
  readonly $client: AdapterClient<TAdapter>;
  readonly session: OperationSession<TAdapter> | undefined;
  readonly dispatch?: InboundDispatchSummary;
  onAfterDispatch?(listener: (summary: InboundDispatchSummary) => void | Promise<void>): void;
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
  /**
   * Inbound only (ADR 0056 §5): built-in permit expressions, the same evaluator as commands and
   * Agent tools (sender zhin role, sender platform standing, `bot:*` Bot standing). When the
   * message does not satisfy them the middleware is skipped for that message and the chain
   * continues; no reply is sent. The Bot's own standing is read from the cache only (no platform
   * lookup per message): unknown means `bot:*` is unmet.
   */
  readonly permit?: readonly string[];
}

export type MiddlewareDefinition<
  TInput = unknown,
  TConfig = unknown,
  TAdapter extends string | undefined = string | undefined,
> = MiddlewareDefinitionBase<TAdapter> & (
  | { readonly target: 'inbound'; handle(context: MiddlewareContext<TInput, TConfig, TAdapter>, next: MiddlewareNext): unknown }
  | { readonly target: 'outbound';
      /** Opt in to cumulative prefixes. Previously published text, format and addressing must stay stable. */
      readonly incremental?: true;
      handle(context: MiddlewareContext<TInput, TConfig, TAdapter>, next: OutboundMiddlewareNext): void | Promise<void> }
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
    readonly stage?: MiddlewarePhase;
    readonly order?: number;
  } & (
    | { readonly target?: 'inbound'; handle(this: MiddlewareContext<TInput, TConfig, TAdapter>, context: MiddlewareContext<TInput, TConfig, TAdapter>, next: MiddlewareNext): unknown }
    | {
        readonly target: 'outbound';
        /** Opt in to cumulative prefixes. Previously published text, format and addressing must stay stable;
         * do not repeat approvals, external sends or other side effects. */
        readonly incremental?: true;
        handle(this: MiddlewareContext<TInput, TConfig, TAdapter>, context: MiddlewareContext<TInput, TConfig, TAdapter>, next: OutboundMiddlewareNext): void | Promise<void>;
      }
  );

/** @internal Shape shared with the typed IM facade; not a separate authoring API. */
export type MiddlewareAuthoringDefinition<TInput, TConfig> =
  | AuthoringForAdapter<TInput, TConfig, undefined>
  | {
      [TAdapter in RegisteredAdapterName]: AuthoringForAdapter<TInput, TConfig, TAdapter> & {
        readonly adapter: TAdapter;
      }
    }[RegisteredAdapterName];

/**
 * Returned by `defineMiddleware.withConfig<Config>()`: fixes the plugin config type while
 * keeping inbound/outbound input inference intact.
 *
 * @public
 */
export interface MiddlewareDefiner<TConfig> {
  <TInput = unknown>(
    definition: Extract<MiddlewareAuthoringDefinition<TInput, TConfig>, { readonly target: 'outbound' }>,
  ): Readonly<Extract<MiddlewareDefinition<TInput, TConfig>, { readonly target: 'outbound' }>>;
  <TInput = unknown>(
    definition: Extract<MiddlewareAuthoringDefinition<TInput, TConfig>, { readonly target?: 'inbound' }>,
  ): Readonly<Extract<MiddlewareDefinition<TInput, TConfig>, { readonly target: 'inbound' }>>;
}

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
  const phase = definition.phase ?? (definition as { readonly stage?: MiddlewarePhase }).stage ?? 'before-dispatch';
  if (phase !== 'before-dispatch' && phase !== 'after-dispatch') {
    throw new TypeError(`Invalid Middleware phase: ${String(phase)}`);
  }
  const target = definition.target ?? 'inbound';
  if (target !== 'inbound' && target !== 'outbound') {
    throw new TypeError(`Invalid Middleware target: ${String(target)}`);
  }
  const order = definition.order ?? 0;
  if (!Number.isSafeInteger(order)) throw new TypeError('Middleware order must be a safe integer');
  const permit = (definition as { readonly permit?: unknown }).permit;
  if (permit !== undefined) {
    if (!Array.isArray(permit) || !permit.every(item => typeof item === 'string')) throw new TypeError('Middleware permit must be a string array');
    if (target !== 'inbound' && permit.length) throw new TypeError('Middleware permit applies to inbound middleware only');
    assertPermitSyntax(permit, 'Middleware');
  }
  return Object.freeze({ ...definition, ...(permit !== undefined ? { permit: Object.freeze([...permit as string[]]) } : {}),
    $feature: middlewareBrand, phase, target, order }) as Readonly<
    MiddlewareDefinition<TInput, TConfig, string | undefined>
  >;
}

/**
 * Fix the plugin config type first, then define the middleware.
 */
defineMiddleware.withConfig = function withConfig<TConfig = unknown>(): MiddlewareDefiner<TConfig> {
  return ((definition: MiddlewareAuthoringDefinition<unknown, TConfig>) =>
    defineMiddleware(definition as never)) as MiddlewareDefiner<TConfig>;
};

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
