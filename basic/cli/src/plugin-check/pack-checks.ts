/**
 * Pack checks: run the plugin's real `npm pack` (prepack included), unpack the tarball and apply
 * the same tarball rules as `pnpm check:pack-imports` (basic/cli/shared/pack-rules.mjs), plus a
 * check that every runtime-entry TypeScript file shipped as JavaScript.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import spawn from 'cross-spawn';
import {
  findBrokenPackImports,
  findPackLayoutProblems,
  scanRelativeSpecifiers,
} from '../../shared/pack-rules.mjs';
import {
  compiledRuntimeEntry,
  listAssetFiles,
  listFiles,
  listRuntimeEntrySources,
  type PluginCheckProblems,
} from './source-checks.js';

export interface PackCheckResult extends PluginCheckProblems {
  packedFiles: number;
}

interface TypeScriptPreProcessor {
  preProcessFile(source: string, readImportFiles: boolean, detectJavaScriptImports: boolean): {
    importedFiles: Array<{ fileName: string }>;
  };
}

type SpecifierScanner = (source: string) => string[];

/**
 * Prefers the plugin's own `typescript` (every `zhin new` plugin has it) for exact specifiers;
 * otherwise falls back to the dependency-free scanner.
 */
export function loadSpecifierScanner(pluginDirectory: string): { scan: SpecifierScanner; exact: boolean } {
  try {
    const requireFromPlugin = createRequire(path.join(pluginDirectory, 'package.json'));
    const typescript = requireFromPlugin('typescript') as Partial<TypeScriptPreProcessor>;
    if (typeof typescript.preProcessFile === 'function') {
      const preProcessFile = typescript.preProcessFile.bind(typescript);
      const scan: SpecifierScanner = (source) => {
        const { importedFiles } = preProcessFile(source, true, true);
        const relative = importedFiles
          .map(({ fileName }) => fileName)
          .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../'));
        return [...new Set(relative)];
      };
      return { scan, exact: true };
    }
  } catch {
    // typescript is optional here
  }
  return { scan: scanRelativeSpecifiers, exact: false };
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, npm_config_loglevel: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/** Last lines of a command's output, enough to show why prepack failed. */
function outputTail(output: string, lineCount = 15): string {
  return output.trim().split(/\r?\n/u).slice(-lineCount).join('\n');
}

/** Packs and unpacks the plugin into a temporary directory and returns the unpacked package root. */
async function packPlugin(pluginDirectory: string, workDirectory: string): Promise<string> {
  const packed = await runCommand('npm', ['pack', '--pack-destination', workDirectory], pluginDirectory);
  if (packed.code !== 0) {
    throw new Error(`npm pack 失败（退出码 ${packed.code}）：\n${outputTail(packed.output)}`);
  }
  const tarball = fs.readdirSync(workDirectory).find((file) => file.endsWith('.tgz'));
  if (!tarball) {
    throw new Error('npm pack 没有生成 .tgz');
  }
  const extracted = await runCommand('tar', ['-xzf', tarball], workDirectory);
  if (extracted.code !== 0) {
    throw new Error(`解压 ${tarball} 失败：\n${outputTail(extracted.output)}`);
  }
  return path.join(workDirectory, 'package');
}

export async function checkPluginPack(pluginDirectory: string, manifest: Record<string, unknown>): Promise<PackCheckResult> {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-plugin-check-'));
  try {
    const packageRoot = await packPlugin(pluginDirectory, workDirectory);
    const files = listFiles(packageRoot);
    const scanner = loadSpecifierScanner(pluginDirectory);
    const input = {
      files,
      manifest,
      readFile: (file: string) => fs.promises.readFile(path.join(packageRoot, file), 'utf8'),
    };
    const imports = await findBrokenPackImports({ ...input, relativeSpecifiers: scanner.scan });
    const layout = await findPackLayoutProblems(input);
    const conventions = findMissingConventionFiles(pluginDirectory, files);
    const warnings = [...imports.warnings, ...layout.warnings, ...conventions.warnings];
    if (!scanner.exact) {
      warnings.push('未找到插件依赖中的 typescript，import 检查使用近似扫描');
    }
    return {
      packedFiles: files.length,
      errors: [...imports.errors, ...layout.errors, ...conventions.errors],
      warnings,
    };
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

/** Runtime-entry TypeScript without packed JavaScript, and asset/schema files that were not packed. */
export function findMissingConventionFiles(pluginDirectory: string, packedFiles: ReadonlyArray<string>): PluginCheckProblems {
  const packed = new Set(packedFiles);
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const source of listRuntimeEntrySources(pluginDirectory)) {
    const compiled = compiledRuntimeEntry(source);
    if (!packed.has(compiled)) {
      errors.push(`${source} 没有打包对应的 ${compiled}（prepack 未生成，或 files 未包含）`);
    }
  }
  const missingAssets = listAssetFiles(pluginDirectory).filter((asset) => !packed.has(asset));
  if (missingAssets.length > 0) {
    errors.push(`${missingAssets.length} 个约定资源文件未打包，例如 ${missingAssets.slice(0, 3).join(', ')}`);
  }
  const hasSchema = fs.existsSync(path.join(pluginDirectory, 'schema.json'));
  if (hasSchema && !packed.has('schema.json')) {
    warnings.push('schema.json 未打包');
  }
  return { errors, warnings };
}
