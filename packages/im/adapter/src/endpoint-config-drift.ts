/**
 * `zhin.config.yml` account entries versus the persisted account directory (#1250).
 *
 * The encrypted CAS document of {@link EndpointDesiredRepository} is the authority for an
 * Adapter's accounts; the configuration file's `<instance>.endpoints` only seeds it the first
 * time no snapshot exists. Later edits of that list therefore have no effect on their own. This
 * module tells them apart and builds the two explicit resolutions:
 *
 * - **import**: a configured account is written into the persisted directory, `${VAR}` values
 *   kept as references (`secretRefs`, resolved only when the account starts);
 * - **write back**: a persisted account is written into the configuration file, credentials as
 *   `${VAR}` references — the reference the file already had, or a placeholder the operator then
 *   sets in `.env`. A credential value is never written into the file.
 *
 * A reference equals the same reference. A field the file writes as a reference while the saved
 * account holds a value is compared in-process through {@link EndpointConfigSource.resolveReference}
 * when the Host provides it (the value never leaves the comparison); without it, or when a variable
 * is unset, the field is reported as `unverified`, not as a difference. Only paths are reported,
 * never values. Account ids written as `${VAR}` are resolved through the source so accounts can be
 * matched at all.
 *
 * Credentials are recognized by key name (Host predicate, plus console-spec `sensitiveFields`), by
 * value (URL userinfo `ws://user:pass@host`, credential-like query parameters `?access_token=…`) and
 * inside lists (a credential-like list key such as `tokens`, or list items that are credentials).
 */
import { isDeepStrictEqual } from 'node:util';
import type { PluginId } from '@zhin.js/plugin-runtime';
import { AdapterManagementError, type EndpointDesiredRecord } from './adapter-types.js';
import { readConfigurationPath, writeConfigurationPath } from './configuration-fields.js';
import { endpointCreationConfiguration } from './endpoint-profile.js';

/** One instance's stored configuration block and the file revision it was read at. */
export interface EndpointConfigDocument {
  /**
   * The instance block (`<instanceKey>: {…}`) as stored: never environment-expanded. The Host may
   * apply schema defaults so defaulted fields compare equal. `undefined`: the file has no block.
   */
  readonly config: Readonly<Record<string, unknown>> | undefined;
  /** Configuration file revision, the compare-and-set token of {@link EndpointConfigSource.writeEndpoints}. */
  readonly revision: string;
}

/** Host port to the configuration file; provided through `endpointConfigSourceToken`. */
export interface EndpointConfigSource {
  read(owner: PluginId, signal?: AbortSignal): Promise<EndpointConfigDocument>;
  /**
   * Replace `<instance>.endpoints` with `endpoints` (stored as given, never expanded). Throws
   * `AdapterManagementError('conflict')` when the file is no longer at `expectedRevision`,
   * `invalid_configuration` when the result does not validate, `commit_unknown` when the save
   * outcome is unknown.
   */
  writeEndpoints(owner: PluginId, endpoints: readonly Readonly<Record<string, unknown>>[], expectedRevision: string,
    signal?: AbortSignal): Promise<EndpointConfigWriteResult>;
  /** Resolve an account id written as `${VAR}` (ids only; never used for other fields). */
  resolveIdentifier?(value: string): string;
  /**
   * Expand every `${VAR}` of a stored value against the current environment, `undefined` when any
   * variable is unset. Used only to compare a file reference with a saved value in-process; the
   * result is never reported, logged or written.
   */
  resolveReference?(value: string): string | undefined;
  /** Credential-like configuration key (ADR 0057 predicate); a conservative default applies without it. */
  isSecretKey?(key: string): boolean;
}

export interface EndpointConfigWriteResult {
  readonly revision: string;
  /** Unset `${VAR}` names the saved file references (from validation). */
  readonly missingEnv?: readonly string[];
}

