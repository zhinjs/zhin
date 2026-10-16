import { describe, expect, it } from 'vitest';
import { isToolPackageMissing, withToolPackageInstallHint } from '../src/missing-tool-package.js';

function notFound(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('missing @zhin.js/tool', () => {
  it('adds the exact install command', () => {
    const original = notFound("Cannot find package '@zhin.js/tool' imported from /app/plugins/x/tools/a.ts");
    const result = withToolPackageInstallHint(original) as Error & { code?: string };
    expect(result.message).toContain('pnpm add @zhin.js/tool');
    expect(result.message).toContain(original.message);
    expect(result.code).toBe('ERR_MODULE_NOT_FOUND');
    expect(result.cause).toBe(original);
  });

  it('leaves unrelated errors untouched', () => {
    const other = notFound("Cannot find package 'left-pad' imported from /app/a.ts");
    expect(isToolPackageMissing(other)).toBe(false);
    expect(withToolPackageInstallHint(other)).toBe(other);
    const plain = new Error("'@zhin.js/tool'");
    expect(withToolPackageInstallHint(plain)).toBe(plain);
  });
});
