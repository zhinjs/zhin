/**
 * Secret values written through a config patch go to `.env`, not into the config file (#1250).
 *
 * A `set` that writes a literal into a schema-marked secret field (`x-zhin-secret`, `writeOnly`,
 * `format: password`, `x-zhin-config.secret`, or the secret field-name fallback) is rewritten:
 * the value is stored as a `.env` variable and the config keeps (or gets) the `${VAR}` reference.
 * The variable is the field's canonical name derived from its path (`http.token` → `HTTP_TOKEN`,
 * with a numeric suffix when another value already holds that name). A `${VAR}` the field merely
 * references is never overwritten unless it is that canonical name: otherwise a config write could
 * replace any `.env` variable (e.g. point `http.token` at `${OPENAI_API_KEY}`, then set a literal).
 * Writing into `.env` at all needs the caller's `ops.env.write` ({@link SecretEnvironmentWriteRequiredError}).
 * Values are never returned or logged.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { updateDotenvFile } from '@zhin.js/runtime';
import type { ConfigPatch, RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { dotenvLine, findProjectLiteralSecrets, literalSecretEnvironmentName, readDocumentPath as readPath } from './literal-secrets.js';

/** How a patch stores secret values: `env` (default) or `plain` (explicit opt-out, e.g. `zhin config set --plain`). */
export type ConfigSecretStorage = 'env' | 'plain';

const WHOLE_REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

/** Result / error code when a write would store secret values in `.env` without `ops.env.write`. */
export const SECRET_ENVIRONMENT_WRITE_REQUIRED = 'env-write-required';

/** Refusal message for {@link SECRET_ENVIRONMENT_WRITE_REQUIRED}; names the fields, never values. */
export function secretEnvironmentWriteRequiredMessage(paths: readonly (readonly string[])[]): string {
  return `敏感字段 ${paths.map(path => path.join('.')).join('、')} 的值要写入 .env，需要 ops.env.write 权限；未保存。`
    + '请让有该权限的管理员设置，或在 .env 中设置变量后写入 ${VAR} 引用';
}

/** `setKey` refusal: the block holds secret literals but the caller may not write `.env`. */
export class SecretEnvironmentWriteRequiredError extends Error {
  readonly code = SECRET_ENVIRONMENT_WRITE_REQUIRED;
  constructor(readonly paths: readonly (readonly string[])[]) {
    super(secretEnvironmentWriteRequiredMessage(paths));
    this.name = 'SecretEnvironmentWriteRequiredError';
  }
}

export interface SecretAssignment {
  readonly path: readonly string[];
  readonly variable: string;
  /** Never serialized into results. */
  readonly value: string;
}

export interface SecretExternalizationPlan {
  /** `set path → ${VAR}` patches applied after the caller's patches. */
  readonly patches: readonly ConfigPatch[];
  readonly assignments: readonly SecretAssignment[];
  /** Secret values `.env` cannot hold (line breaks): the write is refused for these paths. */
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}

/** `http.token` → `HTTP_TOKEN` (the `${…}` name the scaffold uses), `qq.endpoints.0.appSecret` → `QQ_ENDPOINTS_0_APP_SECRET`. */
export function canonicalSecretVariable(path: readonly string[]): string {
  return literalSecretEnvironmentName(path).replace(/^ZHIN_/u, '');
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

async function readOptional(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
}

/**
 * Plans moving the literal secrets that `candidate` newly holds under `touched` paths (values that
 * differ from `current`) into `.env`.
 */
export async function planSecretExternalization(
  projectRoot: string,
  environmentName: string,
  current: RuntimeConfigDocument,
  candidate: RuntimeConfigDocument,
  touched: readonly (readonly string[])[],
): Promise<SecretExternalizationPlan> {
  const literals = (await findProjectLiteralSecrets(projectRoot, candidate))
    .filter(secret => touched.some(path => startsWith(secret.path, path)));
  if (literals.length === 0) return { patches: [], assignments: [], errors: [] };
  const layers = await Promise.all(['.env', `.env.${environmentName}`].map(async name => parseDotenv((await readOptional(join(projectRoot, name))) ?? '')));
  const taken = new Map<string, string>();
  for (const layer of layers) for (const [name, value] of Object.entries(layer)) taken.set(name, value);
  const patches: ConfigPatch[] = [];
  const assignments: SecretAssignment[] = [];
  const errors: { path: string; message: string }[] = [];
  for (const secret of literals) {
    const value = readPath(candidate, secret.path);
    if (typeof value !== 'string' || value === '' || value === readPath(current, secret.path)) continue;
    const label = secret.path.join('.');
    const canonical = canonicalSecretVariable(secret.path);
    const reference = WHOLE_REFERENCE.exec(String(readPath(current, secret.path) ?? ''))?.[1];
    // Only the field's own canonical variable is updated in place. Any other `${VAR}` the field
    // references may belong to something else (#1250): a fresh name is written instead.
    let variable = canonical;
    if (reference !== canonical) {
      for (let suffix = 2; (taken.has(variable) && taken.get(variable) !== value) || variable === reference; suffix += 1) {
        variable = `${canonical}_${suffix}`;
      }
    }
    if (!dotenvLine(variable, value)) {
      errors.push({ path: `$.${label}`, message: `${label} 是敏感字段，值含换行等字符，无法写入 .env；请手动在 .env 设置后引用 \${${variable}}，或明确用明文保存（zhin config set --plain）` });
      continue;
    }
    taken.set(variable, value);
    assignments.push({ path: secret.path, variable, value });
    patches.push({ op: 'set', path: secret.path, value: `\${${variable}}` });
  }
  return { patches, assignments, errors };
}

function assign(content: string, variable: string, line: string): string {
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${variable}[ \\t]*=.*$`, 'mu');
  if (pattern.test(content)) return content.replace(pattern, line);
  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${line}\n`;
}

/**
 * Writes the assignments: into `.env.<environment>` when that file already defines the variable
 * (it overrides `.env`), and into `.env` otherwise. Returns a function that restores the previous
 * contents (used when the config write does not happen after all).
 */
export async function writeSecretAssignments(
  projectRoot: string,
  environmentName: string,
  assignments: readonly SecretAssignment[],
): Promise<() => Promise<void>> {
  if (assignments.length === 0) return async () => {};
  const files = ['.env', `.env.${environmentName}`].map(name => join(projectRoot, name));
  const originals = await Promise.all(files.map(readOptional));
  const overlay = parseDotenv(originals[1] ?? '');
  const byFile = new Map<string, SecretAssignment[]>();
  for (const item of assignments) {
    const file = Object.hasOwn(overlay, item.variable) ? files[1]! : files[0]!;
    byFile.set(file, [...(byFile.get(file) ?? []), item]);
  }
  const written: string[] = [];
  try {
    for (const [file, items] of byFile) {
      await updateDotenvFile(file, content => items.reduce((text, item) => assign(text, item.variable, dotenvLine(item.variable, item.value)!), content));
      written.push(file);
    }
  } catch (error) {
    await restore(written);
    throw error;
  }
  async function restore(targets: readonly string[]): Promise<void> {
    for (const file of targets) {
      const original = originals[files.indexOf(file)];
      if (original === undefined) await rm(file, { force: true });
      else await updateDotenvFile(file, () => original);
    }
  }
  return () => restore(written);
}
