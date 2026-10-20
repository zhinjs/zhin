import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installZhinPackage,
  normalizePackageName,
  removeZhinPackage,
} from '../../src/utils/zhin-packages.js';

describe('normalizePackageName', () => {
  it('parses unscoped npm specs', () => {
    expect(normalizePackageName('npm:pkg')).toBe('pkg');
    expect(normalizePackageName('npm:pkg@1.2.3')).toBe('pkg');
  });

  it('parses scoped npm specs without producing an empty name', () => {
    expect(normalizePackageName('npm:@scope/pkg')).toBe('scope-pkg');
    expect(normalizePackageName('npm:@scope/pkg@1.2.3')).toBe('scope-pkg');
  });

  it('keeps git and bare-source behavior unchanged', () => {
    expect(normalizePackageName('git:https://example.com/foo/bar.git')).toBe('bar');
    expect(normalizePackageName('some source')).toBe('some-source');
  });
});

describe('install/remove empty-name guard', () => {
  it('rejects install sources that normalize to an empty name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-pkgs-'));
    try {
      expect(() => installZhinPackage('npm:@', { cwd: dir })).toThrow(/无法解析包名/);
      expect(() => installZhinPackage('   ', { cwd: dir })).toThrow(/无法解析包名/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects remove with an empty name instead of wiping the packages root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-pkgs-'));
    try {
      expect(() => removeZhinPackage('', { cwd: dir })).toThrow(/包名不能为空/);
      expect(() => removeZhinPackage('   ', { cwd: dir })).toThrow(/包名不能为空/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
