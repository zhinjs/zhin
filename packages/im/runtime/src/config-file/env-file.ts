import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicWriteFile } from './atomic-file.js';
import { withConfigFileLock } from './config-file-lock.js';

/** Mode for a new dotenv file: it holds secrets (ADR 0057). */
export const DOTENV_FILE_MODE = 0o600;

/** Text of a dotenv file; `''` when it does not exist. */
export async function readDotenvFile(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return '';
    throw error;
  }
}

/**
 * The one `.env` writer (ADR 0057 §4): under the same cooperative lock as the YAML config
 * (`.<name>.zhin-lock`), writes a temporary file, fsyncs and renames it, keeping the
 * existing file's mode (`0600` for a new file).
 */
export async function writeDotenvFile(file: string, content: string): Promise<void> {
  await updateDotenvFile(file, () => content);
}

/**
 * Read-modify-write of a dotenv file inside one lock, so concurrent writers (gateway,
 * `zhin doctor --fix`, setup) never lose each other's lines. `update` returns the new text,
 * or `undefined` to leave the file unchanged. Resolves to the text now on disk.
 */
export async function updateDotenvFile(file: string, update: (current: string) => string | undefined): Promise<string> {
  const target = await resolveTarget(file);
  return withConfigFileLock(target, async () => {
    const current = await readDotenvFile(target);
    const next = update(current);
    if (next === undefined || next === current && await exists(target)) return current;
    await atomicWriteFile(target, next, { mode: await existingMode(target) ?? DOTENV_FILE_MODE });
    return next;
  });
}

/** Writes through a symlinked `.env` to the file it points at instead of replacing the link. */
async function resolveTarget(file: string): Promise<string> {
  try { return await realpath(file); }
  catch (error) { if (hasCode(error, 'ENOENT')) return resolve(file); throw error; }
}

async function existingMode(file: string): Promise<number | undefined> {
  try { return (await stat(file)).mode & 0o7777; }
  catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; }
}

async function exists(file: string): Promise<boolean> {
  return await existingMode(file) !== undefined;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
