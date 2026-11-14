/**
 * ADR 0057 §4: literal secrets in the YAML/JSON config move to `.env`.
 * `zhin doctor` reports them; `zhin doctor --fix` writes each literal into `.env` as
 * `ZHIN_<PATH>` and replaces the config value with `${ZHIN_<PATH>}`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import {
  HOST_CONFIG_SCHEMA, createConfigDocument, findLiteralConfigSecrets, readApplicationPluginDeclaration,
  updateDotenvFile, type ConfigSchemaNode, type LiteralConfigSecret,
} from '@zhin.js/runtime';
import type { ConfigPatch, RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { PluginSchemaCatalog } from './plugin-schema-catalog.js';

/**
 * Secret paths holding literals in `document`, using the Host schema, the root `schema.json`
 * and each declared instance's `schema.json` (annotations), plus the field-name fallback.
 * Plugins whose schema is only inline (`definePlugin({ config })`) use the name fallback here.
 */
export async function findProjectLiteralSecrets(projectRoot: string, document: RuntimeConfigDocument): Promise<readonly LiteralConfigSecret[]> {
  let instanceKeys: string[] = [];
  try { instanceKeys = readApplicationPluginDeclaration(document).instances.map(item => item.instanceKey); }
  catch { /* Invalid declarations are reported elsewhere; still scan with the name fallback. */ }
  const schemas = await new PluginSchemaCatalog(projectRoot).readJsonMany(['plugin', ...instanceKeys], document);
  const plugins: (readonly [readonly string[], ConfigSchemaNode | undefined])[] = [];
  for (const [key, schema] of schemas) {
    if (schema && !(schema instanceof Error)) plugins.push([[key], schema]);
  }
  return findLiteralConfigSecrets(document, { host: HOST_CONFIG_SCHEMA as ConfigSchemaNode, plugins });
}

/** `ZHIN_<PATH_UPPER_SNAKE>`: `http.token` → `ZHIN_HTTP_TOKEN`, `qq.endpoints[0].appSecret` → `ZHIN_QQ_ENDPOINTS_0_APP_SECRET`. */
export function literalSecretEnvironmentName(path: readonly string[]): string {
  const body = path
    .map(segment => segment.replace(/([a-z0-9])([A-Z])/gu, '$1_$2'))
    .join('_')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase();
  return `ZHIN_${body || 'SECRET'}`;
}

export interface LiteralSecretMove {
  readonly path: readonly string[];
  readonly variable: string;
  /** The variable already held this exact value; `.env` was not changed for it. */
  readonly reused: boolean;
}

export interface LiteralSecretSkip {
  readonly path: readonly string[];
  readonly reason: string;
}

export interface LiteralSecretFixResult {
  readonly moved: readonly LiteralSecretMove[];
  readonly skipped: readonly LiteralSecretSkip[];
}

/**
 * Moves every literal secret of `configFile` into `<projectRoot>/.env`.
 *
 * Order: `.env` first (locked, atomic; a variable that already holds the same value is reused,
 * a name taken by another value gets `_2`, `_3`, …), then the config file through
 * ConfigFileDocument (revision check, lock, atomic). If the config changed in between, the
 * write is refused with a conflict and nothing in the config changes; the next run reuses the
 * variables already written, so the operation is idempotent.
 */
export async function moveLiteralSecretsToEnv(projectRoot: string, configFile: string): Promise<LiteralSecretFixResult> {
  const config = createConfigDocument(configFile);
  const snapshot = await config.read();
  const secrets = await findProjectLiteralSecrets(projectRoot, snapshot.document);
  if (secrets.length === 0) return Object.freeze({ moved: Object.freeze([]), skipped: Object.freeze([]) });
  // `.env.<environment>` overrides `.env`: a name used there with another value is taken.
  const overlays = await Promise.all(['.env.development', '.env.production'].map(name => readOptional(join(projectRoot, name))));
  const shadowing = overlays.map(source => parseDotenv(source));
  const moved: LiteralSecretMove[] = [];
  const skipped: LiteralSecretSkip[] = [];
  await updateDotenvFile(join(projectRoot, '.env'), current => {
    moved.length = 0; skipped.length = 0;
    const existing: Record<string, string> = { ...parseDotenv(current) };
    const lines: string[] = [];
    for (const secret of secrets) {
      const value = readPath(snapshot.document, secret.path);
      if (typeof value !== 'string') continue;
      const line = (name: string) => dotenvLine(name, value);
      if (!line('ZHIN_PROBE')) {
        skipped.push(Object.freeze({ path: secret.path, reason: '值含换行或无法安全写入 .env，请手动迁移' }));
        continue;
      }
      const base = literalSecretEnvironmentName(secret.path);
      let variable = base;
      for (let suffix = 2; ; suffix += 1) {
        const taken = existing[variable] !== undefined && existing[variable] !== value
          || shadowing.some(layer => layer[variable] !== undefined && layer[variable] !== value);
        if (!taken) break;
        variable = `${base}_${suffix}`;
      }
      const reused = existing[variable] === value;
      if (!reused) { lines.push(line(variable)!); existing[variable] = value; }
      moved.push(Object.freeze({ path: secret.path, variable, reused }));
    }
    if (lines.length === 0) return undefined;
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    return `${current}${separator}${current.trim() ? '\n' : ''}# zhin doctor --fix：从 ${configFileLabel(configFile)} 移入的密钥（ADR 0057）\n${lines.join('\n')}\n`;
  });
  if (moved.length) {
    const patches: ConfigPatch[] = moved.map(item => ({ op: 'set', path: item.path, value: `\${${item.variable}}` }));
    const prepared = await config.prepare(snapshot, patches);
    await prepared.commit();
  }
  return Object.freeze({ moved: Object.freeze(moved), skipped: Object.freeze(skipped) });
}

/** A `NAME=value` dotenv line that parses back to exactly `value`, or undefined when none does. */
export function dotenvLine(name: string, value: string): string | undefined {
  if (/[\r\n]/u.test(value)) return undefined;
  for (const quote of ["'", '`', '"']) {
    if (value.includes(quote)) continue;
    const line = `${name}=${quote}${value}${quote}`;
    if (parseDotenv(line)[name] === value) return line;
  }
  return undefined;
}

export function readDocumentPath(document: unknown, path: readonly string[]): unknown {
  return readPath(document, path);
}

function readPath(document: unknown, path: readonly string[]): unknown {
  let current = document;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function configFileLabel(file: string): string {
  return file.split(/[\\/]/u).pop() ?? file;
}

async function readOptional(file: string): Promise<string> {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''; throw error; }
}
