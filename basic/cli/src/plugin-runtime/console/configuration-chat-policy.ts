import { expandEnvironmentValue } from '@zhin.js/runtime';
import { isUnknownConfigurationSchemaBoundary, sensitiveConfigKey as sensitiveKey } from './configuration-schema-safety.js';
type Schema = Readonly<Record<string, unknown>>;
type Variants = readonly (readonly Schema[])[];
export type ConfigChatAccessKind = 'sensitive' | 'unknown' | 'missing';

export class ConfigChatAccessError extends Error {
  constructor(readonly kind: ConfigChatAccessKind) {
    super(kind === 'sensitive' ? '敏感配置不能通过聊天读取或修改，请使用 CLI 或 Console。'
      : kind === 'missing' ? '配置项不存在。' : '无法确认配置范围安全，请使用 CLI 或 Console。');
    this.name = 'ConfigChatAccessError';
  }
}

function record(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function own(value: Schema, key: string): boolean { return Object.hasOwn(value, key); }
function sensitive(schema: Schema): boolean {
  return schema.writeOnly === true || schema.secret === true || schema.format === 'password' || schema.component === 'password'
    || record(schema['x-zhin-config']) && (schema['x-zhin-config'].secret === true || schema['x-zhin-config'].component === 'password');
}
function unknown(): never { throw new ConfigChatAccessError('unknown'); }
function assertSafe(nodes: readonly Schema[]): void {
  if (nodes.some(sensitive)) throw new ConfigChatAccessError('sensitive');
}
function intersect(left: Variants, right: Variants): Variants {
  // A combinatorial declaration is uncertain for this deliberately conservative
  // reader, rather than permission to inspect arbitrary configuration values.
  if (left.length * right.length > 64) unknown();
  return left.flatMap(a => right.map(b => [...a, ...b]));
}
function variants(value: unknown, root: Schema, seen = new Set<unknown>()): Variants {
  if (!record(value) || seen.has(value)) unknown();
  const nextSeen = new Set([...seen, value]);
  if (isUnknownConfigurationSchemaBoundary(value, root)
    || value.hidden === true || record(value['x-zhin-config']) && value['x-zhin-config'].hidden === true) unknown();
  let result: Variants = [[value]];
  if (value.$ref !== undefined) {
    if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) unknown();
    let referenced: unknown = root;
    for (const raw of value.$ref.slice(2).split('/')) {
      if (/~(?![01])/u.test(raw)) unknown();
      const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!record(referenced) || !own(referenced, key)) unknown();
      referenced = referenced[key];
    }
    result = intersect(result, variants(referenced, root, nextSeen));
  }
  if (value.allOf !== undefined) {
    if (!Array.isArray(value.allOf) || !value.allOf.length) unknown();
    for (const branch of value.allOf) result = intersect(result, variants(branch, root, nextSeen));
  }
  for (const keyword of ['anyOf', 'oneOf']) if (value[keyword] !== undefined) {
    if (!Array.isArray(value[keyword]) || !value[keyword].length) unknown();
    result = intersect(result, value[keyword].flatMap(branch => variants(branch, root, nextSeen)));
  }
  return result;
}
function typeNames(nodes: readonly Schema[]): readonly string[] {
  const types = new Set<string>();
  for (const node of nodes) {
    for (const type of Array.isArray(node.type) ? node.type : [node.type]) if (typeof type === 'string') types.add(type);
    if (record(node.properties) || record(node.patternProperties) || record(node.additionalProperties)) types.add('object');
    if (node.items !== undefined || node.prefixItems !== undefined) types.add('array');
    const examples = own(node, 'const') ? [node.const] : Array.isArray(node.enum) ? node.enum : [];
    for (const value of examples) types.add(value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
  }
  if (!types.size || [...types].some(type => !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type))) unknown();
  return [...types];
}
function children(nodes: readonly Schema[], key: string): readonly unknown[] {
  if (sensitiveKey(key)) throw new ConfigChatAccessError('sensitive');
  const found: unknown[] = [];
  for (const node of nodes) {
    if (node.items !== undefined || node.prefixItems !== undefined || node.type === 'array') {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) unknown();
      const index = Number(key);
      const prefix = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : undefined;
      const item = prefix && index < prefix.length ? prefix[index] : prefix ? node.additionalItems ?? node.items : node.items;
      if (item !== undefined) found.push(item);
      continue;
    }
    let matched = false;
    if (record(node.properties) && own(node.properties, key)) { found.push(node.properties[key]); matched = true; }
    if (record(node.patternProperties)) for (const [pattern, schema] of Object.entries(node.patternProperties)) {
      let matches: boolean;
      try { matches = new RegExp(pattern, 'u').test(key); } catch { unknown(); }
      if (matches) { found.push(schema); matched = true; }
    }
    if (!matched && node.additionalProperties !== undefined) found.push(node.additionalProperties);
  }
  if (!found.length) unknown();
  return found;
}
function descend(input: Variants, key: string, root: Schema): Variants {
  return input.flatMap(nodes => {
    assertSafe(nodes);
    let result: Variants = [[]];
    for (const child of children(nodes, key)) result = intersect(result, variants(child, root));
    return result;
  });
}
function locate(root: Schema, path: readonly string[]): Variants {
  let current = variants(root, root);
  for (const key of path) current = descend(current, key, root);
  for (const nodes of current) { assertSafe(nodes); typeNames(nodes); }
  return current;
}
function inspectTree(current: Variants, root: Schema, values: readonly unknown[], seen: ReadonlySet<Schema> = new Set()): void {
  const allowed = new Set(current.flatMap(typeNames));
  for (const value of values) {
    if (value === undefined) continue;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!allowed.has(type) && !(type === 'number' && allowed.has('integer'))) unknown();
    if (typeof value === 'string' && /^env:\/\//u.test(value) && sensitiveKey(value.slice(6))) throw new ConfigChatAccessError('sensitive');
  }
  for (const nodes of current) {
    assertSafe(nodes);
    const types = typeNames(nodes);
    if (!types.includes('object') && !types.includes('array')) continue;
    if (nodes.some(node => seen.has(node))) unknown();
    const nextSeen = new Set([...seen, ...nodes]);
    const keys = new Set<string>();
    for (const node of nodes) {
      if (record(node.properties)) for (const key of Object.keys(node.properties)) keys.add(key);
      if (record(node.patternProperties)) for (const schema of Object.values(node.patternProperties)) inspectTree(variants(schema, root), root, [], nextSeen);
      if (record(node.additionalProperties)) inspectTree(variants(node.additionalProperties, root), root, [], nextSeen);
      if (types.includes('array')) {
        const prefix = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : [];
        for (const schema of prefix) inspectTree(variants(schema, root), root, [], nextSeen);
        if (record(node.items)) inspectTree(variants(node.items, root), root, [], nextSeen);
      }
    }
    for (const value of values) if (record(value) || Array.isArray(value)) for (const key of Object.keys(value)) keys.add(key);
    if (!keys.size && types.includes('object') && !nodes.some(node => record(node.properties) || record(node.additionalProperties) || node.additionalProperties === false)) unknown();
    if (types.includes('array') && !nodes.some(node => record(node.items) || Array.isArray(node.prefixItems) || Array.isArray(node.items) || node.items === false)) unknown();
    for (const key of keys) {
      const childValues = values.map(value => value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined);
      inspectTree(descend([nodes], key, root), root, childValues, nextSeen);
    }
  }
}

