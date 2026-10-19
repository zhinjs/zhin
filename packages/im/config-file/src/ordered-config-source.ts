import { isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document, type Node } from 'yaml';
import { ConfigPatchPathError, type ConfigPatch, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { ConfigDocumentParseError, type ConfigFileFormat } from './config-file-document.js';

/** Source metadata is separate from JS objects, whose integer keys are reordered. */
export function readSourcePluginOrder(source: string, format: ConfigFileFormat): readonly string[] | undefined {
  const document = parseOrderedV2Source('<config>', source, format);
  return document ? pluginOrder(document) : undefined;
}

export function writesV2Document(patches: readonly ConfigPatch[]): boolean {
  return patches.some(patch => patch.op === 'set' && (
    patch.path.length === 1 && patch.path[0] === 'configVersion' && patch.value === 2
    || patch.path.length === 0 && patch.value !== null && typeof patch.value === 'object' && 'configVersion' in patch.value && patch.value.configVersion === 2
  ));
}

export function parseOrderedV2Source(file: string, source: string, format: ConfigFileFormat, force = false): Document | undefined {
  // Preserve JSON v1's existing JSON.parse behavior (including duplicate keys).
  if (format === 'JSON') {
    const value = JSON.parse(source) as Record<string, unknown> | null;
    if (!force && (!value || typeof value !== 'object' || value.configVersion !== 2)) return undefined;
  }
  const document = parseDocument(source, { strict: true, prettyErrors: true, uniqueKeys: true });
  if (!force && format === 'YAML' && document.get('configVersion') !== 2) return undefined;
  if (document.errors.length) {
    throw new ConfigDocumentParseError(file, format, document.errors.map(error => error.message));
  }
  visit(document, (_, node) => {
    if (!isMap(node)) return;
    const keys = new Set<string>();
    for (const pair of node.items) {
      if (!isScalar(pair.key)) throw new ConfigDocumentParseError(file, format, ['v2 object keys must be scalars']);
      const key = String(pair.key.value);
      if (keys.has(key)) throw new ConfigDocumentParseError(file, format, [`Duplicate object key: ${key}`]);
      keys.add(key);
    }
  });
  return document;
}

export function pluginOrder(document: Document): readonly string[] {
  const plugins = document.get('plugins', true);
  if (plugins === undefined) return Object.freeze([]);
  if (!isMap(plugins)) throw new TypeError('v2 plugins must be an alias-to-package object');
  return Object.freeze(plugins.items.map(pair => String(isScalar(pair.key) ? pair.key.value : pair.key)));
}

/** Replacements retain existing object-key order; new keys append in patch order. */
function orderedNode(document: Document, value: unknown, previous: unknown): Node | null {
  const next = document.createNode(structuredClone(value));
  retainOrder(next, previous);
  return next;
}

function canonicalKey(key: unknown): string {
  return String(isScalar(key) ? key.value : key);
}

function retainOrder(next: unknown, previous: unknown): void {
  if (isNode(next) && isNode(previous)) {
    next.comment = previous.comment;
    next.commentBefore = previous.commentBefore;
    next.spaceBefore = previous.spaceBefore;
  }
  if (isMap(next) && isMap(previous)) {
    const items = [...next.items];
    next.items = [];
    for (const old of previous.items) {
      const key = canonicalKey(old.key);
      const index = items.findIndex(pair => canonicalKey(pair.key) === key);
      if (index >= 0) {
        const [pair] = items.splice(index, 1);
        if (!pair) throw new Error('Missing ordered configuration Pair');
        pair.key = old.key;
        retainOrder(pair.value, old.value);
        next.items.push(pair);
      }
    }
    next.items.push(...items);
  } else if (isSeq(next) && isSeq(previous)) {
    next.items.forEach((item, index) => retainOrder(item, previous.items[index]));
  }
}

export function patchOrderedSource(document: Document, patches: readonly ConfigPatch[]): void {
  for (const patch of patches) {
    for (const part of patch.path) {
      if (!part || ['__proto__', 'constructor', 'prototype'].includes(part)) throw new ConfigPatchPathError(`Unsafe config path: ${part}`);
    }
    const path: unknown[] = [];
    let parent: unknown = document.contents;
    for (const part of patch.path) {
      if (isSeq(parent)) {
        if (!/^(0|[1-9]\d*)$/.test(part)) throw new ConfigPatchPathError(`Config path requires an array index, got ${part}`);
        const index = Number(part);
        if (index >= parent.items.length) throw new ConfigPatchPathError(`Config path index ${part} is out of bounds`);
        path.push(index);
        parent = parent.get(index, true);
      } else if (isMap(parent)) {
        // Config paths use JS property names; YAML source keys may be numeric
        // scalars. Match by canonical name but address the original scalar type.
        const existing = parent.items.find(pair => canonicalKey(pair.key) === part);
        const key = existing && isScalar(existing.key) ? existing.key.value : part;
        path.push(key);
        parent = parent.get(key, true);
      } else if (parent === undefined || parent === null) {
        path.push(part);
      } else throw new ConfigPatchPathError(`Config path is not an object: ${part}`);
    }
    if (!patch.path.length) {
      if (patch.op === 'remove' || !patch.value || typeof patch.value !== 'object' || Array.isArray(patch.value)) throw new TypeError('The config root must be an object');
      document.contents = orderedNode(document, patch.value, document.contents);
    } else if (patch.op === 'remove') {
      document.deleteIn(path);
    } else {
      const previous = document.getIn(path, true);
      document.setIn(path, orderedNode(document, patch.value, previous));
    }
  }
}

export function stringifyOrderedJson(document: Document, original: string): string {
  const indent = original.match(/\n([ \t]+)"/u)?.[1] ?? '  ';
  const lineEnding = original.includes('\r\n') ? '\r\n' : '\n';
  function serialize(node: unknown, depth: number): string {
    const pad = indent.repeat(depth), childPad = indent.repeat(depth + 1);
    if (isMap(node)) {
      if (!node.items.length) return '{}';
      return `{\n${node.items.map(pair => `${childPad}${JSON.stringify(isScalar(pair.key) ? String(pair.key.value) : String(pair.key))}: ${serialize(pair.value, depth + 1)}`).join(',\n')}\n${pad}}`;
    }
    if (isSeq(node)) {
      if (!node.items.length) return '[]';
      return `[\n${node.items.map(item => `${childPad}${serialize(item, depth + 1)}`).join(',\n')}\n${pad}]`;
    }
    return JSON.stringify(isScalar(node) ? node.value : node) ?? 'null';
  }
  return `${serialize(document.contents, 0)}\n`.replaceAll('\n', lineEnding);
}

export function orderedDocumentValue(document: Document): RuntimeConfigDocument {
  return document.toJS({ maxAliasCount: 100 }) as RuntimeConfigDocument;
}