/**
 * - `config_only`: in the configuration file, not among the persisted accounts (it does not run);
 * - `snapshot_only`: persisted (and possibly running), no longer in the configuration file;
 * - `changed`: in both, with different configuration (`fields`).
 */
export type EndpointConfigDriftKind = 'config_only' | 'snapshot_only' | 'changed';

export interface EndpointConfigDriftField {
  /** Dotted configuration path. Values are never reported. */
  readonly path: string;
  /** Credential-like field (secret key name or a `${VAR}` reference on either side). */
  readonly sensitive: boolean;
}

export interface EndpointConfigDriftEntry {
  /** Account id (`endpoints[].id`, resolved). */
  readonly id: string;
  readonly kind: EndpointConfigDriftKind;
  /** Persisted account instance (`snapshot_only` / `changed`). */
  readonly instanceId?: string;
  /** Persisted enabled intent (`snapshot_only` / `changed`). */
  readonly desiredEnabled?: boolean;
  /** `changed` only. */
  readonly fields?: readonly EndpointConfigDriftField[];
}

export interface EndpointConfigUnverified {
  readonly id: string;
  /** Paths written as `${VAR}` in the file while the saved account holds a value. */
  readonly paths: readonly string[];
}

export interface EndpointConfigDrift {
  /**
   * `snapshot`: persisted accounts are the authority (drift possible); `config`: no snapshot yet
   * (or no persistence), the configuration file still seeds the accounts and nothing drifts.
   */
  readonly authority: 'snapshot' | 'config';
  /** Persisted directory revision (`null` before the first commit). */
  readonly revision: number | null;
  /** Configuration file revision the comparison read. */
  readonly configRevision?: string;
  readonly entries: readonly EndpointConfigDriftEntry[];
  readonly unverified: readonly EndpointConfigUnverified[];
}

/** One configured account, expanded exactly like the startup seed (`expandEndpointConfigs`). */
export interface ConfiguredEndpointSeed {
  readonly endpointId: string;
  /** The single-account form (no `endpoints` list): the account is the whole instance block. */
  readonly singleton: boolean;
  /** Effective configuration, `${VAR}` unresolved; `id` holds the resolved account id. */
  readonly config: Readonly<Record<string, unknown>>;
}

const DEFAULT_SECRET_KEY = /(?:password|passwd|secret|apikey|accesskey|privatekey|encrypt(?:ion)?key|encodingaeskey|credential|authorization|cookie|token$)/u;

/** Credential-like key, by the Host predicate when given. */
export function isSecretConfigurationPath(path: string, isSecretKey?: (key: string) => boolean): boolean {
  const key = path.split('.').at(-1) ?? path;
  if (isSecretKey) return isSecretKey(key);
  return DEFAULT_SECRET_KEY.test(key.replace(/[^a-z0-9]/giu, '').toLowerCase());
}

/** Query parameter names that carry credentials in URLs (`?access_token=…`, `?key=…`). */
const CREDENTIAL_QUERY_PARAMETER = /^(?:access[-_]?token|token|auth|authorization|key|api[-_]?key|apikey|secret|password|passwd|pass|pwd|sig|signature|sign|session|sessionid|ticket|code|credential|credentials|private[-_]?key)$/iu;

/** `scheme://user[:pass]@host` or a credential-like query parameter. */
function isCredentialUrl(value: string, isSecretKey?: (key: string) => boolean): boolean {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/iu.exec(value.trim());
  if (!match) return false;
  if (match[1]!.includes('@')) return true;
  for (const pair of (match[3] ?? '').split('&')) {
    const raw = pair.split('=')[0] ?? '';
    let name = raw;
    try { name = decodeURIComponent(raw); } catch { /* keep the raw name */ }
    if (!name) continue;
    if (CREDENTIAL_QUERY_PARAMETER.test(name) || isSecretConfigurationPath(name, isSecretKey)) return true;
  }
  return false;
}

/**
 * A credential leaf: credential-like key (a list key also in its singular, `tokens` → `token`), a
 * URL carrying credentials, or a list / object holding any credential.
 */
