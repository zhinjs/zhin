/**
 * The one secret-field predicate (ADR 0057 §4). Response redaction (gateway), the startup
 * literal-secret warning and `zhin doctor --fix` all decide "is this a secret?" here.
 *
 * A field is a secret when its schema says so (`x-zhin-secret: true`, or the older
 * `writeOnly` / `secret` / password annotations), or — with no annotation — when its name
 * looks like a credential (`token`, `password`, `secret`, `apiKey`, `privateKey`, `*Token`, …).
 */
import type { PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

export type ConfigSchemaNode = Readonly<Record<string, unknown>>;

/** JSON Schema keyword that marks a configuration field as a secret (ADR 0057). */
export const CONFIG_SECRET_KEYWORD = 'x-zhin-secret';

const MAX_DEPTH = 32;

function record(value: unknown): value is ConfigSchemaNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Credential-like field names (case and separators ignored). Matches `token`, `*Token`,
 * `password`, `secret`, `apiKey`, `privateKey`, `accessKey`, … but not budgets such as
 * `maxTokens` or `tokenLimit`.
 */
export function isSecretConfigKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return /(?:password|passwd|secret|apikey|accesskey|privatekey|encrypt(?:ion)?key|encodingaeskey|credential|authorization|cookie)/u.test(normalized)
    || normalized === 'pwd'
    || /token(?:v[0-9]+)?$/u.test(normalized)
    || /(?:^|api|access|refresh|auth|bearer|bot|oauth|session|private|client|app|verify|verification)tokens(?:v[0-9]+)?$/u.test(normalized);
}

/** Schema annotation: `x-zhin-secret: true`, `writeOnly`, `secret`, password format/component. */
export function isSecretConfigSchema(schema: ConfigSchemaNode): boolean {
  const metadata = schema['x-zhin-config'];
  return schema[CONFIG_SECRET_KEYWORD] === true || schema.writeOnly === true || schema.secret === true
    || schema.format === 'password' || schema.component === 'password'
    || record(metadata) && (metadata.secret === true || metadata.component === 'password');
}

/** Placeholder for a schema the walker cannot resolve (`$ref` loops, non-objects). */
export const UNRESOLVED_CONFIG_SCHEMA: ConfigSchemaNode = Object.freeze({});

/** Expands local `$ref` and every combinator branch; any branch's annotation applies. */
export function expandConfigSchema(node: unknown, root: ConfigSchemaNode, seen: ReadonlySet<unknown> = new Set()): ConfigSchemaNode[] {
  if (!record(node) || seen.has(node) || seen.size > MAX_DEPTH) return [UNRESOLVED_CONFIG_SCHEMA];
  const nextSeen = new Set([...seen, node]);
  const nodes: ConfigSchemaNode[] = [node];
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let referenced: unknown = root;
    for (const raw of node.$ref.slice(2).split('/')) {
      const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      referenced = record(referenced) && Object.hasOwn(referenced, key) ? referenced[key] : undefined;
    }
    nodes.push(...expandConfigSchema(referenced, root, nextSeen));
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const branches = node[keyword];
    if (Array.isArray(branches)) for (const branch of branches) nodes.push(...expandConfigSchema(branch, root, nextSeen));
  }
  return nodes;
}

/** Schemas that may describe `key` (property, pattern, additional property or array item). */
export function configSchemaChildren(nodes: readonly ConfigSchemaNode[], key: string, root: ConfigSchemaNode): ConfigSchemaNode[] {
  const next: ConfigSchemaNode[] = [];
  for (const node of nodes) {
    let matched = false;
    if (record(node.properties) && Object.hasOwn(node.properties, key)) {
      next.push(...expandConfigSchema(node.properties[key], root)); matched = true;
    }
    if (record(node.patternProperties)) {
      for (const [pattern, child] of Object.entries(node.patternProperties)) {
        let test: boolean;
        try { test = new RegExp(pattern, 'u').test(key); } catch { test = false; }
        if (test) { next.push(...expandConfigSchema(child, root)); matched = true; }
      }
    }
    if (!matched && record(node.additionalProperties)) next.push(...expandConfigSchema(node.additionalProperties, root));
    if (/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      const index = Number(key);
      if (Array.isArray(node.prefixItems) && index < node.prefixItems.length) next.push(...expandConfigSchema(node.prefixItems[index], root));
      else if (record(node.items)) next.push(...expandConfigSchema(node.items, root));
    }
  }
  return next;
}

