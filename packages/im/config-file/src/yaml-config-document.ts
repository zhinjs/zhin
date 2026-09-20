import {
  ConfigPatchPathError,
  type ConfigPatch,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { isMap, isSeq, parseDocument, type Document } from 'yaml';
import {
  ConfigDocumentParseError,
  ConfigFileDocument,
  type PreparedConfigFileSource,
  requireConfigObject,
} from './config-file-document.js';

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
    for (const patch of patches) applyPatch(document, patch);
    const candidateSource = stringify(document, source);
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

function stringify(document: Document, original: string): string {
  const indentation = original.match(/^( +)\S/mu)?.[1].length ?? 2;
  const source = document.toString({ indent: indentation, lineWidth: 0 });
  return original.includes('\r\n') ? source.replaceAll('\n', '\r\n') : source;
}
