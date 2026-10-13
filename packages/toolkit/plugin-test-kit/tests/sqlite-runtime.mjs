/** SQLite is an optional test Host, not a runtime dependency of PluginTestKit. */
export function sqliteRuntimeArguments(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 5) return undefined;
  return major === 22 && minor < 13 ? ['--experimental-sqlite'] : [];
}
