// Retired @zhin.js packages in a project: which directories the import scan reads, its limits, and
// how doctor / migrate report a truncated or failed scan (#1250 retired-package-not-flagged).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspace = vi.hoisted(() => ({ fail: undefined as Error | undefined }));
vi.mock('../../src/utils/workspace-packages.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/utils/workspace-packages.js')>();
  return {
    ...actual,
    listWorkspacePackageDirs: (root: string) => {
      if (workspace.fail) throw workspace.fail;
      return actual.listWorkspacePackageDirs(root);
    },
  };
});

const { libHoldsSources, retiredPackagesResult, scanProjectRetiredImports } = await import('../../src/utils/retired-packages-check.js');
const { reportRetiredPackages } = await import('../../src/commands/migrate.js');

const roots: string[] = [];
afterEach(() => {
  workspace.fail = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const IMPORT = "import a from '@zhin.js/isolate';\n";

function project(files: Record<string, string>, manifest: Record<string, unknown> = { name: 'bot' }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-scan-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const scannedFiles = (root: string) => scanProjectRetiredImports(root).uses.map(use => use.file);

describe('scanProjectRetiredImports', () => {
  it('skips dependency and build output directories, build and out included', () => {
    const root = project({
      'src/a.ts': IMPORT,
      'build/a.js': IMPORT,
      'out/a.js': IMPORT,
      'dist/a.js': IMPORT,
      'lib/a.js': IMPORT,
      'node_modules/x/a.js': IMPORT,
      '.cache/a.js': IMPORT,
    }, { name: 'bot', main: 'lib/a.js' });
    expect(scannedFiles(root)).toEqual(['src/a.ts']);
  });

  it('reads lib when package.json points into it and there is no src (a plain JavaScript package)', () => {
    const root = project({ 'lib/index.js': IMPORT, 'plugins/foo/lib/index.mjs': IMPORT, 'plugins/foo/package.json': JSON.stringify({ exports: { '.': { import: './lib/index.mjs' } } }) },
      { name: 'bot', main: './lib/index.js' });
    expect(libHoldsSources(root)).toBe(true);
    expect(scannedFiles(root)).toEqual(['lib/index.js', 'plugins/foo/lib/index.mjs']);
    // Without a pointer into lib, lib stays build output.
    const other = project({ 'lib/index.js': IMPORT }, { name: 'bot', main: 'index.js' });
    expect(libHoldsSources(other)).toBe(false);
    expect(scannedFiles(other)).toEqual([]);
  });

  it('stops at the source-file and directory-entry limits and says so', () => {
    const root = project({ 'a.ts': IMPORT, 'b.ts': IMPORT, 'c.ts': IMPORT });
    expect(scanProjectRetiredImports(root)).toMatchObject({ scannedFiles: 3, truncated: false });
    const byFiles = scanProjectRetiredImports(root, { maxSourceFiles: 2 });
    expect(byFiles).toMatchObject({ scannedFiles: 2, truncated: true });
    expect(byFiles.uses.map(use => use.file)).toEqual(['a.ts', 'b.ts']);
    // package.json counts as an entry too: a.ts, b.ts, c.ts, package.json.
    const byEntries = scanProjectRetiredImports(root, { maxDirectoryEntries: 2 });
    expect(byEntries).toMatchObject({ scannedFiles: 2, truncated: true });
    // Exactly at the limit is not truncated.
    expect(scanProjectRetiredImports(root, { maxSourceFiles: 3, maxDirectoryEntries: 4 }).truncated).toBe(false);
  });

  it('notes a truncated scan in doctor and migrate', () => {
    const root = project({ 'a.ts': IMPORT, 'b.ts': "export const b = 1;\n" });
    const doctor = retiredPackagesResult(root, { maxSourceFiles: 1 });
    expect(doctor.status).toBe('warn');
    expect(doctor.message).toContain('仅扫描了前 1 个源文件');
    expect(retiredPackagesResult(root).message).not.toContain('仅扫描了前');

    const clean = project({ 'a.ts': "export const a = 1;\n", 'b.ts': "export const b = 1;\n" });
    expect(retiredPackagesResult(clean, { maxSourceFiles: 1 })).toMatchObject({ status: 'ok', message: expect.stringContaining('仅扫描了前 1 个源文件') });

    const lines: string[] = [];
    expect(reportRetiredPackages(root, line => lines.push(line), { maxSourceFiles: 1 })).toBe(0);
    expect(lines.join('\n')).toContain('仅扫描了前 1 个源文件');
  });
});

describe('reportRetiredPackages', () => {
  it('turns a failing check into a warning instead of ending the migration', () => {
    const root = project({ 'a.ts': IMPORT }, { name: 'bot', dependencies: { '@zhin.js/isolate': '^1.0.0' } });
    workspace.fail = new Error('pnpm-workspace.yaml: bad indentation\n  at line 2');
    const lines: string[] = [];
    expect(() => reportRetiredPackages(root, line => lines.push(line))).not.toThrow();
    expect(reportRetiredPackages(root, line => lines.push(line))).toBe(0);
    expect(lines.join('\n')).toContain('无法检查已并入或停更的 @zhin.js 包：pnpm-workspace.yaml: bad indentation');
    expect(lines.join('\n')).not.toContain('at line 2');
    // doctor does the same.
    expect(retiredPackagesResult(root)).toMatchObject({ status: 'warn', message: '无法检查：pnpm-workspace.yaml: bad indentation' });

    workspace.fail = undefined;
    lines.length = 0;
    expect(reportRetiredPackages(root, line => lines.push(line))).toBe(1);
  });
});