function isCredentialValue(path: string, value: unknown, isSecretKey?: (key: string) => boolean): boolean {
  if (isSecretConfigurationPath(path, isSecretKey)) return true;
  if (typeof value === 'string') return isCredentialUrl(value, isSecretKey);
  if (Array.isArray(value)) {
    const key = path.split('.').at(-1) ?? path;
    // `tokens` / `passwords` / `secrets`: a list key in its singular.
    if (/s$/u.test(key) && isSecretConfigurationPath(key.slice(0, -1), isSecretKey)) return true;
    return value.some(item => isCredentialValue(path, item, isSecretKey) || (plainObject(item) && credentialInside(item, isSecretKey)));
  }
  if (plainObject(value)) return credentialInside(value, isSecretKey);
  return false;
}

function credentialInside(value: Readonly<Record<string, unknown>>, isSecretKey?: (key: string) => boolean): boolean {
  return Object.entries(value).some(([key, item]) => isCredentialValue(key, item, isSecretKey));
}

/**
 * Whether a stored `${VAR}` value would give the account `saved`: `equal` / `different`, or
 * `unresolved` without a resolver or when a variable is unset. Never returns or keeps the value.
 */
function compareReference(reference: unknown, saved: unknown,
  resolve: ((value: string) => string | undefined) | undefined): 'equal' | 'different' | 'unresolved' {
  if (!resolve) return 'unresolved';
  let unresolved = false;
  const expand = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!value.includes('${')) return value;
      const resolved = resolve(value);
      if (resolved === undefined) unresolved = true;
      return resolved;
    }
    if (Array.isArray(value)) return value.map(expand);
    if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    return value;
  };
  let expanded: unknown;
  try { expanded = expand(reference); } catch { return 'unresolved'; }
  if (unresolved) return 'unresolved';
  return looselyEqual(expanded, saved) ? 'equal' : 'different';
}

/** Environment expansion yields strings: a saved number / boolean equals its string form. */
function looselyEqual(expanded: unknown, saved: unknown): boolean {
  if (isDeepStrictEqual(expanded, saved)) return true;
  if (typeof expanded === 'string' && (typeof saved === 'number' || typeof saved === 'boolean')) return expanded === String(saved);
  if (Array.isArray(expanded) && Array.isArray(saved)) {
    return expanded.length === saved.length && expanded.every((item, index) => looselyEqual(item, saved[index]));
  }
  if (plainObject(expanded) && plainObject(saved)) {
    const keys = new Set([...Object.keys(expanded), ...Object.keys(saved)]);
    return [...keys].every(key => looselyEqual(expanded[key], saved[key]));
  }
  return false;
}

/** A value that still carries a `${VAR}` reference somewhere. */
export function hasEnvironmentReference(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('${');
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value).includes('${'); } catch { return false; }
  }
  return false;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Leaf paths of nested plain objects; arrays and scalars are leaves. */
export function configurationLeafPaths(value: unknown, prefix = ''): string[] {
  if (!plainObject(value)) return prefix ? [prefix] : [];
  const keys = Object.keys(value);
  if (!keys.length) return prefix ? [prefix] : [];
  return keys.flatMap(key => configurationLeafPaths(value[key], prefix ? `${prefix}.${key}` : key));
}