/** `${VAR}` / `env://VAR` — a value that refers to the environment instead of holding a secret. */
export function isConfigEnvironmentReference(value: string): boolean {
  return /\$\{|^env:\/\//u.test(value);
}

export interface LiteralConfigSecret {
  /** Document path, e.g. `['http', 'token']` or `['qq', 'endpoints', '0', 'secret']`. */
  readonly path: readonly string[];
}

export interface LiteralConfigSecretSchemas {
  /** Schema of the Host keys (`http`, `database`, `ai`, …): the Host config schema. */
  readonly host?: ConfigSchemaNode;
  /**
   * Plugin config schemas by document path: `[['plugin'], rootSchema]`, `[['qq'], qqSchema]`,
   * `[['parent', 'child'], childSchema]`. Blocks without a schema still get the name fallback.
   */
  readonly plugins?: Iterable<readonly [readonly string[], ConfigSchemaNode | undefined]>;
}

const DECLARATION_KEYS = new Set(['configVersion', 'plugins', 'disable_plugins']);

/**
 * Secret fields holding a literal string (not a `${…}` / `env://` reference) in a raw,
 * unexpanded config document. Returns paths only — never values.
 */
export function findLiteralConfigSecrets(document: unknown, schemas: LiteralConfigSecretSchemas = {}): readonly LiteralConfigSecret[] {
  if (!record(document)) return Object.freeze([]);
  const pluginSchemas = new Map<string, ConfigSchemaNode>();
  for (const [path, schema] of schemas.plugins ?? []) if (schema) pluginSchemas.set(JSON.stringify(path), schema);
  const hostRoot = schemas.host;
  const hostProperties = hostRoot && record(hostRoot.properties) ? hostRoot.properties : {};
  const found: LiteralConfigSecret[] = [];

  const visit = (value: unknown, path: readonly string[], nodes: readonly ConfigSchemaNode[], root: ConfigSchemaNode, inherited: boolean): void => {
    if (path.length > MAX_DEPTH) return;
    const plugin = pluginSchemas.get(JSON.stringify(path));
    if (plugin) { root = plugin; nodes = expandConfigSchema(plugin, plugin); }
    const secret = inherited || nodes.some(isSecretConfigSchema);
    if (typeof value === 'string') {
      if (secret && value.trim() !== '' && !isConfigEnvironmentReference(value)) found.push(Object.freeze({ path: Object.freeze([...path]) }));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)], configSchemaChildren(nodes, String(index), root), root, secret));
      return;
    }
    if (!record(value)) return;
    for (const [key, item] of Object.entries(value)) {
      visit(item, [...path, key], configSchemaChildren(nodes, key, root), root, secret || isSecretConfigKey(key));
    }
  };

  for (const [key, value] of Object.entries(document)) {
    if (DECLARATION_KEYS.has(key)) continue;
    const hostSchema = Object.hasOwn(hostProperties, key) && key !== 'plugin' ? hostProperties[key] : undefined;
    const nodes = hostRoot && hostSchema !== undefined ? expandConfigSchema(hostSchema, hostRoot) : [];
    visit(value, [key], nodes, hostRoot ?? {}, isSecretConfigKey(key));
  }
  return Object.freeze(found);
}

/** One warning line for literal secret paths (never values), with the `zhin doctor --fix` hint. */
export function formatLiteralConfigSecretWarning(secrets: readonly LiteralConfigSecret[], configFile = 'zhin.config.yml'): string {
  return `${configFile} 中有 ${secrets.length} 个密钥字段是明文：${secrets.map(item => formatConfigSecretPath(item.path)).join(', ')}；`
    + '运行 zhin doctor --fix 把它们移到 .env 并改为 ${VAR} 引用（ADR 0057）';
}

/** `a.b[0].c`-style display of a config path, for warnings that must not carry values. */
export function formatConfigSecretPath(path: readonly string[]): string {
  return path.map((segment, index) => /^(?:0|[1-9][0-9]*)$/u.test(segment) ? `[${segment}]`
    : /^[A-Za-z_$][\w$-]*$/u.test(segment) ? `${index === 0 ? '' : '.'}${segment}`
      : `[${JSON.stringify(segment)}]`).join('');
}

/** Document path of each committed Plugin's config block (`['plugin']` for the Root). */
export function snapshotConfigSecretSchemas(snapshot: Pick<RuntimeSnapshot, 'root' | 'tree'>): readonly (readonly [readonly string[], ConfigSchemaNode | undefined])[] {
  const pathOf = (node: PluginNodeSnapshot): readonly string[] | undefined => {
    const path: string[] = [];
    let current: PluginNodeSnapshot | undefined = node;
    for (let depth = 0; current && current.id !== snapshot.root; depth += 1) {
      if (depth > MAX_DEPTH) return undefined;
      path.unshift(current.instanceKey);
      current = current.parent ? snapshot.tree.get(current.parent) : undefined;
    }
    return current ? path : undefined;
  };
  const entries: (readonly [readonly string[], ConfigSchemaNode | undefined])[] = [];
  for (const node of snapshot.tree.values()) {
    const path = node.id === snapshot.root ? ['plugin'] : pathOf(node);
    if (path?.length) entries.push([path, node.configSchema]);
  }
  return entries;
}
