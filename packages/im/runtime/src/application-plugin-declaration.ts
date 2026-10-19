import hostConfigSchema from './host-config-schema.json' with { type: 'json' };

/** Top-level names which cannot be used for a flat application Plugin instance. */
export const APPLICATION_PLUGIN_RESERVED_KEYS: readonly string[] = Object.freeze([
  ...Object.keys(hostConfigSchema.properties),
  'configVersion', 'plugins', 'disable_plugins', '__proto__', 'constructor', 'prototype',
]);
const reserved = new Set(APPLICATION_PLUGIN_RESERVED_KEYS);

export interface ApplicationPluginInstanceDeclaration {
  readonly instanceKey: string;
  readonly package: string;
  readonly enabled: boolean;
}

export type ApplicationPluginDeclaration = Readonly<{
  version: 2;
  instances: readonly ApplicationPluginInstanceDeclaration[];
  disabled: readonly string[];
}>;

export const PLUGIN_INSTANCE_MIGRATION_GUIDE = 'docs/migrations/plugin-instance-declarations.md';

/** Reads the single supported application protocol; never guesses from business config. */
export function readApplicationPluginDeclaration(
  document: Readonly<Record<string, unknown>>,
  source = 'Root config',
  pluginOrder?: readonly string[],
): ApplicationPluginDeclaration {
  if (document.configVersion !== 2) {
    throw new TypeError(`${source}.configVersion must be 2; migrate the application configuration: ${PLUGIN_INSTANCE_MIGRATION_GUIDE}`);
  }
  const plugins = document.plugins === undefined ? {} : document.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new TypeError(`${source}.plugins must map instance aliases to package strings`);
  }
  const entries = plugins as Record<string, unknown>;
  const keys = Object.keys(entries);
  let order = keys;
  if (pluginOrder) {
    if (pluginOrder.length !== keys.length || new Set(pluginOrder).size !== keys.length
      || pluginOrder.some(key => !Object.hasOwn(entries, key))) {
      throw new TypeError(`${source} Plugin source order does not match plugins declarations`);
    }
    order = [...pluginOrder];
  }
  const disabled = document.disable_plugins === undefined ? [] : document.disable_plugins;
  if (!Array.isArray(disabled) || disabled.some(key => typeof key !== 'string')) {
    throw new TypeError(`${source}.disable_plugins must be an array of declared instance aliases`);
  }
  if (new Set(disabled).size !== disabled.length) throw new TypeError(`${source}.disable_plugins contains duplicate aliases`);
  for (const key of disabled) {
    if (!Object.hasOwn(entries, key)) throw new TypeError(`${source}.disable_plugins references undeclared instance ${key}`);
  }
  const disabledKeys = new Set(disabled as string[]);
  const instances = order.map(instanceKey => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(instanceKey) || reserved.has(instanceKey)) {
      throw new TypeError(`${source}.plugins has invalid or reserved instance alias ${instanceKey}`);
    }
    const reference = entries[instanceKey];
    if (typeof reference !== 'string' || !isPluginPackageReference(reference)) {
      throw new TypeError(`${source}.plugins.${instanceKey} must be a package name or package-relative ./ path`);
    }
    const config = document[instanceKey];
    if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) {
      throw new TypeError(`${source}.${instanceKey} must be a Plugin business configuration object`);
    }
    return Object.freeze({ instanceKey, package: reference, enabled: !disabledKeys.has(instanceKey) });
  });
  for (const key of Object.keys(document)) {
    if (!reserved.has(key) && !Object.hasOwn(entries, key)) throw new TypeError(`${source}.${key} is an undeclared Plugin configuration block`);
  }
  return Object.freeze({ version: 2, instances: Object.freeze(instances), disabled: Object.freeze([...disabled] as string[]) });
}

/** Structural patch address for one instance's business configuration. */
export function pluginInstanceConfigPath(
  document: Readonly<Record<string, unknown>>,
  instanceKey: string,
): readonly string[] {
  readApplicationPluginDeclaration(document);
  return Object.freeze([instanceKey]);
}

function isPluginPackageReference(value: string): boolean {
  if (value.startsWith('./')) {
    return value.length > 2 && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '');
  }
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value);
}
