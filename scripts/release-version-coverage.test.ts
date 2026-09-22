import { describe, expect, it } from 'vitest';

import {
  findMissingVersionTags,
  findUncoveredPackageChanges,
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
