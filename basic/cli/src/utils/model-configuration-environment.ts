import { expandEnvironmentValue } from '@zhin.js/runtime';

const record = (value: unknown): value is Readonly<Record<string, unknown>> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** One dependency group, retaining the existing Host's admitted binding topology. */
export function modelConfigurationPaths(agents: unknown): readonly (readonly string[])[] {
  return Object.freeze([
    ['ai', 'providers'], ['ai', 'modelCatalog'], ['ai', 'modelPolicy'],
    ...Object.keys(record(agents) ? agents : {}).flatMap(name => ['provider', 'model', 'preset'].map(field => ['ai', 'agents', name, field])),
  ].map(path => Object.freeze(path)));
}

/** Presence/equality evidence only: never collects expanded credentials or performs resolver I/O. */
export function modelConfigurationEnvironmentReferences(
  paths: readonly (readonly string[])[], document: Readonly<Record<string, unknown>>, expanded: unknown,
  hasValue: (name: string) => boolean,
): { readonly references: ReadonlySet<string>; readonly missing: ReadonlySet<string> } {
  const references = new Set<string>();
  const missing = new Set<string>();
  const owned = paths.map(path => path.reduce<unknown>((value, key) => record(value)
    && Object.hasOwn(value, key) ? value[key] : undefined, document));
  // The canonical parser retains fallback semantics without retrieving any value.
  expandEnvironmentValue(owned, name => { references.add(name); return hasValue(name) ? 'present' : undefined; },
    name => { missing.add(name); return ''; });
  const catalog = record(expanded) && record(expanded.modelCatalog) ? expanded.modelCatalog : undefined;
  for (const connection of Object.values(record(catalog?.connections) ? catalog.connections : {})) {
    if (!record(connection) || typeof connection.secretRef !== 'string') continue;
    const key = /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(connection.secretRef)?.[1];
    if (!key) continue;
    references.add(key);
    if (!hasValue(key)) missing.add(key);
  }
  return { references, missing };
}
