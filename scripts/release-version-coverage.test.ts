import { describe, expect, it } from 'vitest';

import {
  compareReleaseVersions,
  findLatestReleasedVersions,
  findMinorLineViolations,
  findMissingVersionTags,
  findPrereleaseReleases,
  findStaleApprovals,
  findUnapprovedMinorReleases,
  findUncoveredPackageChanges,
  isMinorReleaseVersion,
  isReleaseRelevantPath,
} from './release-version-coverage.mjs';

describe('release version coverage', () => {
  it('requires a changeset for publishable content changed after the current version tag', () => {
    expect(findUncoveredPackageChanges({
      packages: [
        {
          name: '@zhin.js/console-contract',
          version: '1.1.0',
          directory: 'packages/console/plugin-contract',
          changedFiles: [
            'packages/console/plugin-contract/src/page.ts',
            'packages/console/plugin-contract/tests/contract.test.ts',
          ],
        },
        {
          name: '@zhin.js/logger',
          version: '1.1.1',
          directory: 'basic/logger',
          changedFiles: [],
        },
      ],
      plannedPackages: new Set(),
    })).toEqual([
      {
        name: '@zhin.js/console-contract',
        version: '1.1.0',
        changedFiles: ['packages/console/plugin-contract/src/page.ts'],
      },
    ]);
  });

  it('accepts a changed package once a pending changeset covers it', () => {
    expect(findUncoveredPackageChanges({
      packages: [{
        name: '@zhin.js/schema',
        version: '1.1.0',
        directory: 'basic/schema',
        changedFiles: ['basic/schema/README.md'],
      }],
      plannedPackages: new Set(['@zhin.js/schema']),
    })).toEqual([]);
  });

  it('ignores tests and generated release metadata', () => {
    expect(isReleaseRelevantPath('pkg/tests/runtime.test.ts')).toBe(false);
    expect(isReleaseRelevantPath('pkg/src/runtime.test.ts')).toBe(false);
    expect(isReleaseRelevantPath('pkg/src/runtime.spec.tsx')).toBe(false);
    expect(isReleaseRelevantPath('pkg/CHANGELOG.md')).toBe(false);
    expect(isReleaseRelevantPath('pkg/src/runtime.ts')).toBe(true);
    expect(isReleaseRelevantPath('pkg/README.md')).toBe(true);
    expect(isReleaseRelevantPath('pkg/tsconfig.json')).toBe(true);
    expect(findUncoveredPackageChanges({
      packages: [{
        name: '@zhin.js/logger',
        version: '1.1.1',
        directory: 'basic/logger',
        changedFiles: [
          'basic/logger/tests/runtime.test.ts',
          'basic/logger/src/runtime.spec.ts',
          'basic/logger/CHANGELOG.md',
        ],
      }],
      plannedPackages: new Set(),
    })).toEqual([]);
  });

  it('fails closed for unplanned packages without their current version tag', () => {
    const packages = [
      { name: '@zhin.js/logger', version: '1.1.1' },
      { name: '@zhin.js/schema', version: '1.1.0' },
    ];

    expect(findMissingVersionTags({
      packages,
      plannedPackages: new Set(['@zhin.js/schema']),
      existingTags: new Set(),
    })).toEqual(['@zhin.js/logger@1.1.1']);

    expect(findMissingVersionTags({
      packages,
      plannedPackages: new Set(),
      existingTags: new Set(['@zhin.js/logger@1.1.1']),
    })).toEqual(['@zhin.js/schema@1.1.0']);
  });
});

