import { pluginOwnerResourceKey, type PluginId } from './identity.js';

const resourcePrefix = '__zhin_plugin__';
const resourceSeparator = '__';

/** Shared owner identity and physical-name invariant for process-wide resources. */
export abstract class OwnerScopedResourceHost {
  constructor(readonly owner: PluginId) {}

  protected qualify(name: string): string {
    assertLogicalName(name);
    return qualifyOwnedResourceName(this.owner, name);
  }

  protected unqualify(name: string): string | undefined {
    const prefix = `${resourcePrefix}${pluginOwnerResourceKey(this.owner)}${resourceSeparator}`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
  }
}

export function qualifyOwnedResourceName(owner: PluginId, name: string): string {
  assertLogicalName(name);
  return `${resourcePrefix}${pluginOwnerResourceKey(owner)}${resourceSeparator}${name}`;
}

function assertLogicalName(name: string): void {
  if (!name || name.startsWith(resourcePrefix)) {
    throw new TypeError(`Invalid plugin resource name: ${name}`);
  }
}
