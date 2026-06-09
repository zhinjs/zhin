/**
 * Mission Validation Spec — manifest + dry-run (missions-v2).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MissionValidationResult } from './mission-state.js';

const execFileAsync = promisify(execFile);

export type ValidationSpecRunner = (
  specPaths: string[],
  cwd?: string,
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export const defaultValidationSpecRunner: ValidationSpecRunner = async (specPaths, cwd) => {
  if (specPaths.length === 0) {
    return { ok: false, stdout: '', stderr: 'no spec paths' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'pnpm',
      ['exec', 'vitest', 'run', ...specPaths],
      { cwd: cwd ?? process.cwd(), timeout: 120_000, env: process.env },
    );
    return { ok: true, stdout: String(stdout), stderr: String(stderr) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? e.message ?? err),
    };
  }
};

let specRunner: ValidationSpecRunner = defaultValidationSpecRunner;

export function setValidationSpecRunnerForTests(runner: ValidationSpecRunner): void {
  specRunner = runner;
}

export function resetValidationSpecRunner(): void {
  specRunner = defaultValidationSpecRunner;
}

export function getValidationSpecRunner(): ValidationSpecRunner {
  return specRunner;
}

export interface MissionManifestAssertion {
  id: string;
  description?: string;
}

export interface MissionManifest {
  assertions: MissionManifestAssertion[];
}

export interface MissionSpecPaths {
  specTestPath: string;
  manifestPath: string;
}

export function defaultMissionSpecDir(runId: string): string {
  return path.join('.zhin', 'missions', runId);
}

export function defaultMissionSpecPaths(runId: string): MissionSpecPaths {
  const dir = defaultMissionSpecDir(runId);
  return {
    specTestPath: path.join(dir, 'spec.test.ts'),
    manifestPath: path.join(dir, 'manifest.json'),
  };
}

export async function readMissionManifest(manifestPath: string): Promise<MissionManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as MissionManifest;
    if (!Array.isArray(parsed.assertions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function validateMissionManifest(manifest: MissionManifest): {
  ok: boolean;
  reason?: string;
  assertionCount: number;
} {
  if (!manifest.assertions.length) {
    return { ok: false, reason: 'manifest.assertions 为空', assertionCount: 0 };
  }
  const ids = new Set<string>();
  for (const a of manifest.assertions) {
    if (!a.id?.trim()) {
      return { ok: false, reason: 'manifest 含空 assertion id', assertionCount: 0 };
    }
    if (ids.has(a.id)) {
      return { ok: false, reason: `manifest 重复 assertion id: ${a.id}`, assertionCount: 0 };
    }
    ids.add(a.id);
  }
  return { ok: true, assertionCount: manifest.assertions.length };
}

export function parseValidationOutput(stdout: string, stderr: string, ok: boolean): MissionValidationResult {
  const combined = `${stdout}\n${stderr}`;
  const passMatch = combined.match(/(\d+)\s+passed/i);
  const failMatch = combined.match(/(\d+)\s+failed/i);
  const passed = passMatch ? Number(passMatch[1]) : (ok ? 1 : 0);
  const failed = failMatch ? Number(failMatch[1]) : (ok ? 0 : 1);
  return { passed, failed, failed_ids: ok ? [] : ['spec_run'] };
}

export async function runSpecDryRun(
  specPaths: string[],
  runner?: ValidationSpecRunner,
  cwd?: string,
): Promise<{ ok: boolean; validation: MissionValidationResult; stdout: string; stderr: string }> {
  const execResult = await (runner ?? getValidationSpecRunner())(specPaths, cwd);
  const validation = parseValidationOutput(execResult.stdout, execResult.stderr, execResult.ok);
  return { ...execResult, validation };
}

export async function validateMissionSpecBundle(
  runId: string,
  specPaths: string[],
  requireManifest: boolean,
  cwd?: string,
): Promise<{
  ok: boolean;
  reason?: string;
  assertionCount?: number;
  manifestPath?: string;
  dryRun?: Awaited<ReturnType<typeof runSpecDryRun>>;
}> {
  const defaults = defaultMissionSpecPaths(runId);
  const manifestPath = specPaths.find((p) => p.endsWith('manifest.json'))
    ?? defaults.manifestPath;

  let assertionCount = 0;
  if (requireManifest) {
    const manifest = await readMissionManifest(manifestPath);
    if (!manifest) {
      return { ok: false, reason: `无法读取 manifest: ${manifestPath}` };
    }
    const check = validateMissionManifest(manifest);
    if (!check.ok) {
      return { ok: false, reason: check.reason, assertionCount: 0, manifestPath };
    }
    assertionCount = check.assertionCount;
  }

  const testPaths = specPaths.filter((p) => !p.endsWith('manifest.json'));
  const dryRun = await runSpecDryRun(testPaths.length ? testPaths : [defaults.specTestPath], undefined, cwd);
  if (!dryRun.ok || dryRun.validation.failed > 0) {
    return {
      ok: false,
      reason: 'spec dry-run 未通过',
      assertionCount,
      manifestPath,
      dryRun,
    };
  }

  return {
    ok: true,
    assertionCount: assertionCount || dryRun.validation.passed,
    manifestPath,
    dryRun,
  };
}
