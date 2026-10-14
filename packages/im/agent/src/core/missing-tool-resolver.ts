/**
 * Auto-load for a deferred tool the model called without `load_tool`.
 *
 * Only names in this Turn's (already policy-filtered) catalog may load: a tool
 * the policy removed, such as bash without a shell policy, must neither run nor
 * be persisted into the session's loaded set.
 */
export function createMissingToolResolver<T extends { readonly name: string }>(options: Readonly<{
  catalog: readonly { readonly name: string }[];
  load: ((name: string) => Promise<boolean>) | undefined;
  rebuild: () => readonly T[];
}>): ((name: string) => Promise<T | undefined>) | undefined {
  const { load } = options;
  if (!load) return undefined;
  const allowed = new Set(options.catalog.map(entry => entry.name));
  return async (name: string) => {
    if (!allowed.has(name)) return undefined;
    if (!(await load(name))) return undefined;
    return options.rebuild().find(tool => tool.name === name);
  };
}
