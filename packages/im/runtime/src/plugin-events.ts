import {
  createRootPrivateToken,
  type PluginEventChannel,
  type PluginId,
  type Scope,
} from '@zhin.js/plugin-runtime';

/** Private local binding; child Scopes cannot inherit their parent's delivery authority. */
export const pluginEventsToken = createRootPrivateToken<PluginEventInstance>('zhin.runtime.plugin-events');
export interface PluginEventInstance {
  readonly owner: PluginId;
  readonly creationGeneration: number;
  readonly channel: PluginEventChannel;
}
export function pluginEventInstances(scopes: ReadonlyMap<PluginId, Scope> | undefined): readonly PluginEventInstance[] {
  return scopes ? [...scopes.values()].flatMap(scope => scope.has(pluginEventsToken) ? [scope.use(pluginEventsToken)] : []) : [];
}
