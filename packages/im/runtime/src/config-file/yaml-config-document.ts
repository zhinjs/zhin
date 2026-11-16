import {
  ConfigPatchPathError,
  type ConfigPatch,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { isDeepStrictEqual } from 'node:util';
import { isCollection, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document } from 'yaml';
import {
  ConfigDocumentParseError,
  ConfigFileDocument,
  type PreparedConfigFileSource,
  requireConfigObject,
} from './config-file-document.js';
import { parseOrderedV2Source, patchOrderedSource, writesV2Document } from './ordered-config-source.js';

/** Comment-preserving YAML implementation of the config-file transaction. */
export class YamlConfigDocument extends ConfigFileDocument {
  readonly format = 'YAML' as const;

  protected parseSource(source: string): RuntimeConfigDocument {
    return requireConfigObject(
      this.file,
      this.format,
      parseYaml(this.file, source).toJS({ maxAliasCount: 100 }),
    );
  }

  protected patchSource(
    source: string,
    patches: readonly ConfigPatch[],
  ): PreparedConfigFileSource {
    const document = parseYaml(this.file, source);
    keepKeyLineComments(document, source);
    if (parseOrderedV2Source(this.file, source, this.format, writesV2Document(patches))) patchOrderedSource(document, patches);
    else for (const patch of patches) applyPatch(document, patch);
    const candidateSource = stringify(document, source, patches);
    return Object.freeze({
      document: this.parseSource(candidateSource),
      source: candidateSource,
    });
  }
}

function parseYaml(file: string, source: string): Document {
  const document = parseDocument(source, { prettyErrors: true, strict: true });
  if (document.errors.length > 0) {
    throw new ConfigDocumentParseError(
      file,
      'YAML',
      Object.freeze(document.errors.map((error) => error.message)),
    );
  }
  return document;
}

function applyPatch(document: Document, patch: ConfigPatch): void {
  assertPath(patch.path);
  if (patch.path.length === 0) {
    if (patch.op === 'remove') {
      throw new ConfigPatchPathError('The config document root cannot be removed');
    }
    if (!patch.value || typeof patch.value !== 'object' || Array.isArray(patch.value)) {
      throw new ConfigPatchPathError('The config document root must be an object');
    }
    document.contents = document.createNode(structuredClone(patch.value));
    return;
  }
  if (patch.op === 'set') document.setIn(resolvePath(document, patch.path), structuredClone(patch.value));
  else document.deleteIn(resolvePath(document, patch.path));
}

function resolvePath(document: Document, path: readonly string[]): (string | number)[] {
  const resolved: (string | number)[] = [];
  let node: unknown = document.contents;
  for (const [index, segment] of path.entries()) {
    const isLast = index === path.length - 1;
    if (isSeq(node)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) {
        throw new ConfigPatchPathError(
          `Config path ${pointer(path.slice(0, index + 1))} requires an array index, got "${segment}"`,
        );
      }
      const arrayIndex = Number(segment);
      if (arrayIndex >= node.items.length) {
        throw new ConfigPatchPathError(
          `Config path ${pointer(path.slice(0, index + 1))} is out of bounds (array length ${node.items.length})`,
        );
      }
      resolved.push(arrayIndex);
      node = isLast ? undefined : node.get(arrayIndex, false);
    } else if (isMap(node)) {
      resolved.push(segment);
      node = isLast ? undefined : node.get(segment, false);
    } else if (node == null) {
      resolved.push(segment);
      node = undefined;
    } else {
      throw new ConfigPatchPathError(
        `Config path ${pointer(path.slice(0, index + 1))} is not an object`,
      );
    }
  }
  return resolved;
}

