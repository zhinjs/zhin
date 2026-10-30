/** Both the new Adapter base and legacy defineAdapter/Endpoint inputs remain supported. */
export function usesSupportedAdapterBase(source) {
  return !/\bextends\s+Adapter\b/u.test(source)
    || /import\s+\{[^}]*\bAdapter\b[^}]*\}\s+from\s+['"](?:@zhin\.js\/adapter|zhin\.js\/adapter)['"]/su.test(source);
}

/** Registry migration preserves existing Client descriptors through the single open registry. */
export function declaresAdapterTypeRegistry(source) {
  return /\binterface\s+(?:AdapterRegistry|AdapterClientRegistry)\b/u.test(source);
}
