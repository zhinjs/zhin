import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadProjectConfig } from '@zhin.js/scaffold-wizard';

/** Lockfiles of every supported manager; all are captured so a manager switch is also undone. */
export const PROJECT_LOCKFILES: readonly string[] = Object.freeze([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb',
]);

interface CapturedFile {
  readonly path: string;
  /** `null`: the file did not exist. */
  readonly content: Buffer | null;
  readonly mode?: number;
}

/** Files a dependency transaction may change, captured before it starts. */
export class ProjectFileSnapshot {
  readonly #files: readonly CapturedFile[];
  private constructor(files: readonly CapturedFile[]) { this.#files = files; }

  /** package.json, lockfiles, pnpm-workspace.yaml and the root config file. */
  static async capture(projectRoot: string, extra: readonly string[] = []): Promise<ProjectFileSnapshot> {
    const root = resolve(projectRoot);
    const names = new Set(['package.json', ...PROJECT_LOCKFILES, 'pnpm-workspace.yaml', ...extra]);
    const loaded = loadProjectConfig(root);
    if (loaded.configPath) names.add(loaded.configPath);
    const files: CapturedFile[] = [];
    for (const name of names) {
      const path = isAbsolute(name) ? name : join(root, name);
      const inside = relative(root, path);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`Snapshot path escapes the project: ${name}`);
      files.push(await captureFile(path));
    }
    return new ProjectFileSnapshot(Object.freeze(files));
  }

  /** Whether a lockfile existed, so the rollback can reinstall with a frozen lockfile. */
  get hasLockfile(): boolean {
    return this.#files.some(file => file.content !== null && PROJECT_LOCKFILES.includes(basename(file.path)));
  }

  get paths(): readonly string[] { return this.#files.map(file => file.path); }

  /** Writes back every changed file (atomically) and removes files created since the capture. */
  async restore(): Promise<void> {
    for (const file of this.#files) {
      const current = await readOptional(file.path);
      if (file.content === null) {
        if (current !== null) await rm(file.path, { force: true });
        continue;
      }
      if (current !== null && current.equals(file.content)) continue;
      const temporary = join(dirname(file.path), `.${basename(file.path)}.${randomUUID()}.restore`);
      try {
        await writeFile(temporary, file.content, { flag: 'wx', ...(file.mode === undefined ? {} : { mode: file.mode }) });
        await rename(temporary, file.path);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  }
}

async function captureFile(path: string): Promise<CapturedFile> {
  const content = await readOptional(path);
  if (content === null) return Object.freeze({ path, content: null });
  const { mode } = await stat(path);
  return Object.freeze({ path, content, mode: mode & 0o777 });
}

async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
