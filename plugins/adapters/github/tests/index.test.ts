import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('@zhin.js/adapter-github package', () => {
  it('should have plugin entry and adapter module', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../plugin.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../adapters/github.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../schema.json'))).toBe(true);
  });

  it('package.json should have runtime exports and zhin manifest', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.exports['.'].development).toBe('./src/index.ts');
    expect(pkg.zhin?.entry).toBe('./plugin.ts');
    expect(pkg.dependencies['@zhin.js/adapter']).toBe('workspace:*');
    expect(pkg.dependencies['@zhin.js/host-http']).toBe('workspace:*');
  });
});
