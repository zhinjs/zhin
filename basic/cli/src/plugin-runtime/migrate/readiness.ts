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
const legacyModules = new Set(['zhin.js', '@zhin.js/core', '@zhin.js/kernel']);

export class MigrationReadiness {
  async inspect(projectRoot: string): Promise<MigrationReadinessReport> {
    const root = resolve(projectRoot);
    const migrator = new LegacyCapabilityMigrator();
    const plan = await migrator.plan(root);
    const extraction = migrator.summarize(plan);
    const imports = await importReferences(root);
    const legacyImports = imports.filter((item) => legacyModules.has(item.module));
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
      const module = moduleSpecifier(node);
      if (module) {
        const position = file.getLineAndCharacterOfPosition(node.getStart(file));
        result.push(Object.freeze({
          source,
          module,
          line: position.line + 1,
          column: position.character + 1,
        }));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return result.sort((left, right) => left.source.localeCompare(right.source)
    || left.line - right.line || left.column - right.column || left.module.localeCompare(right.module));
}

function moduleSpecifier(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    const argument = node.arguments[0];
    if ((dynamicImport || requireCall) && argument && ts.isStringLiteral(argument)) {
      return argument.text;
    }
  }
  return undefined;
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
