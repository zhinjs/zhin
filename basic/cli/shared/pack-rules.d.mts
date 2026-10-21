/** Types for pack-rules.mjs (shared by scripts/check-pack-imports.mjs and `zhin plugin check`). */

export interface PackProblems {
  errors: string[];
  warnings: string[];
}

export interface PackRuleInput {
  /** Packed paths relative to the package root (posix). */
  files: ReadonlyArray<string>;
  /** package.json as found in the package directory. */
  manifest: Record<string, unknown>;
  /** Reads a packed file's text. */
  readFile: (file: string) => Promise<string>;
}

export interface PackImportInput extends PackRuleInput {
  /** Lists relative specifiers of a JavaScript source; defaults to {@link scanRelativeSpecifiers}. */
  relativeSpecifiers?: (source: string) => string[];
}

export function scanRelativeSpecifiers(source: string): string[];
export function findBrokenPackImports(input: PackImportInput): Promise<PackProblems>;
export function findPackLayoutProblems(input: PackRuleInput): Promise<PackProblems>;
export function publishedManifest(manifest: Record<string, unknown>): Record<string, unknown>;
export function entryTargets(manifest: Record<string, unknown>): Array<[string, string]>;
export function normalizePacked(file: string): string;