function pointer(path: readonly string[]): string {
  if (path.length === 0) return '/';
  return `/${path.map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function assertPath(path: readonly string[]): void {
  for (const segment of path) {
    if (!segment || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
      throw new ConfigPatchPathError(`Unsafe config path segment: ${segment || '<empty>'}`);
    }
  }
}

function stringify(document: Document, original: string, patches: readonly ConfigPatch[] = []): string {
  const crlf = original.includes('\r\n');
  const before = crlf ? original.replaceAll('\r\n', '\n') : original;
  const indentation = before.match(/^( +)\S/mu)?.[1].length ?? 2;
  // Keep the flow-collection spacing the file already uses (`[a, b]` vs `[ a, b ]`).
  const flowCollectionPadding = /[[{] [^\s\]}]/u.test(before) && !/[[{][^\s\]}]/u.test(before);
  const rendered = document.toString({ indent: indentation, lineWidth: 0, flowCollectionPadding });
  const source = restoreUntouchedEntries(before, rendered, patches);
  return crlf ? source.replaceAll('\n', '\r\n') : source;
}

/**
 * #1250 config-write-moves-inline-comment: the YAML printer moves a comment written on a key line
 * (`"user:1": # owner` above a block list or map) to a line of its own. The parser keeps such a
 * comment as the value's `commentBefore`; when the source shows it on the key line, attach its
 * first line to the key so it prints where it was.
 */
function keepKeyLineComments(document: Document, source: string): void {
  visit(document, {
    Pair(_, pair) {
      const { key, value } = pair;
      if (!isScalar(key) || !isCollection(value) || value.flow || !value.commentBefore || key.comment) return;
      const keyEnd = key.range?.[1];
      if (keyEnd === undefined) return;
      if (!/^[ \t]*:[ \t]*#/u.test(source.slice(keyEnd))) return;
      const [first, ...rest] = value.commentBefore.split('\n');
      key.comment = first;
      value.commentBefore = rest.length > 0 ? rest.join('\n') : undefined;
    },
  });
}

/**
 * Rewrite only the top-level entries a patch touches: every other top-level entry keeps its
 * original text byte for byte (comments, quoting, blank lines, flow spacing). Falls back to the
 * full rendering when the source is not a mapping, the root is replaced, or the spliced result does
 * not parse to exactly the rendered value.
 */
function restoreUntouchedEntries(original: string, rendered: string, patches: readonly ConfigPatch[]): string {
  if (patches.some(patch => patch.path.length === 0)) return rendered;
  const before = parseDocument(original);
  const after = parseDocument(rendered);
  if (before.errors.length || after.errors.length || !isMap(before.contents) || !isMap(after.contents)) return rendered;
  const touched = new Set(patches.map(patch => patch.path[0]));
  const splices: { start: number; end: number; text: string }[] = [];
  for (const pair of after.contents.items) {
    if (!isScalar(pair.key) || touched.has(String(pair.key.value))) continue;
    const name = String(pair.key.value);
    const old = before.contents.items.find(item => isScalar(item.key) && String(item.key.value) === name);
    if (!old || !isScalar(old.key) || !isNode(old.value) || !isNode(pair.value)) continue;
    const oldStart = old.key.range?.[0];
    const oldEnd = old.value.range?.[2];
    const start = pair.key.range?.[0];
    const end = pair.value.range?.[2];
    if (oldStart === undefined || oldEnd === undefined || start === undefined || end === undefined) continue;
    if (!isDeepStrictEqual(old.value.toJS(before), pair.value.toJS(after))) continue;
    let text = original.slice(oldStart, oldEnd);
    // The last entry of either side may or may not end with a newline.
    if (rendered.slice(start, end).endsWith('\n') && !text.endsWith('\n')) text += '\n';
    splices.push({ start, end, text });
  }
  if (splices.length === 0) return rendered;
  let result = rendered;
  for (const splice of splices.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, splice.start) + splice.text + result.slice(splice.end);
  }
  const check = parseDocument(result);
  return check.errors.length === 0 && isDeepStrictEqual(check.toJS(), after.toJS()) ? result : rendered;
}
