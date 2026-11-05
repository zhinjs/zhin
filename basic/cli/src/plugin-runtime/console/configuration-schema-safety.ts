type Schema = Readonly<Record<string, unknown>>;
const unsupportedApplicators = Object.freeze([
  'if', 'then', 'else', 'not', 'contains', 'dependencies', 'dependentSchemas',
  '$dynamicRef', '$recursiveRef', '$dynamicAnchor', 'unevaluatedProperties', 'unevaluatedItems',
]);

/** Shared proof limit: these branches/resources need a resolver we do not provide. */
export function isUnknownConfigurationSchemaBoundary(schema: Schema, root: Schema): boolean {
  return schema !== root && Object.hasOwn(schema, '$id')
    || unsupportedApplicators.some(keyword => Object.hasOwn(schema, keyword))
    || schema.$ref !== undefined && (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/') || /~(?![01])/u.test(schema.$ref));
}

/** Credential names, excluding ordinary budgets such as maxTokens and tokenLimit. */
export function sensitiveConfigKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return /(?:password|passwd|secret|apikey|accesskey|privatekey|encrypt(?:ion)?key|encodingaeskey|credential|authorization|cookie)/u.test(normalized)
    || normalized === 'pwd' || /(?:^|api|access|refresh|auth|bearer|bot|oauth|session|private|client|app|verify|verification)tokens?(?:v[0-9]+)?$/u.test(normalized);
}
