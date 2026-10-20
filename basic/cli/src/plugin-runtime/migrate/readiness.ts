import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  LegacyCapabilityMigrator,
  type LegacyMigrationSummary,
  type MigrationDiagnostic,
} from './legacy-command-migrator.js';
import { PackageCutover, type CutoverCapability } from './package-cutover.js';

export type MigrationReadinessState =
  | 'blocked'
  | 'extraction-required'
  | 'cutover-required'
  | 'dual-run'
  | 'compat'
  | 'ready';

export interface MigrationImportReference {
  readonly source: string;
  readonly module: string;
  readonly line: number;
  readonly column: number;
  /** How the module was imported; used to classify `zhin.js` facade vs classic APIs. */
  readonly kind: 'named' | 'namespace' | 'default' | 'star' | 'side-effect' | 'dynamic';
  /** Named bindings (empty for namespace/default/dynamic/side-effect). */
  readonly bindings: readonly string[];
}

export interface MigrationCutoverStatus {
  readonly state: 'required' | 'complete' | 'blocked';
  readonly capabilities: readonly CutoverCapability[];
  readonly error?: string;
}

export interface MigrationReadinessReport {
  readonly root: string;
  readonly state: MigrationReadinessState;
  readonly extraction: LegacyMigrationSummary;
  readonly cutover: MigrationCutoverStatus;
  readonly legacyImports: readonly MigrationImportReference[];
  readonly compatImports: readonly MigrationImportReference[];
  readonly diagnostics: readonly MigrationDiagnostic[];
}

const ignoredDirectories = new Set([
  '.git', '.zhin', 'coverage', 'dist', 'lib', 'node_modules',
]);
/** Direct imports of IM internals still count as dual-run for plugin authors. */
const legacyModules = new Set(['@zhin.js/core', '@zhin.js/kernel']);
/**
 * `zhin.js` 主入口已是作者门面（definePlugin / Host tokens 等）。
 * 仅当仍从 `zhin.js` 拉取经典 API 时记为 dual-run。
 */
const legacyZhinJsBindings = new Set([
  'usePlugin',
  'getPlugin',
  'bootstrapNode',
  'MessageCommand',
]);

export class MigrationReadiness {
  async inspect(projectRoot: string): Promise<MigrationReadinessReport> {
    const root = resolve(projectRoot);
    const migrator = new LegacyCapabilityMigrator();
    const plan = await migrator.plan(root);
    const extraction = migrator.summarize(plan);
    const imports = await importReferences(root);
    const legacyImports = imports.filter((item) => isLegacyImport(item));
    const compatImports = imports.filter((item) => item.module === '@zhin.js/next-compat');
    const cutover = await inspectCutover(root);
    return Object.freeze({
      root,
      state: readinessState(extraction, cutover, legacyImports, compatImports),
      extraction,
      cutover,
      legacyImports: Object.freeze(legacyImports),
      compatImports: Object.freeze(compatImports),
      diagnostics: plan.diagnostics,
    });
  }
}

function isLegacyImport(item: MigrationImportReference): boolean {
  if (legacyModules.has(item.module)) return true;
  if (item.module !== 'zhin.js') return false;
  // namespace / default / bare re-export of the whole facade still treated as dual-run
  if (item.kind === 'namespace' || item.kind === 'default' || item.kind === 'star') return true;
  if (item.kind === 'dynamic') return true;
  return item.bindings.some((name) => legacyZhinJsBindings.has(name));
}

