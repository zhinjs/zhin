import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import type { ClientModuleArtifact } from '@zhin.js/console-contract';
import {
  assertLayoutModule,
  extractPageMetadata,
} from './static-metadata.js';
import { rewriteBareImportsForBrowser } from '../node/esmForBrowser.js';
import type {
  ClientArtifactManifest,
  ClientArtifactRecord,
  ClientBuildEntry,
  ClientModuleLoader,
  TypeScriptClientBuilderOptions,
} from './types.js';

const pageFeature = 'zhin.page';
const layoutFeature = 'zhin.layout';

export class TypeScriptClientBuilder implements ClientModuleLoader {
  readonly #outDir: string;
  readonly #projectRoot: string;
  readonly #publicBase: string;
  /** Console public base for rewritten bare imports (`/esm/…`); defaults to `/`. */
  readonly #consoleBasePath: string;
  readonly #manifestFile: string;

  constructor(options: TypeScriptClientBuilderOptions) {
    this.#outDir = resolve(options.outDir);
    this.#projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.#publicBase = `/${trimSlashes(options.publicBase ?? '@zhin/client')}`;
    this.#consoleBasePath = options.consoleBasePath ?? '/';
    this.#manifestFile = resolve(options.manifestFile ?? join(this.#outDir, 'pages.manifest.json'));
  }

  async load<T = unknown>(source: string, request: ClientModuleRequest): Promise<T> {
    const text = await readFile(source, 'utf8');
    const metadata = metadataFor(text, source, request);
    const hash = contentHash(text);
    const fileName = `${safe(request.owner)}-${safe(request.localName)}-${hash}.js`;
    const output = join(this.#outDir, fileName);
    // JSX 产物含 `from "react/jsx-runtime"` 等裸导入；浏览器 ESM 无法解析，
    // 改写为 Host `/esm/<enc>.mjs`（与 legacy consoleApiRouter 对齐）。
    const code = rewriteBareImportsForBrowser(transpile(text, source), this.#consoleBasePath, '');
    await atomicWrite(output, code);
    return Object.freeze({
      module: `${this.#publicBase}/${fileName}`,
      hash,
      metadata,
    }) as T;
  }

  async build(entries: readonly ClientBuildEntry[]): Promise<Readonly<ClientArtifactManifest>> {
    const records: ClientArtifactRecord[] = [];
    for (const entry of [...entries].sort(compareEntry)) {
      const artifact = await this.load<ClientModuleArtifact>(entry.source, entry);
      records.push(Object.freeze({
        ...entry,
        source: manifestSource(this.#projectRoot, entry.source),
        ...artifact,
      }));
    }
    const manifest = Object.freeze({
      protocol: 1 as const,
      entries: Object.freeze(records),
    });
    await atomicWrite(this.#manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
}

function manifestSource(root: string, source: string): string {
  const result = relative(root, resolve(source));
  if (!result || result === '..' || result.startsWith(`..${sep}`)) {
    throw new Error(`Client source is outside project Root: ${source}`);
  }
  return result.split(sep).join('/');
}

function metadataFor(source: string, fileName: string, request: ClientModuleRequest): unknown {
  if (request.feature === pageFeature) return extractPageMetadata(source, fileName);
  if (request.feature === layoutFeature) {
    assertLayoutModule(source, fileName);
    return undefined;
  }
  throw new Error(`Unsupported client Feature: ${request.feature}`);
}

function transpile(source: string, fileName: string): string {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
      sourceMap: false,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }));
  }
  return result.outputText;
}

function contentHash(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function safe(value: string): string {
  const result = trimDashes(value.replace(/[^a-z0-9-]+/giu, '-')).toLowerCase();
  return result || 'root';
}

/** 线性裁剪首尾 `/`（等价于 /^\/+|\/+$/gu，无回溯 — js/polynomial-redos）。 */
function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

/** 线性裁剪首尾 `-`（等价于 /^-+|-+$/gu，无回溯 — js/polynomial-redos）。 */
function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

function compareEntry(left: ClientBuildEntry, right: ClientBuildEntry): number {
  return left.owner.localeCompare(right.owner)
    || String(left.feature).localeCompare(String(right.feature))
    || left.localName.localeCompare(right.localName)
    || left.source.localeCompare(right.source);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, content);
  await rename(temporary, path);
}