/** Account entries of one instance block, expanded like the startup seed; invalid entries are skipped. */
export function configuredEndpointSeeds(config: Readonly<Record<string, unknown>> | undefined, localName: string,
  resolveIdentifier: (value: string) => string = value => value): readonly ConfiguredEndpointSeed[] {
  const block = config ?? {};
  const list = block.endpoints;
  const resolveId = (value: string) => (value.includes('${') ? resolveIdentifier(value) : value).trim();
  if (list !== undefined && !Array.isArray(list)) return Object.freeze([]);
  if (!list || list.length === 0) {
    const configured = typeof block.id === 'string' ? resolveId(block.id) : '';
    const endpointId = configured || localName;
    const seed = endpointCreationConfiguration(block, {});
    return Object.freeze([Object.freeze({ endpointId, singleton: true,
      config: Object.freeze(typeof block.id === 'string' ? { ...seed, id: endpointId } : seed) })]);
  }
  const { endpoints: _endpoints, ...base } = block;
  const seen = new Set<string>();
  const seeds: ConfiguredEndpointSeed[] = [];
  for (const entry of list) {
    if (!plainObject(entry) || typeof entry.id !== 'string') continue;
    const endpointId = resolveId(entry.id);
    if (!endpointId || /[~\0]/u.test(endpointId) || seen.has(endpointId)) continue;
    seen.add(endpointId);
    seeds.push(Object.freeze({ endpointId, singleton: false,
      config: Object.freeze({ ...endpointCreationConfiguration(base, entry), id: endpointId }) }));
  }
  return Object.freeze(seeds);
}

/** Field-level comparison of a configured account and its persisted record (paths only). */
export function compareEndpointConfiguration(configured: Readonly<Record<string, unknown>>,
  record: Pick<EndpointDesiredRecord, 'config' | 'secretRefs'>, isSecretKey?: (key: string) => boolean,
  resolveReference?: (value: string) => string | undefined,
): Readonly<{ fields: readonly EndpointConfigDriftField[]; unverified: readonly string[] }> {
  const references = record.secretRefs ?? {};
  const paths = [...new Set([...configurationLeafPaths(configured), ...configurationLeafPaths(record.config),
    ...Object.keys(references)])].filter(path => path !== 'id').sort();
  const fields: EndpointConfigDriftField[] = [];
  const unverified: string[] = [];
  const reported: string[] = [];
  for (const path of paths) {
    // A path below one already reported differs for the same reason (object vs scalar).
    if (reported.some(parent => path.startsWith(`${parent}.`))) continue;
    const wanted = readConfigurationPath(configured, path);
    const reference = Object.hasOwn(references, path) ? references[path] : undefined;
    const saved = readConfigurationPath(record.config, path);
    const sensitive = isCredentialValue(path, wanted, isSecretKey) || isCredentialValue(path, saved, isSecretKey)
      || reference !== undefined || hasEnvironmentReference(wanted);
    let differs: boolean;
    if (hasEnvironmentReference(wanted)) {
      if (reference !== undefined) differs = reference !== wanted;
      else if (saved !== undefined) {
        // Compared in-process; unset variables (or no resolver) leave it unverified.
        const match = compareReference(wanted, saved, resolveReference);
        if (match === 'unresolved') { unverified.push(path); differs = false; } else differs = match === 'different';
      } else differs = true;
    } else if (reference !== undefined) differs = true;
    else differs = !isDeepStrictEqual(wanted, saved);
    if (differs) { fields.push(Object.freeze({ path, sensitive })); reported.push(path); }
  }
  return Object.freeze({ fields: Object.freeze(fields), unverified: Object.freeze(unverified) });
}

/** Configuration file accounts versus persisted records, by account id. */
export function compareEndpointDirectories(seeds: readonly ConfiguredEndpointSeed[],
  records: readonly EndpointDesiredRecord[], isSecretKey?: (key: string) => boolean,
  resolveReference?: (value: string) => string | undefined,
): Readonly<{ entries: readonly EndpointConfigDriftEntry[]; unverified: readonly EndpointConfigUnverified[] }> {
  const entries: EndpointConfigDriftEntry[] = [];
  const unverified: EndpointConfigUnverified[] = [];
  const byId = new Map(records.map(record => [record.endpointId, record]));
  for (const seed of seeds) {
    const record = byId.get(seed.endpointId);
    if (!record) { entries.push(Object.freeze({ id: seed.endpointId, kind: 'config_only' })); continue; }
    const comparison = compareEndpointConfiguration(seed.config, record, isSecretKey, resolveReference);
    if (comparison.fields.length) {
      entries.push(Object.freeze({ id: seed.endpointId, kind: 'changed', instanceId: record.instanceId,
        desiredEnabled: record.desiredEnabled, fields: comparison.fields }));
    }
    if (comparison.unverified.length) unverified.push(Object.freeze({ id: seed.endpointId, paths: comparison.unverified }));
  }
  const configured = new Set(seeds.map(seed => seed.endpointId));
  for (const record of records) {
    if (configured.has(record.endpointId)) continue;
    entries.push(Object.freeze({ id: record.endpointId, kind: 'snapshot_only', instanceId: record.instanceId,
      desiredEnabled: record.desiredEnabled }));
  }
  return Object.freeze({ entries: Object.freeze(entries), unverified: Object.freeze(unverified) });
}

