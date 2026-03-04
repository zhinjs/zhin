/**
 * Re-export from @zhin.js/kernel for backward compatibility.
 * Core's Plugin class implements PluginLike, so the Feature's
 * mounted(plugin: PluginLike) signature is compatible.
 */
export { Feature } from '@zhin.js/kernel';
export type { FeatureJSON, FeatureListener } from '@zhin.js/kernel';
