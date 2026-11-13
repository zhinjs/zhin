import { join } from 'node:path';
import { readDotenvFile, writeDotenvFile } from '@zhin.js/runtime';

const ENV_FILES = new Set(['.env', '.env.development', '.env.production']);

export async function readEnvFile(projectRoot: string, filename: string): Promise<string> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  return readDotenvFile(join(projectRoot, filename));
}

/** Locked, atomic replacement that keeps the file mode (`0600` when new); ADR 0057 §4. */
export async function writeEnvFile(projectRoot: string, filename: string, content: string): Promise<void> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  await writeDotenvFile(join(projectRoot, filename), content);
}