/**
 * The persisted form of a configured account: every `${VAR}` leaf moves into `secretRefs` (resolved
 * only when the account starts) and leaves the stored configuration. References inside arrays
 * cannot be resolved per field and are refused.
 */
export function splitEnvironmentReferences(config: Readonly<Record<string, unknown>>): Readonly<{
  config: Readonly<Record<string, unknown>>; secretRefs?: Readonly<Record<string, string>>;
}> {
  const stored: Record<string, unknown> = {};
  const references: Record<string, string> = {};
  for (const path of configurationLeafPaths(config)) {
    const value = readConfigurationPath(config, path);
    if (path !== 'id' && hasEnvironmentReference(value)) {
      if (typeof value !== 'string') {
        throw new AdapterManagementError('unsupported', `\${VAR} references inside lists cannot be imported (${path})`);
      }
      references[path] = value;
      continue;
    }
    writeConfigurationPath(stored, path, structuredClone(value));
  }
  return Object.freeze({ config: Object.freeze(stored),
    ...(Object.keys(references).length ? { secretRefs: Object.freeze(references) } : {}) });
}

export interface EndpointWritebackPlaceholder {
  readonly id: string;
  readonly path: string;
  /** The `.env` variable the written reference names; it has to be set before the account can start from the file. */
  readonly variable: string;
  /**
   * Why a placeholder was written: `credential` — a saved credential value had no reference;
   * `reference_mismatch` — the file's reference resolves to a different value than the saved
   * account holds; `reference_unresolved` — the file's reference could not be resolved to compare.
   * Absent means `credential`.
   */
  readonly reason?: 'credential' | 'reference_mismatch' | 'reference_unresolved';
}

/** `${VAR}` names inside a stored value. */
function referencedVariables(value: unknown): readonly string[] {
  let text = '';
  try { text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; } catch { return []; }
  return [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/gu)].map(match => match[1]!);
}

/**
 * Placeholder name that is not one of `taken`: a reference that resolves to another value must not
 * be written again under the same name (the account would keep the wrong credential).
 */
