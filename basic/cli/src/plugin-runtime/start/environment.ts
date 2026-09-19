import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import type { EnvironmentLayers } from '@zhin.js/runtime';

function processEnvironmentSource(): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    result[key] = value;
  }
  return Object.freeze(result);
}

/**
 * Read project dotenv files into Runtime EnvironmentLayers without changing
 * the CLI process. `.env.<environment>` deliberately overrides `.env`; the
 * Runtime applies that overlay after inherited process variables.
 */
export async function loadRuntimeEnvironmentLayers(
  root: string,
  environment: string,
): Promise<Readonly<EnvironmentLayers>> {
  const overlay: Record<string, string> = {};
  for (const name of ['.env', `.env.${environment}`]) {
    try {
      Object.assign(overlay, parseDotenv(await readFile(join(root, name), 'utf8')));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return Object.freeze({
    base: processEnvironmentSource(),
    environments: Object.freeze({
      [environment]: Object.freeze(overlay),
    }),
  });
}
