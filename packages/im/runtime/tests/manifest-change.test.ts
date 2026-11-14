import { describe, expect, it } from 'vitest';
import { changedManifestFields, ManifestChangeTracker, RUNTIME_MANIFEST_FIELDS } from '../src/index.js';

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