function placeholderVariableAvoiding(adapter: string, endpointId: string, path: string, taken: readonly string[]): string {
  const name = placeholderVariable(adapter, endpointId, path);
  if (!taken.includes(name)) return name;
  for (let suffix = 1; ; suffix++) {
    const candidate = `${name}_${suffix === 1 ? 'NEW' : `NEW${suffix}`}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** `QQ_MAIN_SECRET` style variable name for a placeholder reference. */
export function placeholderVariable(adapter: string, endpointId: string, path: string): string {
  const name = [adapter, endpointId, path].join('_').replace(/[^A-Za-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').toUpperCase();
  return /^[A-Z_]/u.test(name) ? name : `_${name}`;
}

/**
 * Configuration file entry for one persisted account. `existing` is its current entry (if any),
 * `base` the instance block without `endpoints`. Rules, per leaf path:
 * - a saved reference (`secretRefs`) is written as that reference;
 * - a reference in the existing entry is kept, and one inherited from `base` stays inherited, only
 *   when it resolves (in-process, `resolveReference`) to the saved value; otherwise a credential
 *   gets a placeholder `${VAR}` (reported with `reference_mismatch` / `reference_unresolved`) and any
 *   other value is written as saved;
 * - a credential value without a reference (by key name, URL userinfo / credential query
 *   parameter) becomes a placeholder `${VAR}` (reported);
 * - a list holding credentials cannot be referenced as a whole and is refused (`unsupported`);
 * - other values are written unless `base` provides the same value.
 * The account id keeps the entry's `${VAR}` spelling when that resolves to the same id.
 */
export function endpointWritebackEntry(input: Readonly<{
  adapter: string;
  record: Pick<EndpointDesiredRecord, 'endpointId' | 'config' | 'secretRefs'>;
  existing?: Readonly<Record<string, unknown>>;
  base: Readonly<Record<string, unknown>>;
  isSecretKey?: (key: string) => boolean;
  resolveIdentifier?: (value: string) => string;
  resolveReference?: (value: string) => string | undefined;
}>): Readonly<{ entry: Readonly<Record<string, unknown>>; placeholders: readonly EndpointWritebackPlaceholder[] }> {
  const { record, existing, base } = input;
  const references = record.secretRefs ?? {};
  const rawId = existing?.id;
  const keepId = typeof rawId === 'string' && rawId.includes('${')
    && (input.resolveIdentifier?.(rawId) ?? rawId).trim() === record.endpointId;
  const entry: Record<string, unknown> = { id: keepId ? rawId : record.endpointId };
  const placeholders: EndpointWritebackPlaceholder[] = [];
  const paths = [...new Set([...configurationLeafPaths(record.config), ...Object.keys(references)])]
    .filter(path => path !== 'id').sort();
  for (const path of paths) {
    const reference = Object.hasOwn(references, path) ? references[path] : undefined;
    const inherited = readConfigurationPath(base, path);
    if (reference !== undefined) {
      if (reference !== inherited) writeConfigurationPath(entry, path, reference);
      continue;
    }
    const own = existing ? readConfigurationPath(existing, path) : undefined;
    const saved = readConfigurationPath(record.config, path);
    const credential = !(Array.isArray(saved) && saved.length === 0) && isCredentialValue(path, saved, input.isSecretKey);
    const fileReference = hasEnvironmentReference(own) ? own : hasEnvironmentReference(inherited) ? inherited : undefined;
    let reason: EndpointWritebackPlaceholder['reason'] = 'credential';
    if (fileReference !== undefined) {
      // Keep the file's reference only when it gives the account the saved value.
      const match = compareReference(fileReference, saved, input.resolveReference);
      if (match === 'equal') {
        if (fileReference === own) writeConfigurationPath(entry, path, structuredClone(own));
        continue;
      }
      if (!credential) { writeConfigurationPath(entry, path, structuredClone(saved)); continue; }
      reason = match === 'different' ? 'reference_mismatch' : 'reference_unresolved';
    }
    if (credential) {
      if (saved === undefined || saved === null || saved === '') {
        // Nothing saved: an inherited / existing reference cannot be "wrong"; drop only a stale own one.
        continue;
      }
      if (typeof saved !== 'string' && typeof saved !== 'number') {
        throw new AdapterManagementError('unsupported',
          `${record.endpointId}.${path} holds credentials in a list or object; edit it in zhin.config.yml directly`);
      }
      const variable = placeholderVariableAvoiding(input.adapter, record.endpointId, path,
        reason === 'reference_mismatch' ? referencedVariables(fileReference) : []);
      writeConfigurationPath(entry, path, `\${${variable}}`);
      placeholders.push(Object.freeze({ id: record.endpointId, path, variable, ...(reason === 'credential' ? {} : { reason }) }));
      continue;
    }
    if (isDeepStrictEqual(saved, inherited)) continue;
    writeConfigurationPath(entry, path, structuredClone(saved));
  }
  return Object.freeze({ entry: Object.freeze(entry), placeholders: Object.freeze(placeholders) });
}
