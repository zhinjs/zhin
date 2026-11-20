/**
 * Standalone deep expansion over an arbitrary config value (e.g. a raw `ai`
 * config document before EnvStore scoping exists). Supports `${VAR}` and
 * `${VAR:-default}` / `${VAR:=default}` (default applies when the variable is
 * unset or empty). Missing plain references resolve via `onMissing`
 * (default: `""`, matching `EnvStore.expandMissingAsEmpty`).
 */
export function expandEnvironmentValue<T>(
  value: T,
  lookup: (key: string) => string | undefined,
  onMissing: (key: string) => string = () => '',
): T {
  return expandValue(value, lookup, onMissing) as T;
}

function expandValue(
  value: unknown,
  lookup: (key: string) => string | undefined,
  onMissing: (key: string) => string,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    return expandString(value, lookup, onMissing);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('Environment expansion input must be acyclic');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = Object.freeze(value.map((item) => expandValue(item, lookup, onMissing, seen)));
    seen.delete(value);
    return result;
  }
  if (!isPlainRecord(value)) {
    seen.delete(value);
    return value;
  }
  const result = Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, expandValue(item, lookup, onMissing, seen)]),
  ));
  seen.delete(value);
  return result;
}

function isEnvKeyStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isEnvKeyChar(ch: string): boolean {
  return isEnvKeyStart(ch) || (ch >= '0' && ch <= '9');
}

interface ScannedReference {
  readonly variable: string;
  readonly fallback?: string;
  readonly operator?: EnvironmentReferenceOperator;
  /** Index just past the closing `}`. */
  readonly end: number;
}

/**
 * The single parser behind expansion and every recognition helper below: reads one
 * `${VAR}` / `${VAR:-default}` / `${VAR:=default}` at `start` (where `input` has `${`).
 * Undefined when the text there is not a reference.
 */
function scanReference(input: string, start: number): ScannedReference | undefined {
  let j = start + 2;
  const first = input[j];
  if (first === undefined || !isEnvKeyStart(first)) return undefined;
  j += 1;
  while (j < input.length) {
    const character = input[j];
    if (character === undefined || !isEnvKeyChar(character)) break;
    j += 1;
  }
  const variable = input.slice(start + 2, j);
  if (input[j] === ':' && (input[j + 1] === '-' || input[j + 1] === '=')) {
    const close = input.indexOf('}', j + 2);
    if (close < 0) return undefined;
    return { variable, fallback: input.slice(j + 2, close), operator: input[j + 1] === '-' ? ':-' : ':=', end: close + 1 };
  }
  if (input[j] !== '}') return undefined;
  return { variable, end: j + 1 };
}

/**
 * 线性扫描全部引用。语义与正则 `/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-=]([^}]*))?\}/gu` 完全一致
 * （解析失败时从 `${` 之后重新找下一个候选，等价于正则引擎逐位后移），
 * 但全程无回溯（js/polynomial-redos）。没有转义写法：`$${A}` 是 `$` 加一个引用。
 */
function* scanReferences(input: string): Generator<EnvironmentReferenceMatch> {
  let i = 0;
  while (i < input.length) {
    const start = input.indexOf('${', i);
    if (start < 0) return;
    const scanned = scanReference(input, start);
    if (!scanned) {
      i = start + 1;
      continue;
    }
    yield Object.freeze({ ...referenceFields(scanned), hasDefault: scanned.fallback !== undefined, start, end: scanned.end });
    i = scanned.end;
  }
}

function referenceFields(scanned: ScannedReference): EnvironmentReference {
  return scanned.fallback !== undefined && scanned.operator !== undefined
    ? { variable: scanned.variable, default: scanned.fallback, operator: scanned.operator }
    : { variable: scanned.variable };
}

function expandString(
  input: string,
  lookup: (key: string) => string | undefined,
  onMissing: (key: string) => string,
): string {
  let out = '';
  let i = 0;
  for (const reference of scanReferences(input)) {
    out += input.slice(i, reference.start);
    const resolved = lookup(reference.variable);
    if (reference.default !== undefined) {
      out += resolved !== undefined && resolved !== '' ? resolved : reference.default;
    } else if (resolved !== undefined) {
      out += resolved;
    } else {
      out += onMissing(reference.variable);
    }
    i = reference.end;
  }
  return out + input.slice(i);
}