/** Raw JSON Schema only. Unknown branches never confer access. No values are expanded. */
export function assertChatConfigurationAccess(schema: unknown, path: readonly string[], values: readonly unknown[], deep = true, absolutePath: readonly string[] = path): void {
  if (absolutePath.some(sensitiveKey)) throw new ConfigChatAccessError('sensitive');
  if (!record(schema)) unknown();
  const current = locate(schema, path);
  const allowed = new Set(current.flatMap(typeNames));
  for (const value of values) if (value !== undefined) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!allowed.has(type) && !(type === 'number' && allowed.has('integer'))) unknown();
  }
  if (deep) {
    expandEnvironmentValue(values, name => { if (sensitiveKey(name)) throw new ConfigChatAccessError('sensitive'); return undefined; }, () => '');
    for (const value of values) if (typeof value === 'string' && /^env:\/\//u.test(value)
      && sensitiveKey(value.slice(6))) throw new ConfigChatAccessError('sensitive');
    inspectTree(current, schema, values);
  }
}

/** Public structure only: never defaults, examples, enum values or descriptions. */
export function chatConfigurationSchema(schema: unknown, path: readonly string[], value: unknown): Readonly<Record<string, unknown>> {
  if (!record(schema)) unknown();
  const current = locate(schema, path);
  const type = [...new Set(current.flatMap(typeNames))];
  const keys = new Set<string>();
  for (const nodes of current) for (const node of nodes) if (record(node.properties)) for (const key of Object.keys(node.properties)) keys.add(key);
  if (record(value) || Array.isArray(value)) for (const key of Object.keys(value)) keys.add(key);
  const properties: Record<string, unknown> = {};
  for (const key of keys) {
    try {
      const child = locate(schema, [...path, key]);
      Object.defineProperty(properties, key, { value: { type: [...new Set(child.flatMap(typeNames))] }, enumerable: true });
    } catch (error) { if (!(error instanceof ConfigChatAccessError)) throw error; }
  }
  return Object.freeze({ type: Object.freeze(type), properties: Object.freeze(properties) });
}
