import { expandEnvironmentValue } from '@zhin.js/runtime';
import { isUnknownConfigurationSchemaBoundary, sensitiveConfigKey as sensitiveKey } from './configuration-redaction.js';
type Schema = Readonly<Record<string, unknown>>;
type Variants = readonly (readonly Schema[])[];
/**
 * Fixed reason codes; a denial never carries a stored value or schema detail.
 * - `permission`: role/approval fields (C4), never manageable from chat.
 * - `scope`: outside the chat scope (C3: Host keys beyond `HOST_CONFIG_PATCH_PATHS`, declarations).
 * - `leaf`: not a single scalar / scalar-array leaf (no object overwrite or deletion).
 * - `required`: a required leaf cannot be unset.
 */
export type ConfigChatAccessKind = 'sensitive' | 'unknown' | 'missing' | 'permission' | 'scope' | 'leaf' | 'required';

const accessMessages: Readonly<Record<ConfigChatAccessKind, string>> = Object.freeze({
  sensitive: '敏感配置不能通过聊天读取或修改，请使用 CLI 或 Console。',
  missing: '配置项不存在。',
  unknown: '无法确认配置范围安全，请使用 CLI 或 Console。',
  permission: '权限相关配置不能通过聊天读取或修改，请使用 CLI 或 Console。',
  scope: '该配置不在聊天可管理范围内，请使用 CLI 或 Console。',
  leaf: '聊天只能读写单个叶子字段（标量或标量数组）。',
  required: '必填字段不能通过聊天删除。',
});

export class ConfigChatAccessError extends Error {
  constructor(readonly kind: ConfigChatAccessKind) {
    super(accessMessages[kind]);
    this.name = 'ConfigChatAccessError';
  }
}

/**
 * Role, approval and allow/deny-list vocabulary (C4): `master`, `trusted`,
 * `endpoints[*].master/trusted`, `ai.trigger.masters/trusted`, `toolHardGate.*`, and
 * compound names such as `adminIds`, `ownerId`, `masterId`, `trustedUsers`,
 * `superUsers`, `whitelist`, `allowlist`, `blacklist` or `bypassMasters`.
 * Matched by contains/prefix/suffix after normalization (like `sensitiveConfigKey`) so
 * casing, separators or compounds cannot bypass it. Deliberately fail-closed: an
 * ordinary key that merely contains a role word (e.g. `masterVolume`) is CLI-only.
 */
export function isChatPermissionSegment(segment: string): boolean {
  const normalized = segment.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return /(?:master|owner|admin|trust|approv|permission|permit|privilege|superuser|sudo|operator|moderator|bypass|exempt|toolhardgate)/u.test(normalized)
    || /(?:allow|deny|denied|white|black|block|ban|bann|safe|ignore)(?:ed)?(?:lists?|users?|userids?|ids?|groups?|senders?|members?)$/u.test(normalized)
    || /^(?:allow|deny|white|black|block|ban)(?:ed)?(?:lists?)?$/u.test(normalized)
    || /roles?(?:ids?)?$|^roles?|acls?$|grants?$/u.test(normalized);
}

/**
 * Indirect role binding (M2): `endpoints[*].id|name` is the key that binds leaf
 * `master`/`trusted` to an account, so remapping it from chat is a permission change.
 */
export function isChatIdentityRemapPath(path: readonly string[]): boolean {
  return path.some((segment, index) => segment === 'endpoints' && /^(?:0|[1-9][0-9]*)$/u.test(path[index + 1] ?? '')
    && /^(?:id|name|instanceid|endpointid)$/u.test((path[index + 2] ?? '').replace(/[^a-z0-9]/giu, '').toLowerCase()));
}

/**
 * M1/B1: a chat `set` never plants a new `${…}` or `env://` reference (even with a
 * non-credential-looking name), since a later `get` or runtime echo would expand it.
 * Existing references are untouched by unrelated operations.
 */