/**
 * Operator of a reference with a default. Both apply the default when the variable is unset
 * or empty; `:=` does not assign the variable.
 */
export type EnvironmentReferenceOperator = ':-' | ':=';

/** One `${VAR}` / `${VAR:-default}` / `${VAR:=default}` reference. */
export interface EnvironmentReference {
  readonly variable: string;
  /** The default text (may be empty); present exactly when `operator` is. */
  readonly default?: string;
  readonly operator?: EnvironmentReferenceOperator;
}

/** A reference found inside a string by {@link environmentReferencesIn}. */
export interface EnvironmentReferenceMatch extends EnvironmentReference {
  /** True for `${VAR:-…}` / `${VAR:=…}` (even an empty default): it never expands to a missing value. */
  readonly hasDefault: boolean;
  /** Index of the `$`. */
  readonly start: number;
  /** Index just past the closing `}`. */
  readonly end: number;
}

/** Reads a variable by name (`undefined`: unset). */
export type EnvironmentLookup = (variable: string) => string | undefined;

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** A name `${…}` and `env://` can refer to: a letter or `_`, then letters, digits or `_`. */
export function isEnvironmentVariableName(name: unknown): name is string {
  return typeof name === 'string' && ENVIRONMENT_VARIABLE_NAME.test(name);
}

/**
 * The reference when `value` is exactly one `${VAR}` / `${VAR:-default}` / `${VAR:=default}`
 * (no surrounding text; callers trim when they mean to), parsed with the rules expansion uses.
 */
export function parseEnvironmentReference(value: unknown): EnvironmentReference | undefined {
  if (typeof value !== 'string' || !value.startsWith('${')) return undefined;
  const scanned = scanReference(value, 0);
  if (!scanned || scanned.end !== value.length) return undefined;
  return Object.freeze(referenceFields(scanned));
}

/** True when `value` is exactly one reference, with or without a default ({@link parseEnvironmentReference}). */
export function isWholeEnvironmentReference(value: unknown): boolean {
  return parseEnvironmentReference(value) !== undefined;
}

/** Every reference expansion would replace in `value`, in order (empty for non-strings). */
export function environmentReferencesIn(value: unknown): readonly EnvironmentReferenceMatch[] {
  return Object.freeze(typeof value === 'string' ? [...scanReferences(value)] : []);
}

/**
 * The variable an `env://NAME` URI names, or undefined when `value` is not exactly one.
 * `env://` is the AI account credential source syntax (`ai.accounts.*.auth.source`): it names
 * the variable the Host reads when it authorizes the account. Configuration values are never
 * expanded from it; they use `${VAR}`.
 */
export function parseEnvUri(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('env://')) return undefined;
  const variable = value.slice('env://'.length);
  return isEnvironmentVariableName(variable) ? variable : undefined;
}

/**
 * Variables that references in `value` (strings anywhere inside arrays / objects) read but
 * that are not set (`isSet` false), sorted and unique. A reference with a default
 * (`${VAR:-…}` / `${VAR:=…}`, even an empty one) never counts: it always expands to its default.
 */
export function findUnsetEnvironmentReferences(value: unknown, isSet: (variable: string) => boolean): readonly string[] {
  const unset = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      for (const reference of scanReferences(item)) {
        if (!reference.hasDefault && !isSet(reference.variable)) unset.add(reference.variable);
      }
      return;
    }
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) visit(child);
  };
  visit(value);
  return Object.freeze([...unset].sort());
}

/**
 * One lookup over several sources, highest priority first: the first source holding a
 * defined value wins (e.g. `createEnvironmentLookup(dotenvOverlay, process.env)`).
 */
export function createEnvironmentLookup(
  ...sources: readonly (Readonly<Record<string, string | undefined>> | undefined)[]
): EnvironmentLookup {
  return (variable) => {
    for (const source of sources) {
      const value = source?.[variable];
      if (value !== undefined) return value;
    }
    return undefined;
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
