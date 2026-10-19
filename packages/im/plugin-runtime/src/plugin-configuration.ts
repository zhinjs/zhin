/** Plugin business configuration keyed by the aliases in a v2 application declaration. */
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
 * Projects top-level business blocks for the declared application instances.
 */
export function readPluginConfigurationMap(
  document: Readonly<Record<string, unknown>>,
  source = 'Root config',
): PluginConfigurationMap {
  if (document.configVersion !== 2) {
    throw new TypeError(`${source}.configVersion must be 2; see docs/migrations/plugin-instance-declarations.md`);
  }
  const value = document.plugins;
  if (value === undefined) return EMPTY_PLUGIN_CONFIGURATION;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginConfigurationShapeError(source);
  }
  if (Object.values(value).some(reference => typeof reference !== 'string' || reference.length === 0)) {
    throw new TypeError(`${source}.plugins must map instance aliases to package strings`);
  }
  return Object.freeze(Object.fromEntries(Object.keys(value).map(key => [key, document[key] === undefined ? {} : document[key]])));
}