export function assertChatValueHasNoEnvironmentReference(value: unknown, depth = 0): void {
  if (depth > 32) throw new ConfigChatAccessError('unknown');
  if (typeof value === 'string') {
    if (value.includes('${') || /env:\/\//iu.test(value)) throw new ConfigChatAccessError('sensitive');
    return;
  }
  if (Array.isArray(value)) for (const item of value) assertChatValueHasNoEnvironmentReference(item, depth + 1);
  else if (record(value)) for (const [key, item] of Object.entries(value)) {
    assertChatValueHasNoEnvironmentReference(key, depth + 1); assertChatValueHasNoEnvironmentReference(item, depth + 1);
  }
}

export interface ChatConfigurationScope {
  /** Host-owned top-level keys (Runtime `HOST_CONFIG_KEYS`). */
  readonly hostKeys: readonly string[];
  /** Host chat whitelist; v1 is exactly `HOST_CONFIG_PATCH_PATHS`. */
  readonly hostPaths: readonly (readonly string[])[];
  /** Declaration keys owned by source/plugin management. */
  readonly declarationKeys: ReadonlySet<string>;
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

/** C3/C4 scope gate, checked before any schema proof or value read. */
export function assertChatConfigurationScope(path: readonly string[], scope: ChatConfigurationScope): void {
  if (!path.length) throw new ConfigChatAccessError('leaf');
  if (scope.declarationKeys.has(path[0]!)) throw new ConfigChatAccessError('scope');
  if (path.some(isChatPermissionSegment) || isChatIdentityRemapPath(path)) throw new ConfigChatAccessError('permission');
  if (scope.hostKeys.includes(path[0]!) && !scope.hostPaths.some(prefix => startsWith(path, prefix))) {
    throw new ConfigChatAccessError('scope');
  }
}

/** Whitelisted Host roots reachable from a (possibly shorter) `fields` scope. */
export function chatHostRoots(prefix: readonly string[], scope: ChatConfigurationScope): readonly (readonly string[])[] {
  return scope.hostPaths.filter(entry => startsWith(entry, prefix) || startsWith(prefix, entry))
    .map(entry => entry.length >= prefix.length ? entry : prefix);
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
      const modernPrefix = Array.isArray(node.prefixItems) ? node.prefixItems : undefined;
      const legacyPrefix = !modernPrefix && Array.isArray(node.items) ? node.items : undefined;
      const prefix = modernPrefix ?? legacyPrefix;
      const item = prefix && index < prefix.length ? prefix[index] : legacyPrefix ? node.additionalItems : node.items;
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

const scalarTypes: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean', 'null']);

/**
 * Leaf-only chat writes: the target must resolve to scalars or arrays of scalars in
 * every schema branch. Object targets would let a parent overwrite/removal bypass
 * per-child checks, so they are rejected as `leaf`.
 */
export function chatLeafTypes(schema: unknown, path: readonly string[], values: readonly unknown[] = []): readonly string[] {
  if (!record(schema)) unknown();
  const current = locate(schema, path);
  // Desired files can be edited outside the Host. Schema bounds do not prove
  // that the currently stored array actually contains only scalar values.
  for (const value of values) if (Array.isArray(value)) for (const item of value) {
    if (!scalarTypes.has(item === null ? 'null' : typeof item)) throw new ConfigChatAccessError('leaf');
  }
  const types = new Set<string>();
  for (const nodes of current) {
    const names = typeNames(nodes);
    if (names.includes('object')) throw new ConfigChatAccessError('leaf');
    if (names.includes('array')) {
      if (!nodes.some(node => node.items !== undefined || node.prefixItems !== undefined)) unknown();
      let prefixLength = 0;
      let maxItems = Infinity;
      for (const node of nodes) {
        const prefix = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : [];
        prefixLength = Math.max(prefixLength, prefix.length);
        if (node.maxItems !== undefined) {
          if (typeof node.maxItems !== 'number' || !Number.isInteger(node.maxItems) || node.maxItems < 0) unknown();
          maxItems = Math.min(maxItems, node.maxItems);
        }
      }
      // Every prefix position can have a different type. One position past the
      // longest prefix represents the homogeneous tail; never iterate to maxItems.
      for (let index = 0; index <= prefixLength && index < maxItems; index++) {
        const key = String(index);
        // A forbidden position also makes all later positions unreachable.
        if (children(nodes, key).includes(false)) break;
        for (const items of descend([nodes], key, schema)) {
          if (typeNames(items).some(type => !scalarTypes.has(type))) throw new ConfigChatAccessError('leaf');
        }
      }
    }
    for (const name of names) types.add(name);
  }
  return Object.freeze([...types]);
}

/** `unset` removes only optional leaves; any branch listing the key as required refuses. */
export function assertChatOptionalLeaf(schema: unknown, path: readonly string[]): void {
  if (!record(schema)) unknown();
  chatLeafTypes(schema, path);
  if (!path.length) throw new ConfigChatAccessError('required');
  const key = path.at(-1)!;
  for (const nodes of locate(schema, path.slice(0, -1))) {
    if (nodes.some(node => Array.isArray(node.required) && node.required.includes(key))) throw new ConfigChatAccessError('required');
  }
}

/** Prove the same properties-only ancestry used by root discovery, without enumerating siblings. */
function declaredPropertyPath(schema: Schema, path: readonly string[]): boolean {
  try {
    let current = variants(schema, schema);
    for (const key of path) {
      // Listing never descends into array items or dynamic dictionary keys.
      if (current.some(nodes => typeNames(nodes).includes('array'))
        || !current.some(nodes => nodes.some(node => record(node.properties) && own(node.properties, key)))) return false;
      current = descend(current, key, schema);
    }
    return true;
  } catch (error) {
    if (error instanceof ConfigChatAccessError) return false;
    throw error;
  }
}

/** Declared leaf paths below `path` (properties only), each still re-checked by the store. */
export function chatConfigurationLeaves(schema: unknown, path: readonly string[], limit = 256): readonly (readonly string[])[] {
  if (!record(schema) || !declaredPropertyPath(schema, path)) return [];
  const found: (readonly string[])[] = [];
  const walk = (relative: readonly string[]) => {
    if (found.length >= limit || relative.length > 12) return;
    if (relative.some(isChatPermissionSegment) || isChatIdentityRemapPath(relative) || relative.some(sensitiveKey)) return;
    let current: Variants;
    try { current = locate(schema, relative); }
    catch (error) { if (error instanceof ConfigChatAccessError) return; throw error; }
    try { chatLeafTypes(schema, relative); found.push(Object.freeze([...relative])); return; }
    catch (error) { if (!(error instanceof ConfigChatAccessError)) throw error; }
    const keys = new Set<string>();
    for (const nodes of current) for (const node of nodes) if (record(node.properties)) for (const key of Object.keys(node.properties)) keys.add(key);
    for (const key of [...keys].sort()) walk([...relative, key]);
  };
  walk(path);
  return Object.freeze(found);
}
