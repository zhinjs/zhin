import { PLUGIN_CATEGORIES, isPluginCategory, type PluginCategory } from '@zhin.js/plugin-runtime';

export interface PackageReference {
  readonly package: string;
  readonly optional?: boolean;
  readonly api?: string;
}

export interface ChildPluginReference extends PackageReference {
  readonly instanceKey: string;
}

export interface ZhinPluginManifest {
  readonly protocol: 1;
  readonly type: 'plugin';
  /**
   * Package-relative runtime entry (`zhin.entry` or `exports["./zhin"]`).
   * Absent for an entry-less Plugin: it is assembled as
   * `definePlugin({ name: <unscoped package name> })` and contributes only
   * convention directories discovered from the package root.
   */
  readonly entry?: string;
  readonly engine?: string;
  readonly runtime?: 'trusted' | 'isolated';
  readonly metadata?: Readonly<{
    displayName?: string;
    /** Console display-name translations keyed by `zh-CN` / `en`. */
    displayNameI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
    /** Plugin-market description translations keyed by `zh-CN` / `en` (manifest only). */
    descriptionI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
    /** Plugin-market category, one of `PLUGIN_CATEGORIES` (manifest only). */
    category?: PluginCategory;
    icon?: string;
  }>;
  /**
   * When true (default), Root plugins receive official Stable Features
   * (`@zhin.js/adapter|command|component`) from the platform/CLI even if they
   * are omitted from `features` / project dependencies. Set false to opt out.
   */
  readonly platformFeatures?: boolean;
  readonly features: readonly PackageReference[];
  /**
   * Present (true) when the manifest omits `features`: Feature packages are then inferred from
   * convention directories (see `inferConventionFeatureReferences`). A written list, even an
   * empty one, is authoritative.
   */
  readonly featuresOmitted?: true;
  readonly plugins: readonly ChildPluginReference[];
}

export interface ZhinFeatureManifest {
  readonly protocol: 1;
  readonly type: 'feature';
  readonly entry: string;
  readonly engine?: string;
  readonly featureApi?: string;
}

export type ZhinPackageManifest = ZhinPluginManifest | ZhinFeatureManifest;

export interface PackageJson {
  readonly name: string;
  readonly version?: string;
  readonly type?: 'module' | 'commonjs';
  readonly main?: string;
  readonly exports?: unknown;
  readonly imports?: unknown;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly zhin: ZhinPackageManifest;
}

export class ManifestValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid Zhin package manifest:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ManifestValidationError';
  }
}

/**
 * A manifest problem the Runtime loader tolerates: the offending marketplace-only value is dropped
 * and the package still loads. `zhin plugin check` / the publish pipeline parse in strict mode,
 * where the same problem is a validation error.
 */
export interface ManifestWarning {
  readonly code: 'manifest-metadata-dropped';
  /** Package name from `package.json#name`, when it is readable. */
  readonly package?: string;
  /** Manifest field the dropped value belonged to, e.g. `zhin.metadata.category`. */
  readonly field: string;
  /** Full source path of the dropped value (file + field). */
  readonly source: string;
  readonly message: string;
}

export interface ParsePackageJsonOptions {
  /**
   * `strict` (default): every metadata problem is a {@link ManifestValidationError} — used by
   * `zhin plugin check` and publishing. `lenient`: problems in marketplace-only fields
   * (`metadata.category`, `metadata.descriptionI18n`) and unknown locale keys in
   * `metadata.displayNameI18n` are reported through `onWarning` and the value is dropped, so a
   * marketplace typo never stops an instance from starting. Fields that affect runtime behaviour
   * (unknown metadata keys, entry, features, …) stay fatal in both modes.
   */
  readonly metadata?: 'strict' | 'lenient';
  readonly onWarning?: (warning: ManifestWarning) => void;
}

interface MetadataLeniency {
  warn(field: string, source: string, message: string): void;
}