describe('approved minor releases', () => {
  const approvals = (entries: Record<string, string | undefined>) => new Map(
    Object.entries(entries).map(([name, version]) => [name, { version }]),
  );
  const coreMinor = { name: '@zhin.js/core', type: 'minor', oldVersion: '1.13.1', newVersion: '1.14.0' };

  it('recognizes minor release versions and orders versions', () => {
    expect(isMinorReleaseVersion('1.14.0')).toBe(true);
    expect(isMinorReleaseVersion('0.1.0')).toBe(true);
    for (const version of ['1.14.1', '2.0.0', '1.14', '01.2.0', '1.2.0-beta.0', undefined, 1.2]) {
      expect(isMinorReleaseVersion(version)).toBe(false);
    }
    expect(compareReleaseVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareReleaseVersions('1.10.0', '1.9.1')).toBe(1);
    expect(compareReleaseVersions('1.10.0', '1.10.0')).toBe(0);
    expect(compareReleaseVersions('1.10.0', 'next')).toBeUndefined();
  });

  it('requires an approval for exactly the planned minor version', () => {
    const releases = [coreMinor, { name: '@zhin.js/ai', type: 'patch', oldVersion: '1.8.2', newVersion: '1.8.3' }];
    expect(findUnapprovedMinorReleases({ releases, approvedMinors: approvals({ '@zhin.js/core': '1.14.0' }) })).toEqual([]);
    expect(findUnapprovedMinorReleases({ releases, approvedMinors: approvals({}) })).toEqual([
      { name: '@zhin.js/core', oldVersion: '1.13.1', newVersion: '1.14.0', approvedVersion: undefined },
    ]);
    // A package-only approval (no version) or one for another version never matches.
    expect(findUnapprovedMinorReleases({ releases, approvedMinors: approvals({ '@zhin.js/core': undefined }) }))
      .toHaveLength(1);
    expect(findUnapprovedMinorReleases({ releases, approvedMinors: approvals({ '@zhin.js/core': '1.13.0' }) })).toEqual([
      { name: '@zhin.js/core', oldVersion: '1.13.1', newVersion: '1.14.0', approvedVersion: '1.13.0' },
    ]);
  });

  it('takes the most recently released stable tag per package as the baseline', () => {
    expect(findLatestReleasedVersions(new Map<string, number | undefined>([
      ['@zhin.js/cli@4.0.1', 100], // abandoned pre-1.x line: higher number, released earlier
      ['@zhin.js/cli@1.9.0', 300],
      ['@zhin.js/cli@1.9.1', 300], // same commit date: the higher version wins
      ['@zhin.js/cli@1.10.0-beta.1', 400],
      ['@zhin.js/cli@1.10', 400],
      ['zhin.js@1.9.0', undefined],
      ['zhin.js@0.1.0', 1],
      ['v1.0.0', 500],
    ]))).toEqual(new Map([['@zhin.js/cli', '1.9.1'], ['zhin.js', '0.1.0']]));
  });

  describe('minor line of the latest tag', () => {
    const latestReleased = new Map([['@zhin.js/cli', '1.9.1']]);
    const patch = (oldVersion: string, newVersion: string) => ({ name: '@zhin.js/cli', type: 'patch', oldVersion, newVersion });
    const check = (release: object, approved: Record<string, string> = {}, extra = {}) => findMinorLineViolations({
      releases: [release], latestReleased, approvedMinors: approvals(approved), ...extra,
    }).map(({ problem }) => problem);

    it('rejects a patch plan on a hand-edited new minor and any major', () => {
      expect(check(patch('1.10.3', '1.10.4'))).toEqual(['minor']);
      // An approval only ever names X.Y.0, so a hand-edited X.Y.Z can never be approved.
      expect(check(patch('1.10.3', '1.10.4'), { '@zhin.js/cli': '1.10.0' })).toEqual(['minor']);
      expect(check(patch('2.0.0', '2.0.1'))).toEqual(['major']);
      expect(check({ ...patch('1.9.1', '2.0.0'), type: 'major' }, { '@zhin.js/cli': '2.0.0' })).toEqual(['major']);
    });

    it('accepts the released line, an exact approval, and an untagged new package', () => {
      expect(check(patch('1.9.1', '1.9.2'))).toEqual([]);
      expect(check(patch('1.9.7', '1.9.8'))).toEqual([]);
      expect(check({ ...patch('1.9.9', '1.10.0'), type: 'minor' }, { '@zhin.js/cli': '1.10.0' })).toEqual([]);
      expect(check({ name: '@zhin.js/new', type: 'patch', oldVersion: '3.4.0', newVersion: '3.4.1' })).toEqual([]);
    });

    it('accepts a follow-up patch only on a real approved version commit', () => {
      const approved = { '@zhin.js/cli': '1.10.0' };
      const currentVersions = new Map([['@zhin.js/cli', '1.10.0']]);
      expect(check(patch('1.10.0', '1.10.1'), approved, { currentVersions, hasVersionCommit: () => true })).toEqual([]);
      expect(check(patch('1.10.0', '1.10.1'), approved, { currentVersions, hasVersionCommit: () => false })).toEqual(['minor']);
      expect(check(patch('1.11.0', '1.11.1'), approved, {
        currentVersions: new Map([['@zhin.js/cli', '1.11.0']]), hasVersionCommit: () => true,
      })).toEqual(['minor']);
    });
  });

  it('lists planned releases with prerelease versions', () => {
    expect(findPrereleaseReleases([
      { name: 'b', type: 'patch', oldVersion: '1.2.0', newVersion: '1.2.1-beta.0' },
      { name: 'a', type: 'patch', oldVersion: '1.2.0-rc.1', newVersion: '1.2.0' },
      { name: 'c', type: 'patch', oldVersion: '1.2.0', newVersion: '1.2.1' },
      { name: 'd', type: 'none', oldVersion: '1.0.0-x', newVersion: '1.0.0-x' },
    ])).toEqual([
      { name: 'a', oldVersion: '1.2.0-rc.1', newVersion: '1.2.0' },
      { name: 'b', oldVersion: '1.2.0', newVersion: '1.2.1-beta.0' },
    ]);
  });

  describe('stale approvals', () => {
    const stale = ({
      approved = { '@zhin.js/core': '1.14.0' } as Record<string, string>,
      plannedMinors = new Map<string, string>(),
      current = '1.13.1',
      tags = [] as string[],
    }) => findStaleApprovals({
      approvedMinors: approvals(approved),
      plannedMinors,
      currentVersions: new Map([['@zhin.js/core', current]]),
      existingTags: new Set(tags),
    });

    it('keeps an approval the plan is about to use', () => {
      expect(stale({ plannedMinors: new Map([['@zhin.js/core', '1.14.0']]) })).toEqual([]);
    });

    it('keeps an approval whose version commit is waiting for its tag (version PR)', () => {
      // Also covers a follow-up patch on top of the unpublished minor version commit: the plan
      // then has no minor for the package, but package.json already carries the approved version.
      expect(stale({ current: '1.14.0' })).toEqual([]);
    });

    it('rejects an approval whose version is already tagged', () => {
      expect(stale({ current: '1.14.0', tags: ['@zhin.js/core@1.14.0'] })).toEqual([{
        package: '@zhin.js/core', version: '1.14.0', problem: 'is already published (tag @zhin.js/core@1.14.0 exists)',
      }]);
      expect(stale({ plannedMinors: new Map([['@zhin.js/core', '1.14.0']]), tags: ['@zhin.js/core@1.14.0'] }))
        .toHaveLength(1);
    });

    it('rejects an approval lower than the current version', () => {
      expect(stale({ current: '1.14.1' })).toEqual([{
        package: '@zhin.js/core', version: '1.14.0', problem: 'is lower than the current version 1.14.1',
      }]);
      expect(stale({ current: '1.15.0', plannedMinors: new Map([['@zhin.js/core', '1.16.0']]) })).toHaveLength(1);
    });

    it('rejects an orphan approval', () => {
      expect(stale({})).toEqual([{
        package: '@zhin.js/core',
        version: '1.14.0',
        problem: 'is not used: the release plan has no minor for @zhin.js/core and its current version is 1.13.1',
      }]);
    });

    it('rejects an approval for a package outside the workspace', () => {
      expect(stale({ approved: { '@zhin.js/core': '1.14.0', '@zhin.js/gone': '1.2.0' }, plannedMinors: new Map([['@zhin.js/core', '1.14.0']]) }))
        .toEqual([{ package: '@zhin.js/gone', version: '1.2.0', problem: 'is not a publishable workspace package' }]);
    });
  });
});
