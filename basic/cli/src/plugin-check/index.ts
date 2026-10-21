/**
 * `zhin plugin check`: static checks of a plugin directory plus (by default) a real pack whose
 * tarball goes through the same rules as `pnpm check:pack-imports`.
 */
import path from 'node:path';
import { checkPeerDependencies, checkZhinManifest } from './manifest-checks.js';
import { checkPluginPack } from './pack-checks.js';
import { checkPluginSource, readPluginManifest, type PluginCheckProblems } from './source-checks.js';

export interface PluginCheckOptions {
  /** Run `npm pack` and check the tarball (default true). */
  pack?: boolean;
}

export interface PluginCheckReport {
  directory: string;
  name?: string;
  source: PluginCheckProblems;
  /** Absent when the pack step was skipped or could not start (see source errors). */
  pack?: PluginCheckProblems & { packedFiles: number };
  errorCount: number;
  warningCount: number;
}

function hasZhinManifestObject(manifest: Record<string, unknown>): boolean {
  const zhinManifest = manifest.zhin;
  return Boolean(zhinManifest) && typeof zhinManifest === 'object' && !Array.isArray(zhinManifest);
}

export async function checkPlugin(directory: string, options: PluginCheckOptions = {}): Promise<PluginCheckReport> {
  const pluginDirectory = path.resolve(directory);
  const source: PluginCheckProblems = { errors: [], warnings: [] };
  const manifest = readPluginManifest(pluginDirectory, source);
  let pack: PluginCheckReport['pack'];
  if (manifest) {
    const sourceProblems = checkPluginSource(pluginDirectory, manifest);
    source.errors.push(...sourceProblems.errors);
    source.warnings.push(...sourceProblems.warnings);
    if (hasZhinManifestObject(manifest)) {
      checkZhinManifest(pluginDirectory, manifest, source);
      checkPeerDependencies(pluginDirectory, manifest, source);
    }
    if (options.pack !== false) {
      try {
        pack = await checkPluginPack(pluginDirectory, manifest);
      } catch (error) {
        pack = { packedFiles: 0, errors: [error instanceof Error ? error.message : String(error)], warnings: [] };
      }
    }
  }
  const errorCount = source.errors.length + (pack?.errors.length ?? 0);
  const warningCount = source.warnings.length + (pack?.warnings.length ?? 0);
  return {
    directory: pluginDirectory,
    name: typeof manifest?.name === 'string' ? manifest.name : undefined,
    source,
    pack,
    errorCount,
    warningCount,
  };
}

export function formatPluginCheckReport(report: PluginCheckReport, options: PluginCheckOptions = {}): string {
  const lines = [`zhin plugin check: ${report.name ?? '(unnamed)'} (${report.directory})`];
  const appendSection = (title: string, problems: PluginCheckProblems) => {
    lines.push(`  ${title}`);
    if (problems.errors.length === 0 && problems.warnings.length === 0) {
      lines.push('    ✓ 通过');
    }
    for (const error of problems.errors) lines.push(`    ✗ ${error}`);
    for (const warning of problems.warnings) lines.push(`    ! ${warning}`);
  };
  appendSection('清单与目录', report.source);
  if (report.pack) {
    appendSection(`发布包（npm pack，${report.pack.packedFiles} 个文件）`, report.pack);
  } else if (options.pack === false) {
    lines.push('  发布包：已跳过（--no-pack）');
  }
  lines.push(`结果：${report.errorCount} 个错误，${report.warningCount} 个警告`);
  return lines.join('\n');
}