export function parsePackageJson(value: unknown, source: string, options: ParsePackageJsonOptions = {}): PackageJson {
  const issues: string[] = [];
  const record = asRecord(value, source, issues);
  const name = readString(record, 'name', source, issues);
  if (name && !isPackageName(name)) issues.push(`${source}#name is not a valid package name`);
  const leniency: MetadataLeniency | undefined = options.metadata === 'lenient'
    ? {
        warn: (field, fieldSource, message) => options.onWarning?.(Object.freeze({
          code: 'manifest-metadata-dropped' as const,
          ...(name ? { package: name } : {}),
          field,
          source: fieldSource,
          message,
        })),
      }
    : undefined;
  const zhin = parseZhinManifest(record.zhin, `${source}#zhin`, issues, record.exports, `${source}#exports`, leniency);
  const version = optionalString(record.version, `${source}#version`, issues);
  const moduleType = optionalModuleType(record.type, `${source}#type`, issues);
  const main = optionalString(record.main, `${source}#main`, issues);
  const packageExports = optionalPackageMap(record.exports, `${source}#exports`, issues);
  const packageImports = optionalPackageMap(record.imports, `${source}#imports`, issues);
  const isPrivate = optionalBoolean(record.private, `${source}#private`, issues);
  const dependencies = stringRecord(record.dependencies, `${source}#dependencies`, issues);
  const optionalDependencies = stringRecord(
    record.optionalDependencies,
    `${source}#optionalDependencies`,
    issues,
  );
  const peerDependencies = stringRecord(
    record.peerDependencies,
    `${source}#peerDependencies`,
    issues,
  );
  const devDependencies = stringRecord(
    record.devDependencies,
    `${source}#devDependencies`,
    issues,
  );
  const scripts = stringRecord(record.scripts, `${source}#scripts`, issues);
  if (issues.length > 0 || !name || !zhin) throw new ManifestValidationError(issues);

  return Object.freeze({
    name,
    version,
    type: moduleType,
    main,
    exports: packageExports,
    imports: packageImports,
    private: isPrivate,
    dependencies,
    optionalDependencies,
    peerDependencies,
    devDependencies,
    scripts,
    zhin,
  });
}

/** The Plugin name rule enforced by `definePlugin()`. */
export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export class EntrylessPluginNameError extends TypeError {
  constructor(readonly packageName: string, readonly derivedName: string) {
    super(
      `Plugin package ${packageName} has no entry (zhin.entry / exports["./zhin"]), `
      + `and its unscoped package name "${derivedName}" is not a valid Plugin name `
      + `(${PLUGIN_NAME_PATTERN.source}). Add a plugin.ts that default-exports `
      + 'definePlugin({ name: ... }) with an explicit name and declare it as zhin.entry.',
    );
    this.name = 'EntrylessPluginNameError';
  }
}

/**
 * The Plugin name of an entry-less Plugin package: its unscoped package name
 * (`@scope/foo` → `foo`, `foo` → `foo`), with no other prefix stripped.
 * Throws {@link EntrylessPluginNameError} when that is not a valid Plugin name.
 */
export function deriveEntrylessPluginName(packageName: string): string {
  const slash = packageName.startsWith('@') ? packageName.indexOf('/') : -1;
  const derived = slash >= 0 ? packageName.slice(slash + 1) : packageName;
  if (!PLUGIN_NAME_PATTERN.test(derived)) throw new EntrylessPluginNameError(packageName, derived);
  return derived;
}

/** Conditions tried, in order, when `exports["./zhin"]` is a condition object. */
export const ZHIN_EXPORT_CONDITIONS = Object.freeze(['zhin', 'import', 'default'] as const);

/**
 * The runtime entry declared by `exports["./zhin"]`, if any.
 *
 * A string target is used as is; a condition object is searched for `zhin`, then `import`,
 * then `default` (nested condition objects are searched the same way); an array uses its
 * first target that resolves. Other conditions such as `types` or `require` are ignored.
 */
export function zhinExportTarget(packageExports: unknown): string | undefined {
  if (!packageExports || typeof packageExports !== 'object' || Array.isArray(packageExports)) return undefined;
  if (!Object.hasOwn(packageExports, './zhin')) return undefined;
  return selectExportTarget((packageExports as Record<string, unknown>)['./zhin']);
}

function selectExportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = selectExportTarget(item);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const condition of ZHIN_EXPORT_CONDITIONS) {
    if (!Object.hasOwn(value, condition)) continue;
    const target = selectExportTarget((value as Record<string, unknown>)[condition]);
    if (target !== undefined) return target;
  }
  return undefined;
}

