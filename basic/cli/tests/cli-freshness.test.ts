import { describe, expect, it } from 'vitest';
import { checkCliFreshness, formatOutdatedCliAdvice, runningCliVersion } from '../src/utils/cli-freshness.js';
import type { RegistryLookup } from '../src/utils/registry-version.js';

const registry = (version: string | undefined): RegistryLookup => name =>
  name === '@zhin.js/cli' && version ? { version, dependencies: {} } : undefined;

describe('migrate CLI freshness (#1250 migrate-runs-installed-old-cli)', () => {
  it('reads the running CLI version from its own package.json', () => {
    expect(runningCliVersion()).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it('tells an outdated CLI from a current or newer one', () => {
    expect(checkCliFreshness({ running: '1.9.2', lookup: registry('1.10.0') })).toEqual({ status: 'outdated', running: '1.9.2', latest: '1.10.0' });
    expect(checkCliFreshness({ running: '1.10.0', lookup: registry('1.10.0') })).toMatchObject({ status: 'current' });
    // A development build ahead of the registry is not outdated.
    expect(checkCliFreshness({ running: '1.11.0-next.1', lookup: registry('1.10.0') })).toMatchObject({ status: 'current' });
  });

  it('is unknown offline or without a readable running version', () => {
    expect(checkCliFreshness({ running: '1.9.2', lookup: registry(undefined) })).toEqual({ status: 'unknown', running: '1.9.2' });
    expect(checkCliFreshness({ running: undefined, lookup: registry('1.10.0') })).toEqual({ status: 'unknown' });
  });

  it('advises the latest CLI first, explains the release-age gate and never offers a stop or an escape hatch', () => {
    const outdated = { status: 'outdated', running: '1.9.2', latest: '1.10.0' } as const;
    const advice = formatOutdatedCliAdvice(outdated).join('\n');
    expect(advice.indexOf('npx @zhin.js/cli@latest migrate')).toBeGreaterThan(-1);
    expect(advice.indexOf('npx @zhin.js/cli@latest migrate')).toBeLessThan(advice.indexOf('pnpm add @zhin.js/cli@latest'));
    expect(advice).toContain('pnpm dlx @zhin.js/cli@latest migrate');
    expect(advice).toContain('minimumReleaseAge');
    expect(advice).toContain('继续');
    expect(advice).not.toContain('--allow-outdated-cli');
  });
});
