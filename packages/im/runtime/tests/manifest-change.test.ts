import { describe, expect, it } from 'vitest';
import {
  changedManifestFields, ManifestChangeTracker, PLUGIN_PACKAGE_RUNTIME_MANIFEST_FIELDS, RUNTIME_MANIFEST_FIELDS,
} from '../src/index.js';

describe('package.json field comparison (#1250)', () => {
  it('reports top-level fields and pnpm settings per key', () => {
    expect(changedManifestFields(
      { scripts: { a: '1' }, pnpm: { overrides: {}, neverBuiltDependencies: [] }, keywords: ['x'] },
      { scripts: { a: '2' }, pnpm: { overrides: { ws: '1' }, neverBuiltDependencies: [] }, keywords: ['x'], description: 'd' },
    )).toEqual(['description', 'pnpm.overrides', 'scripts']);
  });

  it('treats install, resolution and manifest fields as runtime fields, and nothing cosmetic', () => {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'pnpm.overrides', 'zhin', 'exports', 'main', 'type']) {
      expect(RUNTIME_MANIFEST_FIELDS).toContain(field);
    }
    for (const field of ['scripts', 'description', 'keywords', 'version', 'author', 'license', 'repository']) {
      expect(RUNTIME_MANIFEST_FIELDS).not.toContain(field);
    }
  });

  it('counts install-affecting pnpm / metadata settings and engines, and version only for Plugin packages', () => {
    for (const field of ['pnpm.packageExtensions', 'pnpm.peerDependencyRules', 'dependenciesMeta', 'peerDependenciesMeta', 'engines']) {
      expect(RUNTIME_MANIFEST_FIELDS).toContain(field);
    }
    expect(PLUGIN_PACKAGE_RUNTIME_MANIFEST_FIELDS).toEqual(['version']);
    const files = new Map([['/p/package.json', '{"version":"1.0.0","engines":{"node":">=22"}}']]);
    const tracker = new ManifestChangeTracker((source) => files.get(source) ?? '');
    tracker.prime(['/p/package.json']);
    files.set('/p/package.json', '{"version":"1.0.1","engines":{"node":">=22"}}');
    expect(tracker.diff('/p/package.json')?.runtimeFields).toEqual([]);
    const checkpoint = tracker.checkpoint(['/p/package.json']);
    files.set('/p/package.json', '{"version":"1.0.2","engines":{"node":">=24"}}');
    expect(tracker.diff('/p/package.json', PLUGIN_PACKAGE_RUNTIME_MANIFEST_FIELDS)?.runtimeFields).toEqual(['engines', 'version']);
    // A reload that did not commit puts the baseline back: the same file diffs the same way.
    tracker.restore(checkpoint);
    expect(tracker.diff('/p/package.json', PLUGIN_PACKAGE_RUNTIME_MANIFEST_FIELDS)?.runtimeFields).toEqual(['engines', 'version']);
  });

  it('classifies only against a baseline, and treats invalid JSON as a runtime change', () => {
    const files = new Map([['/p/package.json', '{"scripts":{}}']]);
    const tracker = new ManifestChangeTracker((source) => {
      const text = files.get(source);
      if (text === undefined) throw new Error('ENOENT');
      return text;
    });
    // No baseline yet: unknown.
    expect(tracker.diff('/p/package.json')).toBeUndefined();
    files.set('/p/package.json', '{"scripts":{"a":"b"}}');
    expect(tracker.diff('/p/package.json')).toEqual({ source: '/p/package.json', fields: ['scripts'], runtimeFields: [] });
    files.set('/p/package.json', '{"scripts":');
    expect(tracker.diff('/p/package.json')?.runtimeFields).toEqual(['<unparseable>']);
    tracker.prime(['/p/missing/package.json']);
    expect(tracker.diff('/p/missing/package.json')).toBeUndefined();
  });
});