function parseZhinManifest(
  value: unknown,
  source: string,
  issues: string[],
  packageExports?: unknown,
  exportsSource = 'exports',
  leniency?: MetadataLeniency,
): ZhinPackageManifest | undefined {
  const record = asRecord(value, source, issues);
  if (record.protocol !== 1) issues.push(`${source}.protocol must be 1`);
  const type = readString(record, 'type', source, issues);
  // `zhin.entry` wins when present; `exports["./zhin"]` is the standard-field alternative.
  // A Plugin may declare neither (entry-less Plugin); a Feature always needs an entry.
  const exportedEntry = record.entry === undefined ? zhinExportTarget(packageExports) : undefined;
  const entryless = type === 'plugin' && record.entry === undefined && exportedEntry === undefined;
  const entry = entryless
    ? undefined
    : exportedEntry !== undefined
      ? readRelativeEntry(exportedEntry, `${exportsSource}["./zhin"]`, issues)
      : readRelativeEntry(record.entry, `${source}.entry`, issues, `${exportsSource}["./zhin"]`);
  const engine = optionalString(record.engine, `${source}.engine`, issues);
  if ((!entry && !entryless) || (type !== 'plugin' && type !== 'feature')) {
    if (type && type !== 'plugin' && type !== 'feature') {
      issues.push(`${source}.type must be "plugin" or "feature"`);
    }
    return undefined;
  }

  if (type === 'feature') {
    if (!entry) return undefined;
    return Object.freeze({
      protocol: 1,
      type,
      entry,
      engine,
      featureApi: optionalString(record.featureApi, `${source}.featureApi`, issues),
    });
  }

  const runtime = record.runtime;
  if (runtime !== undefined && runtime !== 'trusted' && runtime !== 'isolated') {
    issues.push(`${source}.runtime must be "trusted" or "isolated"`);
  }
  const platformFeatures = optionalBoolean(
    record.platformFeatures,
    `${source}.platformFeatures`,
    issues,
  );
  return Object.freeze({
    protocol: 1,
    type,
    ...(entry !== undefined ? { entry } : {}),
    engine,
    runtime: runtime as 'trusted' | 'isolated' | undefined,
    metadata: parsePluginMetadata(record.metadata, `${source}.metadata`, issues, leniency),
    platformFeatures,
    features: parseReferences(record.features, `${source}.features`, issues, false),
    ...(record.features === undefined ? { featuresOmitted: true as const } : {}),
    plugins: parseReferences(record.plugins, `${source}.plugins`, issues, true),
  });
}

function parsePluginMetadata(
  value: unknown,
  source: string,
  issues: string[],
  leniency?: MetadataLeniency,
): ZhinPluginManifest['metadata'] {
  if (value === undefined) return undefined;
  const record = asRecord(value, source, issues);
  for (const key of Object.keys(record)) {
    if (!PLUGIN_METADATA_KEYS.has(key)) issues.push(`${source}.${key} is not supported`);
  }
  const displayNameI18n = record.displayNameI18n === undefined
    ? undefined
    : parseLocalizedText(record.displayNameI18n, `${source}.displayNameI18n`, issues, leniency
      // Console display names: a wrong shape stays fatal, an unknown locale is only dropped.
      ? (locale, message) => leniency.warn('zhin.metadata.displayNameI18n', `${source}.displayNameI18n.${locale}`, message)
      : undefined);
  const descriptionI18n = record.descriptionI18n === undefined
    ? undefined
    : parseMarketplaceField(leniency, 'zhin.metadata.descriptionI18n', `${source}.descriptionI18n`, issues,
      (fieldIssues) => parseLocalizedText(record.descriptionI18n, `${source}.descriptionI18n`, fieldIssues));
  const category = record.category === undefined
    ? undefined
    : parseMarketplaceField(leniency, 'zhin.metadata.category', `${source}.category`, issues,
      (fieldIssues) => parsePluginCategory(record.category, `${source}.category`, fieldIssues));
  return Object.freeze({
    ...(record.displayName !== undefined ? { displayName: readString(record, 'displayName', source, issues) } : {}),
    ...(displayNameI18n !== undefined && !(leniency && Object.keys(displayNameI18n).length === 0) ? { displayNameI18n } : {}),
    ...(descriptionI18n !== undefined ? { descriptionI18n } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(record.icon !== undefined ? { icon: readString(record, 'icon', source, issues) } : {}),
  });
}

const PLUGIN_METADATA_KEYS = new Set(['displayName', 'displayNameI18n', 'descriptionI18n', 'category', 'icon']);

/**
 * Parses a marketplace-only metadata field. Strict mode reports its problems as manifest issues;
 * lenient mode turns each problem into a warning and keeps only the valid part (a localized text
 * keeps its valid locales; an empty or invalid result is dropped).
 */
function parseMarketplaceField<T>(
  leniency: MetadataLeniency | undefined,
  field: string,
  source: string,
  issues: string[],
  parse: (fieldIssues: string[]) => T | undefined,
): T | undefined {
  if (!leniency) return parse(issues);
  const fieldIssues: string[] = [];
  const parsed = parse(fieldIssues);
  for (const issue of fieldIssues) leniency.warn(field, source, `${issue}; the value is ignored`);
  if (parsed === undefined) return undefined;
  if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) return undefined;
  return parsed;
}

