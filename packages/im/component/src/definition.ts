/**
 * Component authoring API consumed from `zhin.js/component`.
 * @module zhin.js/component
 */
import type { PluginNodeSnapshot, Token } from '@zhin.js/plugin-runtime';
import type { CapabilityContext } from '@zhin.js/feature-kit';

const componentBrand = 'zhin.component/1' as const;

export interface ComponentContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly requester: PluginNodeSnapshot;
}

/**
 * A stand-in service for `zhin preview`: what `context.use(token)` / `context.has(token)` return
 * while the component is previewed outside a running instance. Never used at runtime.
 *
 * @public
 */
export interface ComponentPreviewService<T = unknown> {
  readonly token: Token<T>;
  readonly value: T;
}

export interface ComponentDefinition<
  TProps = unknown,
  TResult = unknown,
  TConfig = unknown,
> {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof componentBrand;
  /** Optional, public example parameters for interactive previews. Do not include secrets. */
  readonly previewProps?: TProps;
  /**
   * Optional stand-in services for previews (`zhin preview`), the counterpart of `previewProps`
   * for `context.use(token)`. A preview that reads a token not listed here fails with a message
   * naming the token. Runtime rendering always uses the real plugin services. Do not include secrets.
   */
  readonly previewServices?: readonly ComponentPreviewService[];
  render(props: TProps, context: ComponentContext<TConfig>): TResult | Promise<TResult>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addComponent<TProps = unknown, TResult = unknown>(
      localName: string,
      definition: ComponentDefinition<TProps, TResult, TConfig>,
    ): void;
  }
}

/**
 * Returned by `defineComponent.withConfig<Config>()`: fixes the plugin config type while
 * keeping props and result generic.
 *
 * @public
 */
export type ComponentDefiner<TConfig> = <
  TProps = unknown,
  TResult = unknown,
>(
  definition: Omit<ComponentDefinition<TProps, TResult, TConfig>, '$feature'>,
) => Readonly<ComponentDefinition<TProps, TResult, TConfig>>;

/**
 * Define a renderable component for the `components/` convention directory.
 * The render function may return synchronously or asynchronously.
 *
 * @public
 * @example
 * ```ts
 * import { defineComponent } from 'zhin.js/component';
 *
 * export default defineComponent<{ name: string }, string>({
 *   render: ({ name }) => `Hello ${name}`,
 * });
 * ```
 */
export function defineComponent<
  TProps = unknown,
  TResult = unknown,
  TConfig = unknown,
>(
  definition: Omit<ComponentDefinition<TProps, TResult, TConfig>, '$feature'>,
): Readonly<ComponentDefinition<TProps, TResult, TConfig>> {
  if (typeof definition.render !== 'function') {
    throw new TypeError('Component render must be a function');
  }
  return Object.freeze({ $feature: componentBrand, ...definition });
}

/**
 * Fix the plugin config type first, then define the component.
 */
defineComponent.withConfig = function withConfig<TConfig = unknown>(): ComponentDefiner<TConfig> {
  return (definition) => defineComponent(definition);
};

/** @internal Runtime validation for convention-discovered modules. */
export function parseComponentDefinition(value: unknown): ComponentDefinition {
  if (!value || typeof value !== 'object') throw invalidComponent();
  const definition = value as Partial<ComponentDefinition>;
  if (definition.$feature !== componentBrand || typeof definition.render !== 'function') {
    throw invalidComponent();
  }
  if (definition.previewServices !== undefined && (!Array.isArray(definition.previewServices)
    || !definition.previewServices.every(service => !!service && typeof service === 'object'
      && !!service.token && typeof service.token === 'object' && typeof service.token.id === 'string'))) {
    throw new TypeError('Component previewServices must be an array of { token, value }');
  }
  return definition as ComponentDefinition;
}

function invalidComponent(): TypeError {
  return new TypeError('Component module must default-export defineComponent(...)');
}