async function inspectCutover(root: string): Promise<MigrationCutoverStatus> {
  try {
    const plan = await new PackageCutover().plan(root);
    return Object.freeze({
      state: plan.changed ? 'required' : 'complete',
      capabilities: plan.capabilities,
    });
  } catch (error) {
    return Object.freeze({
      state: 'blocked',
      capabilities: Object.freeze([]),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readinessState(
  extraction: LegacyMigrationSummary,
  cutover: MigrationCutoverStatus,
  legacyImports: readonly MigrationImportReference[],
  compatImports: readonly MigrationImportReference[],
): MigrationReadinessState {
  if (extraction.errors > 0 || extraction.manual > 0 || cutover.state === 'blocked') {
    return 'blocked';
  }
  if (extraction.automatic > 0) return 'extraction-required';
  if (cutover.state === 'required') return 'cutover-required';
  if (legacyImports.length > 0) return 'dual-run';
  if (compatImports.length > 0) return 'compat';
  return 'ready';
}

async function importReferences(root: string): Promise<MigrationImportReference[]> {
  const result: MigrationImportReference[] = [];
  for (const source of await sourceFiles(root)) {
    const file = ts.createSourceFile(
      source,
      await readFile(source, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      source.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      const reference = importReference(node, source, file);
      if (reference) result.push(reference);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return result.sort((left, right) => left.source.localeCompare(right.source)
    || left.line - right.line || left.column - right.column || left.module.localeCompare(right.module));
}

function importReference(
  node: ts.Node,
  source: string,
  file: ts.SourceFile,
): MigrationImportReference | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    const { kind, bindings } = classifyModuleImport(node);
    return Object.freeze({
      source,
      module: node.moduleSpecifier.text,
      line: position.line + 1,
      column: position.character + 1,
      kind,
      bindings: Object.freeze(bindings),
    });
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    const argument = node.arguments[0];
    if ((dynamicImport || requireCall) && argument && ts.isStringLiteral(argument)) {
      const position = file.getLineAndCharacterOfPosition(node.getStart(file));
      return Object.freeze({
        source,
        module: argument.text,
        line: position.line + 1,
        column: position.character + 1,
        kind: 'dynamic',
        bindings: Object.freeze([]),
      });
    }
  }
  return undefined;
}

function classifyModuleImport(node: ts.ImportDeclaration | ts.ExportDeclaration): {
  readonly kind: MigrationImportReference['kind'];
  readonly bindings: readonly string[];
} {
  if (ts.isExportDeclaration(node)) {
    if (!node.exportClause) return { kind: 'star', bindings: [] };
    if (ts.isNamespaceExport(node.exportClause)) return { kind: 'namespace', bindings: [] };
    if (ts.isNamedExports(node.exportClause)) {
      return {
        kind: 'named',
        bindings: node.exportClause.elements.map((el) => (
          el.propertyName ? el.propertyName.text : el.name.text
        )),
      };
    }
    return { kind: 'side-effect', bindings: [] };
  }

  if (!node.importClause) return { kind: 'side-effect', bindings: [] };
  if (node.importClause.isTypeOnly && !node.importClause.namedBindings && !node.importClause.name) {
    return { kind: 'side-effect', bindings: [] };
  }
  if (node.importClause.name && !node.importClause.namedBindings) {
    return { kind: 'default', bindings: [] };
  }
  const named = node.importClause.namedBindings;
  if (named && ts.isNamespaceImport(named)) return { kind: 'namespace', bindings: [] };
  if (named && ts.isNamedImports(named)) {
    return {
      kind: 'named',
      bindings: named.elements.map((el) => (el.propertyName ? el.propertyName.text : el.name.text)),
    };
  }
  if (node.importClause.name) return { kind: 'default', bindings: [] };
  return { kind: 'side-effect', bindings: [] };
}

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
        await visit(join(directory, entry.name));
      } else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) {
        result.push(join(directory, entry.name));
      }
    }
  };
  await visit(root);
  return result;
}

export function relativeReadinessReport(
  report: MigrationReadinessReport,
): Omit<MigrationReadinessReport, 'root'> & { readonly root: '.' } {
  const references = (items: readonly MigrationImportReference[]) => items.map((item) => ({
    ...item,
    source: relative(report.root, item.source),
  }));
  return Object.freeze({
    ...report,
    root: '.',
    legacyImports: Object.freeze(references(report.legacyImports)),
    compatImports: Object.freeze(references(report.compatImports)),
    diagnostics: Object.freeze(report.diagnostics.map((item) => ({
      ...item,
      source: relative(report.root, item.source),
    }))),
  });
}

/** Only a fully native project is a successful migration check. */
export function migrationStatusExitCode(report: MigrationReadinessReport): 0 | 1 {
  return report.state === 'ready' ? 0 : 1;
}
