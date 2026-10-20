import type { ChildPluginReference, PackageReference } from './manifest.js';

/**
 * Package whose `zhin.features` define the Stable Feature composition
 * (adapter / command / component / middleware / handler).
 *
 * Root inherits these when it depends on `@zhin.js/core` directly, or on the
 * `zhin.js` facade (which depends on `@zhin.js/core`).
 */
export const PLATFORM_FEATURE_CARRIER = '@zhin.js/core';

/**
 * Install facade that may declare default child plugins and re-exports core
 * authoring surfaces.
 */
export const PLATFORM_FEATURE_FACADE = 'zhin.js';

/**
 * Merge user-declared features with inherited platform features.
 * User references for the same package win (pin / override).
 */
export function mergeFeatureReferences(
  declared: readonly PackageReference[],
  inherited: readonly PackageReference[],
): readonly PackageReference[] {
  const seen = new Set(declared.map((item) => item.package));
  const extras = inherited.filter((item) => !seen.has(item.package));
  if (extras.length === 0) return declared;
  return Object.freeze([...declared, ...extras]);
}

/**
 * Merge user-declared child plugins with facade defaults.
 * User references for the same instanceKey win (pin / override).
 */
export function mergeChildPluginReferences(
  declared: readonly ChildPluginReference[],
  inherited: readonly ChildPluginReference[],
): readonly ChildPluginReference[] {
  const seen = new Set(declared.map((item) => item.instanceKey));
  const extras = inherited.filter((item) => !seen.has(item.instanceKey));
  if (extras.length === 0) return declared;
  return Object.freeze([...declared, ...extras]);
}

export function declaredPackageDependency(
  dependencies: Readonly<Record<string, string>> | undefined,
  optionalDependencies: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  return dependencies?.[name] ?? optionalDependencies?.[name];
}
