/**
 * Console environment variables (`/ops/env`): the wire shapes of `env:*` RPC (issue #1250).
 *
 * - `env:get` never returns secret text. Every variable comes back masked
 *   ({@link ConsoleEnvVariable}): the first two and the last two characters of values longer than
 *   {@link ENV_MASK_REVEAL_MIN_LENGTH}, nothing of shorter ones. Every key is masked the same way,
 *   whether or not its name looks secret. Comments and blank lines keep their place (`lines`).
 * - `env:reveal { filename, key }` returns one variable as written in the file. It requires
 *   `ops.env.write` and `ops.env.read`, and every call is audited (file, key name and caller;
 *   never the value).
 * - `env:save { filename, changes }` writes only the submitted keys; every other line stays as it
 *   is on disk. A value that looks like a mask placeholder is refused. The whole-file form
 *   (`{ filename, content }`) must say so (`mode: 'replace'`) and is refused when any value in
 *   it is a mask placeholder.
 *
 * Hosts before this protocol answered `env:get` with `{ content }` (the file as written) and had no
 * `env:reveal`; a Console tells them apart by `format` (see {@link isConsoleEnvFileView}).
 */

export const ENV_RPC = Object.freeze({
  LIST: 'env:list',
  GET: 'env:get',
  REVEAL: 'env:reveal',
  SAVE: 'env:save',
} as const);

/** The dotenv files the Console may read and write, relative to the project root. */
export const ENV_FILE_NAMES: readonly string[] = Object.freeze(['.env', '.env.development', '.env.production']);

/** One masked character. A run of {@link ENV_MASK_RUN} of them stands for the hidden part. */
export const ENV_MASK_CHAR = '●';
export const ENV_MASK_RUN = 8;
/** Values up to this length are masked completely. */
export const ENV_MASK_REVEAL_MIN_LENGTH = 8;

const MASK = ENV_MASK_CHAR.repeat(ENV_MASK_RUN);

/**
 * Masked form of a value (as the process reads it): `''` for an empty value, the mask alone for
 * values of at most {@link ENV_MASK_REVEAL_MIN_LENGTH} characters, otherwise the first two and
 * last two characters around the mask. The mask has a fixed width, so it never tells the length.
 */
export function maskConsoleEnvValue(value: string): string {
  const chars = Array.from(value);
  if (chars.length === 0) return '';
  if (chars.length <= ENV_MASK_REVEAL_MIN_LENGTH) return MASK;
  return `${chars.slice(0, 2).join('')}${MASK}${chars.slice(-2).join('')}`;
}

/**
 * Whether a value submitted for saving looks like a mask placeholder (a masked value sent back by
 * mistake): three or more mask characters in a row, or nothing but mask characters (older
 * Consoles masked short values with one mask character per character). Such values are refused.
 */
export function isConsoleEnvMaskPlaceholder(value: string): boolean {
  const text = value.trim().replace(/^(["'`])([\s\S]*)\1$/u, '$2').trim();
  return value.includes(ENV_MASK_CHAR.repeat(3)) || (text.length > 0 && [...text].every(char => char === ENV_MASK_CHAR));
}

/** One variable of `env:get` (its effective, i.e. last, assignment). Never the value itself. */
export interface ConsoleEnvVariable {
  readonly key: string;
  /** {@link maskConsoleEnvValue} of the value as the process reads it. */
  readonly masked: string;
  /** Characters in the value as the process reads it. */
  readonly length: number;
  readonly hasValue: boolean;
  /** The value is exactly one `${NAME}` reference to another variable. */
  readonly isReference?: true;
}

/**
 * One line of the file, in order. An assignment spanning several lines (quoted multi-line value)
 * is one `entry`. A comment that holds an assignment (`# KEY=value`) only shows its key and mask;
 * any other line that is neither a comment nor an assignment only shows its length.
 */
export type ConsoleEnvLine =
  | Readonly<{ kind: 'blank' }>
  | Readonly<{ kind: 'comment'; text: string }>
  | Readonly<{ kind: 'comment'; key: string; masked: string }>
  | Readonly<{ kind: 'entry'; key: string; export?: true }>
  | Readonly<{ kind: 'other'; length: number }>;

/** `env:get` result of a Host that masks values. */
export interface ConsoleEnvFileView {
  readonly format: 'masked';
  readonly file: string;
  /** One per key, in the order keys first appear. */
  readonly variables: readonly ConsoleEnvVariable[];
  readonly lines: readonly ConsoleEnvLine[];
  /**
   * The masked file as text, for Consoles that read `content` (they show it; saving it back is
   * refused because it holds mask placeholders and is not declared as a whole-file replace).
   */
  readonly content: string;
}

/** Whether an `env:get` result is the masked form (otherwise: an older Host's `{ content }`). */
export function isConsoleEnvFileView(value: unknown): value is ConsoleEnvFileView {
  return !!value && typeof value === 'object' && (value as { format?: unknown }).format === 'masked'
    && Array.isArray((value as { variables?: unknown }).variables) && Array.isArray((value as { lines?: unknown }).lines);
}

export interface ConsoleEnvRevealRequest {
  readonly filename: string;
  readonly key: string;
}

/** `env:reveal` result: the effective assignment's value exactly as written (quotes included). */
export interface ConsoleEnvRevealResult {
  readonly file: string;
  readonly key: string;
  readonly value: string;
}

/**
 * One change of `env:save`. `value` is written verbatim after `KEY=` (quote it for spaces, `#` or
 * several lines). Setting a key changes every assignment of it in place; a new key is appended.
 * Deleting removes every assignment of it.
 */
export type ConsoleEnvChange =
  | Readonly<{ key: string; value: string }>
  | Readonly<{ key: string; delete: true }>;

export type ConsoleEnvSaveRequest =
  | Readonly<{ filename: string; changes: readonly ConsoleEnvChange[] }>
  /** Whole-file replacement, for clients that must keep it; refused when any value is masked. */
  | Readonly<{ filename: string; content: string; mode: 'replace' }>;

export interface ConsoleEnvSaveResult {
  readonly success: true;
  readonly message: string;
  /** Keys the save set or deleted (`changes` form only). */
  readonly changed?: readonly string[];
}

export const ENV_SAVE_LIMITS = Object.freeze({
  maxChanges: 256,
  maxKeyLength: 128,
  maxValueLength: 65_536,
} as const);

/** Variable names the Console may write (dotenv's own key syntax). */
export const ENV_KEY_PATTERN = /^[\w.-]+$/u;