function parsePluginCategory(value: unknown, source: string, issues: string[]): PluginCategory | undefined {
  if (isPluginCategory(value)) return value;
  issues.push(`${source} must be one of ${PLUGIN_CATEGORIES.join(', ')}`);
  return undefined;
}

function parseLocalizedText(
  value: unknown,
  source: string,
  issues: string[],
  onUnknownLocale?: (locale: string, message: string) => void,
): Readonly<Partial<Record<'zh-CN' | 'en', string>>> {
  const record = asRecord(value, source, issues);
  const result: Partial<Record<'zh-CN' | 'en', string>> = {};
  for (const key of Object.keys(record)) {
    if (key !== 'zh-CN' && key !== 'en') {
      const message = `${source}.${key} is not supported (use zh-CN or en)`;
      if (onUnknownLocale) onUnknownLocale(key, `${message}; the value is ignored`);
      else issues.push(message);
      continue;
    }
    const text = readString(record, key, source, issues);
    if (text !== undefined) result[key] = text;
  }
  return Object.freeze(result);
}

function parseReferences(
  value: unknown,
  source: string,
  issues: string[],
  child: boolean,
): readonly ChildPluginReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${source} must be an array`);
    return [];
  }
  return value.flatMap((item, index) => {
    const itemSource = `${source}[${index}]`;
    const record = asRecord(item, itemSource, issues);
    const packageName = readString(record, 'package', itemSource, issues);
    const instanceKey = child
      ? readString(record, 'instanceKey', itemSource, issues)
      : undefined;
    if (!packageName || (child && !instanceKey)) return [];
    // 支持两种来源：npm 包名（package 依赖）或 ./ 相对路径（monorepo 本地插件目录）
    const isLocalPath = packageName.startsWith('./');
    if (!isLocalPath && !isPackageName(packageName)) {
      issues.push(`${itemSource}.package is not a valid package name`);
      return [];
    }
    if (isLocalPath && packageName.split('/').includes('..')) {
      issues.push(`${itemSource}.package must not escape the package root`);
      return [];
    }
    if (instanceKey && !/^[a-z0-9][a-z0-9-]*$/.test(instanceKey)) {
      issues.push(`${itemSource}.instanceKey is invalid`);
      return [];
    }
    return [{
      package: packageName,
      instanceKey: instanceKey ?? packageName,
      optional: optionalBoolean(record.optional, `${itemSource}.optional`, issues),
      api: optionalString(record.api, `${itemSource}.api`, issues),
    }];
  });
}

function readRelativeEntry(value: unknown, source: string, issues: string[], alternative?: string): string | undefined {
  if (value === undefined && alternative) {
    issues.push(`${source} or ${alternative} must declare a package-relative path starting with ./`);
    return undefined;
  }
  if (typeof value !== 'string' || !value.startsWith('./')) {
    issues.push(`${source} must be a package-relative path starting with ./`);
    return undefined;
  }
  if (value.split('/').includes('..')) {
    issues.push(`${source} must not escape the package root`);
    return undefined;
  }
  return value;
}

function asRecord(value: unknown, source: string, issues: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${source} must be an object`);
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  source: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(`${source}.${key} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function optionalString(value: unknown, source: string, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') issues.push(`${source} must be a string`);
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown, source: string, issues: string[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') issues.push(`${source} must be a boolean`);
  return typeof value === 'boolean' ? value : undefined;
}

function optionalModuleType(
  value: unknown,
  source: string,
  issues: string[],
): 'module' | 'commonjs' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'module' && value !== 'commonjs') {
    issues.push(`${source} must be "module" or "commonjs"`);
    return undefined;
  }
  return value;
}

function optionalPackageMap(value: unknown, source: string, issues: string[]): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) =>
      optionalPackageMap(item, `${source}[${index}]`, issues)));
  }
  if (!value || typeof value !== 'object') {
    issues.push(`${source} must be a string, null, array, or object`);
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    optionalPackageMap(item, `${source}.${key}`, issues),
  ] as const);
  return Object.freeze(Object.fromEntries(entries));
}

function stringRecord(
  value: unknown,
  source: string,
  issues: string[],
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, source, issues);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string') issues.push(`${source}.${key} must be a string`);
    else result[key] = item;
  }
  return Object.freeze(result);
}

function isPackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value);
}
