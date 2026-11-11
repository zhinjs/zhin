import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import type { EnvironmentLayers, EnvironmentLayersPort } from '@zhin.js/runtime';

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
export class ProjectEnvironmentFileSource implements EnvironmentLayersPort {
  readonly sources: readonly string[];
  readonly #environment: string;
  readonly #base: Readonly<Record<string, string | undefined>>;

  constructor(root: string, environment: string) {
    this.#environment = environment;
    this.#base = processEnvironmentSource();
    this.sources = Object.freeze([
      resolve(root, '.env'),
      resolve(root, `.env.${environment}`),
    ]);
  }

  async read(): Promise<Readonly<EnvironmentLayers>> {
    const overlay: Record<string, string> = {};
    for (const file of this.sources) {
      try {
        Object.assign(overlay, parseDotenv(await readFile(file, 'utf8')));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
    }
    return Object.freeze({
      base: this.#base,
      environments: Object.freeze({
        [this.#environment]: Object.freeze(overlay),
      }),
    });
  }
}

export function loadRuntimeEnvironmentLayers(
  root: string,
  environment: string,
): Promise<Readonly<EnvironmentLayers>> {
  return new ProjectEnvironmentFileSource(root, environment).read();
}
