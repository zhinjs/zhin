/**
 * Masks stored configuration values before they leave the store in a response that the
 * caller did not ask to read (e.g. a trusted project patch conflict). Conservative: a
 * schema secret/writeOnly/password/hidden annotation, a secret-like key, or an unexpanded
 * environment reference (`${…}`, `env://…`) is replaced as a whole and never echoed.
 */
import {
  UNRESOLVED_CONFIG_SCHEMA, configSchemaChildren, expandConfigSchema, isConfigEnvironmentReference, isSecretConfigKey,
  isSecretConfigSchema,
} from '@zhin.js/runtime';

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

/** Credential names, excluding ordinary budgets such as maxTokens and tokenLimit (the ADR 0057 predicate). */
export const sensitiveConfigKey: (key: string) => boolean = isSecretConfigKey;

export const REDACTED_CONFIG_VALUE = '[redacted]';
const MAX_DEPTH = 32;
// Retain uncertainty without changing the non-strict masker's best-effort behavior.
const unresolvedSchema: Schema = UNRESOLVED_CONFIG_SCHEMA;
const expand = expandConfigSchema;
const children = configSchemaChildren;

function record(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sensitiveSchema(schema: Schema): boolean {
  const metadata = schema['x-zhin-config'];
  // `hidden` mirrors the configuration explanation contract: hidden fields are never echoed.
  return isSecretConfigSchema(schema) || schema.hidden === true
    || record(metadata) && metadata.hidden === true;
}

type Hidden = (node: Schema) => boolean;

function maskTree(value: unknown, nodes: readonly Schema[], root: Schema, depth: number, hidden: Hidden): unknown {
  if (nodes.some(hidden)) return REDACTED_CONFIG_VALUE;
  if (typeof value === 'string') return isConfigEnvironmentReference(value) ? REDACTED_CONFIG_VALUE : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED_CONFIG_VALUE;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => maskTree(item, children(nodes, String(index), root), root, depth + 1, hidden)));
  }
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    sensitiveConfigKey(key) ? REDACTED_CONFIG_VALUE : maskTree(item, children(nodes, key, root), root, depth + 1, hidden)])));
}

/**
 * Masks `value`, stored at `path` (first segment is the section) under `sectionSchema`.
 * A missing schema still applies key and environment-reference masking.
 * `unknownSchema: 'redact'` (project reads and conflict evidence) also replaces any value under a schema
 * boundary this masker cannot prove (`if`/`not`/`contains`/…, nested `$id`, non-local
 * `$ref`; the chat policy's {@link isUnknownConfigurationSchemaBoundary}), since a secret
 * annotation could hide behind it.
 */
export function maskConfigValue(sectionSchema: Schema | null | undefined, path: readonly string[], value: unknown,
  options: Readonly<{ unknownSchema?: 'redact' }> = {}): unknown {
  const root: Schema = record(sectionSchema) ? sectionSchema : {};
  const hidden: Hidden = options.unknownSchema === 'redact'
    ? node => node === unresolvedSchema || sensitiveSchema(node) || isUnknownConfigurationSchemaBoundary(node, root) : sensitiveSchema;
  let nodes = record(sectionSchema) ? expand(sectionSchema, root) : [];
  if (path.length > 0 && sensitiveConfigKey(path[0]!)) return REDACTED_CONFIG_VALUE;
  if (nodes.some(hidden)) return REDACTED_CONFIG_VALUE;
  for (const key of path.slice(1)) {
    if (sensitiveConfigKey(key)) return REDACTED_CONFIG_VALUE;
    nodes = children(nodes, key, root);
    if (nodes.some(hidden)) return REDACTED_CONFIG_VALUE;
  }
  return maskTree(value, nodes, root, 0, hidden);
}
