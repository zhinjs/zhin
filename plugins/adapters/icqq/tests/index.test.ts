import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

describe('@zhin.js/adapter-icqq package', () => {
  it('should have plugin entry and adapter module', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../plugin.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../adapters/icqq/index.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../src/endpoint.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../schema.json'))).toBe(true);
  });

  it('package.json should have runtime exports and zhin manifest', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.exports['.'].development).toBe('./src/index.ts');
    expect(pkg.zhin?.entry).toBe('./plugin.js');
    expect(pkg.dependencies['@zhin.js/adapter']).toBe('workspace:*');
    expect(pkg.dependencies['@zhin.js/tool']).toBe('workspace:*');
    expect(pkg.dependencies['@zhin.js/skill']).toBe('workspace:*');
    expect(pkg.dependencies['@zhin.js/host-http']).toBeUndefined();
    expect(pkg.zhin.features.map((f: { package: string }) => f.package)).toContain('@zhin.js/tool');
    expect(pkg.zhin.features.map((f: { package: string }) => f.package)).toContain('@zhin.js/skill');
    expect(pkg.files).toContain('skills');
    expect(pkg.files).not.toContain('tools');
  });

  it('ICQQ tools are disclosed through the ICQQ Skill and use @zhin.js/tool', () => {
    const like = path.resolve(__dirname, '../skills/icqq/tools/send_user_like/index.ts');
    expect(fs.existsSync(like)).toBe(true);
    const src = fs.readFileSync(like, 'utf8');
    expect(src).toContain("from '@zhin.js/tool'");
  });

  it('send_user_like default-exports a branded @zhin.js/tool definition', async () => {
    const like = path.resolve(__dirname, '../skills/icqq/tools/send_user_like/index.ts');
    const mod = await import(pathToFileURL(like).href) as {
      default: { $feature: string; description: string; platforms?: readonly string[] };
    };
    expect(mod.default.$feature).toBe('zhin.agent-tool/1');
    expect(mod.default.description).toContain('赞');
    expect(mod.default.platforms).toEqual(['icqq']);
    expect(mod.default.approval).toBe('never');
  });

  it('tool permissions use valid permit DSL (not platform(icqq) without a perm)', async () => {
    const { isBuiltinPermit, isPlatformPermit } = await import('@zhin.js/permission');
    const dir = path.resolve(__dirname, '../skills/icqq/tools');
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(entry.name, 'index.ts'))
      .filter((file) => fs.existsSync(path.join(dir, file)));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(dir, file)).href) as {
        default: { permissions?: readonly string[] };
      };
      for (const permit of mod.default.permissions ?? []) {
        expect(
          isBuiltinPermit(permit) || isPlatformPermit(permit),
          `${file}: invalid permit ${permit}`,
        ).toBe(true);
      }
    }
  });
});
