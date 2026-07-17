import { createRequire } from 'node:module';
import type { PackageReference } from './manifest.js';
import type { ResolvedPackage } from './package-resolver.js';

const require = createRequire(import.meta.url);
const semver = require('semver') as SemverModule;

export const runtimeEngineVersion = '1.0.0';

export class PackageCompatibilityError extends Error {
  constructor(
    readonly packageName: string,
    readonly contract: 'engine' | 'feature-api',
    message: string,
  ) {
    super(`Incompatible ${contract} for ${packageName}: ${message}`);
    this.name = 'PackageCompatibilityError';
  }
}

export function assertPackageEngine(
  pkg: ResolvedPackage,
  engineVersion = runtimeEngineVersion,
): void {
  const range = pkg.packageJson.zhin.engine;
  if (!range) return;
  assertRange(pkg.name, 'engine', range);
  if (!semver.satisfies(engineVersion, range, { includePrerelease: true })) {
    throw new PackageCompatibilityError(
      pkg.name,
      'engine',
      `requires ${range}, Runtime provides ${engineVersion}`,
    );
  }
}

export function assertFeatureApi(
  owner: ResolvedPackage,
  reference: PackageReference,
  feature: ResolvedPackage,
): void {
  const actual = feature.packageJson.zhin.type === 'feature'
    ? feature.packageJson.zhin.featureApi
    : undefined;
  if (actual && !semver.valid(actual)) {
    throw new PackageCompatibilityError(
      feature.name,
      'feature-api',
      `declares invalid featureApi version ${actual}`,
    );
  }
  if (!reference.api) return;
  assertRange(owner.name, 'feature-api', reference.api);
  if (!actual) {
    throw new PackageCompatibilityError(
      feature.name,
      'feature-api',
      `must declare a valid featureApi version for ${owner.name}'s ${reference.api} requirement`,
    );
  }
  if (!semver.satisfies(actual, reference.api, { includePrerelease: true })) {
    throw new PackageCompatibilityError(
      feature.name,
      'feature-api',
      `${owner.name} requires ${reference.api}, provider declares ${actual}`,
    );
  }
}

function assertRange(
  packageName: string,
  contract: PackageCompatibilityError['contract'],
  range: string,
): void {
  if (!semver.validRange(range)) {
    throw new PackageCompatibilityError(packageName, contract, `invalid semver range ${range}`);
  }
}

interface SemverModule {
  valid(value: string): string | null;
  validRange(value: string): string | null;
  satisfies(
    version: string,
    range: string,
    options?: { readonly includePrerelease?: boolean },
  ): boolean;
}
