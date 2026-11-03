import { isUnknownConfigurationSchemaBoundary, sensitiveConfigKey } from './configuration-schema-safety.js';
export { sensitiveConfigKey } from './configuration-schema-safety.js';

/**
 * Masks stored configuration values before they leave the store in a response that the
 * caller did not ask to read (e.g. a trusted project patch conflict). Conservative: a
 * schema secret/writeOnly/password/hidden annotation, a secret-like key, or an unexpanded
 * environment reference (`${…}`, `env://…`) is replaced as a whole and never echoed.
 */
type Schema = Readonly<Record<string, unknown>>;

export const REDACTED_CONFIG_VALUE = '[redacted]';
const MAX_DEPTH = 32;
const unknownSchema: Schema = Object.freeze({ writeOnly: true });

function record(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sensitiveSchema(schema: Schema): boolean {
  const metadata = schema['x-zhin-config'];
  // `hidden` mirrors the configuration explanation contract: hidden fields are never echoed.
  return schema.writeOnly === true || schema.secret === true || schema.hidden === true
    || schema.format === 'password' || schema.component === 'password'
    || record(metadata) && (metadata.secret === true || metadata.hidden === true || metadata.component === 'password');
}

/** Expands local `$ref` and every combinator branch; any branch's annotation applies. */
function expand(node: unknown, root: Schema, seen: ReadonlySet<unknown> = new Set()): Schema[] {
  if (!record(node) || seen.has(node) || seen.size > MAX_DEPTH) return [unknownSchema];
  if (isUnknownConfigurationSchemaBoundary(node, root)) return [unknownSchema];
  const nextSeen = new Set([...seen, node]);
  const nodes: Schema[] = [node];
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let referenced: unknown = root;
    for (const raw of node.$ref.slice(2).split('/')) {
      const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      referenced = record(referenced) && Object.hasOwn(referenced, key) ? referenced[key] : undefined;
    }
    nodes.push(...expand(referenced, root, nextSeen));
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const branches = node[keyword];
    if (Array.isArray(branches)) for (const branch of branches) nodes.push(...expand(branch, root, nextSeen));
  }
  return nodes;
}

function children(nodes: readonly Schema[], key: string, root: Schema): Schema[] {
  const next: Schema[] = [];
  for (const node of nodes) {
    let matched = false;
    if (record(node.properties) && Object.hasOwn(node.properties, key)) {
      next.push(...expand(node.properties[key], root)); matched = true;
    }
    if (record(node.patternProperties)) {
      for (const [pattern, child] of Object.entries(node.patternProperties)) {
        let test = false;
        try { test = new RegExp(pattern, 'u').test(key); } catch { test = false; }
        if (test) { next.push(...expand(child, root)); matched = true; }
      }
    }
    if (!matched && record(node.additionalProperties)) next.push(...expand(node.additionalProperties, root));
    if (/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      const index = Number(key);
      if (Array.isArray(node.prefixItems) && index < node.prefixItems.length) next.push(...expand(node.prefixItems[index], root));
      else if (record(node.items)) next.push(...expand(node.items, root));
    }
  }
  return next;
}

function maskTree(value: unknown, nodes: readonly Schema[], root: Schema, depth: number): unknown {
  if (nodes.some(node => sensitiveSchema(node) || isUnknownConfigurationSchemaBoundary(node, root))) return REDACTED_CONFIG_VALUE;
  if (typeof value === 'string') return /\$\{|^env:\/\//u.test(value) ? REDACTED_CONFIG_VALUE : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED_CONFIG_VALUE;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => maskTree(item, children(nodes, String(index), root), root, depth + 1)));
  }
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    sensitiveConfigKey(key) ? REDACTED_CONFIG_VALUE : maskTree(item, children(nodes, key, root), root, depth + 1)])));
}

/**
 * Masks `value`, stored at `path` (first segment is the section) under `sectionSchema`.
 * A missing schema still applies key and environment-reference masking.
 */
export function maskConfigValue(sectionSchema: Schema | null | undefined, path: readonly string[], value: unknown): unknown {
  const root: Schema = record(sectionSchema) ? sectionSchema : {};
  let nodes = record(sectionSchema) ? expand(sectionSchema, root) : [];
  if (path.length > 0 && sensitiveConfigKey(path[0]!)) return REDACTED_CONFIG_VALUE;
  if (nodes.some(sensitiveSchema)) return REDACTED_CONFIG_VALUE;
  for (const key of path.slice(1)) {
    if (sensitiveConfigKey(key)) return REDACTED_CONFIG_VALUE;
    nodes = children(nodes, key, root);
    if (nodes.some(sensitiveSchema)) return REDACTED_CONFIG_VALUE;
  }
  return maskTree(value, nodes, root, 0);
}
