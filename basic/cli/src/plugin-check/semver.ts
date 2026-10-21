/**
 * Minimal typed access to `semver` (same pin as @zhin.js/runtime, which validates
 * `zhin.engine` / feature `api` ranges with it at load time).
 */
import { createRequire } from 'node:module';

interface SemverModule {
  valid(value: string): string | null;
  validRange(value: string): string | null;
  satisfies(version: string, range: string, options?: { readonly includePrerelease?: boolean }): boolean;
}

const requireFromCli = createRequire(import.meta.url);

export const semver = requireFromCli('semver') as SemverModule;
