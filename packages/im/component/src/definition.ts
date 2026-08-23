/**
 * Component authoring API consumed from `zhin.js/component`.
 * @module zhin.js/component
 */
import type { PluginNodeSnapshot } from '@zhin.js/plugin-runtime';
import type { CapabilityContext } from '@zhin.js/feature-kit';

const componentBrand = 'zhin.component/1' as const;

export interface ComponentContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly requester: PluginNodeSnapshot;
}

export interface ComponentDefinition<
  TProps = unknown,
  TResult = unknown,
  TConfig = unknown,
> {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof componentBrand;
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

/** @internal Runtime validation for convention-discovered modules. */
export function parseComponentDefinition(value: unknown): ComponentDefinition {
  if (!value || typeof value !== 'object') throw invalidComponent();
  const definition = value as Partial<ComponentDefinition>;
  if (definition.$feature !== componentBrand || typeof definition.render !== 'function') {
    throw invalidComponent();
  }
  return definition as ComponentDefinition;
}

function invalidComponent(): TypeError {
  return new TypeError('Component module must default-export defineComponent(...)');
}
