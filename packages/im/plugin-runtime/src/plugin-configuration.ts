/** Canonical `zhin.config.*#plugins` shape keyed by Plugin instanceKey. */
export type PluginConfigurationMap = Readonly<Record<string, unknown>>;

const EMPTY_PLUGIN_CONFIGURATION = Object.freeze({}) as PluginConfigurationMap;

/** Raised when a Root config still uses a non-canonical Plugin configuration shape. */
export class PluginConfigurationShapeError extends TypeError {
  constructor(readonly source = 'Root config') {
    super(`${source}.plugins must be an object keyed by Plugin instanceKey`);
    this.name = 'PluginConfigurationShapeError';
  }
}

/**
 * Reads the canonical Plugin instance configuration map.
 *
 * An omitted `plugins` key means that the Root has no configured child instances.
 * Every present value must be an object map; legacy package-name arrays belong only
 * to the explicit migration pipeline.
 */
export function readPluginConfigurationMap(
  document: Readonly<Record<string, unknown>>,
  source = 'Root config',
): PluginConfigurationMap {
  const value = document.plugins;
  if (value === undefined) return EMPTY_PLUGIN_CONFIGURATION;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginConfigurationShapeError(source);
  }
  return value as PluginConfigurationMap;
}
