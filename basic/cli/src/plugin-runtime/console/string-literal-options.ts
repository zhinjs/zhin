/** The one JSON Schema union that existing string Select fields can represent exactly. */
export function readStringLiteralOptions(input: Record<string, unknown>): readonly {
  label: string; value: string; 'x-i18n'?: Record<string, unknown>;
}[] | null {
  if (!Array.isArray(input.anyOf) || input.anyOf.length === 0 || input.anyOf.length > 64) return null;
  const annotations = ['title', 'description', 'x-descriptionZh', 'x-i18n', '$comment'];
  const parentKeys = ['anyOf', 'type', 'default', 'writeOnly', 'readOnly', 'deprecated', 'x-zhin-config', ...annotations];
  if (Object.keys(input).some(key => !parentKeys.includes(key))
    || (input.type !== undefined && input.type !== 'string')) return null;
  const values = new Set<string>();
  const options: { label: string; value: string; 'x-i18n'?: Record<string, unknown> }[] = [];
  for (const branch of input.anyOf) {
    if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return null;
    const item = branch as Record<string, unknown>;
    if (Object.keys(item).some(key => !['const', 'type', 'default', ...annotations].includes(key))
      || !Object.prototype.hasOwnProperty.call(item, 'const')
      || typeof item.const !== 'string' || item.const.length === 0 || item.const.length > 256
      || values.has(item.const) || (item.type !== undefined && item.type !== 'string')
      || (Object.prototype.hasOwnProperty.call(item, 'default') && item.default !== item.const)) return null;
    values.add(item.const);
    const label = [item['x-descriptionZh'], item.title, item.description].find(value => typeof value === 'string');
    const translations = item['x-i18n'];
    options.push({ label: typeof label === 'string' ? label : item.const, value: item.const,
      ...(translations && typeof translations === 'object' && !Array.isArray(translations)
        ? { 'x-i18n': structuredClone(translations) as Record<string, unknown> } : {}) });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'default')
    && (typeof input.default !== 'string' || !values.has(input.default))) return null;
  // Custom option annotations may relabel exactly these choices, never replace their domain.
  const metadata = input['x-zhin-config'];
  if (metadata && typeof metadata === 'object' && 'options' in metadata) {
    const custom = (metadata as Record<string, unknown>).options;
    if (!Array.isArray(custom) || custom.length !== options.length
      || new Set(custom.map(item => item?.value)).size !== options.length
      || custom.some(item => !item || typeof item !== 'object'
        || typeof item.label !== 'string' || !values.has(item.value))) return null;
  }
  return options;
}
