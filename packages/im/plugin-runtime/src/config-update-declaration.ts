export interface PluginConfigUpdateDeclaration {
  readonly featurePaths: readonly (readonly string[])[];
}

/** @internal Normalize inert ownership metadata at authoring and snapshot boundaries. */
export function freezePluginConfigUpdate(value: PluginConfigUpdateDeclaration): PluginConfigUpdateDeclaration {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'featurePaths') || !Array.isArray(value.featurePaths)) {
    throw new TypeError('Plugin configUpdate must declare featurePaths');
  }
  return Object.freeze({ featurePaths: Object.freeze(Array.from(value.featurePaths, (path: readonly string[]) => {
    if (!Array.isArray(path) || !path.length) throw new TypeError('Plugin configUpdate paths must be safe nonempty paths');
    const parts = Array.from(path);
    if (parts.some(part => typeof part !== 'string' || !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new TypeError('Plugin configUpdate paths must be safe nonempty paths');
    }
    return Object.freeze(parts);
  })) });
}
