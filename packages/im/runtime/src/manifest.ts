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
  readonly entry: string;
  readonly engine?: string;
  readonly runtime?: 'trusted' | 'isolated';
  readonly features: readonly PackageReference[];
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

export function parsePackageJson(value: unknown, source: string): PackageJson {
  const issues: string[] = [];
  const record = asRecord(value, source, issues);
  const name = readString(record, 'name', source, issues);
  if (name && !isPackageName(name)) issues.push(`${source}#name is not a valid package name`);
  const zhin = parseZhinManifest(record.zhin, `${source}#zhin`, issues);
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

function parseZhinManifest(
  value: unknown,
  source: string,
  issues: string[],
): ZhinPackageManifest | undefined {
  const record = asRecord(value, source, issues);
  if (record.protocol !== 1) issues.push(`${source}.protocol must be 1`);
  const type = readString(record, 'type', source, issues);
  const entry = readRelativeEntry(record.entry, `${source}.entry`, issues);
  const engine = optionalString(record.engine, `${source}.engine`, issues);
  if (!entry || (type !== 'plugin' && type !== 'feature')) {
    if (type && type !== 'plugin' && type !== 'feature') {
      issues.push(`${source}.type must be "plugin" or "feature"`);
    }
    return undefined;
  }

  if (type === 'feature') {
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
  return Object.freeze({
    protocol: 1,
    type,
    entry,
    engine,
    runtime: runtime as 'trusted' | 'isolated' | undefined,
    features: parseReferences(record.features, `${source}.features`, issues, false),
    plugins: parseReferences(record.plugins, `${source}.plugins`, issues, true),
  });
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
    if (!isPackageName(packageName)) {
      issues.push(`${itemSource}.package is not a valid package name`);
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

function readRelativeEntry(value: unknown, source: string, issues: string[]): string | undefined {
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
