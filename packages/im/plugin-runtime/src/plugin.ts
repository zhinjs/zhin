import type { Dispose, DisposeStack } from './dispose.js';
import type { GenerationHandoffRegistry } from './handoff.js';
import type { PluginId } from './identity.js';
import type { Scope, Token } from './token.js';

export interface PluginMetadata {
  readonly displayName?: string;
  readonly icon?: string;
  readonly order?: number;
}

export interface ConfigView<T> {
  get(): Readonly<T>;
}

export interface PluginInstanceView {
  readonly id: PluginId;
  readonly instanceKey: string;
  readonly parent?: PluginId;
  readonly root: PluginId;
  readonly role: 'root' | 'child';
}

export interface PluginSetupContext<TConfig = unknown> {
  readonly plugin: PluginInstanceView;
  readonly config: ConfigView<TConfig>;
  readonly resources: Scope;
  readonly lifecycle: DisposeStack;
  readonly handoff: GenerationHandoffRegistry;
}

export interface PluginDefinition<TConfig = unknown> {
  readonly name: string;
  readonly metadata?: PluginMetadata;
  readonly requires?: readonly Token<unknown>[];
  setup?(context: PluginSetupContext<TConfig>): void | Dispose | Promise<void | Dispose>;
}

const pluginNamePattern = /^[a-z][a-z0-9-]*$/;

export function definePlugin<TConfig = unknown>(
  definition: PluginDefinition<TConfig>,
): Readonly<PluginDefinition<TConfig>> {
  if (!pluginNamePattern.test(definition.name)) {
    throw new TypeError(`Invalid plugin name: ${definition.name}`);
  }
  return Object.freeze({
    ...definition,
    metadata: definition.metadata ? Object.freeze({ ...definition.metadata }) : undefined,
    requires: Object.freeze([...(definition.requires ?? [])]),
  });
}
