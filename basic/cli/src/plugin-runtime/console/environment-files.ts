import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ENV_FILES = new Set(['.env', '.env.development', '.env.production']);

export async function readEnvFile(projectRoot: string, filename: string): Promise<string> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  const file = join(projectRoot, filename);
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

export async function writeEnvFile(projectRoot: string, filename: string, content: string): Promise<void> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  await writeFile(join(projectRoot, filename), content, 'utf8');
}
