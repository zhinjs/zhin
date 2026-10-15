import { describe, expect, it } from 'vitest';
import {
  isWorkroomPackageMissing,
  loadWorkroomHostModule,
  type WorkroomHostModule,
} from '../../../src/plugin-runtime/agent/workroom-loader.js';

function moduleNotFound(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('loadWorkroomHostModule', () => {
  it('resolves undefined only when the @zhin.js/workroom package itself is missing', async () => {
    const importer = async (): Promise<WorkroomHostModule> => {
      throw moduleNotFound("Cannot find package '@zhin.js/workroom' imported from /app/lib/workroom/module.js");
    };
    await expect(loadWorkroomHostModule(importer)).resolves.toBeUndefined();
  });

  it('rethrows a missing dependency of an installed workroom package', async () => {
    const error = moduleNotFound(
      "Cannot find package 'some-dep' imported from /app/node_modules/@zhin.js/workroom/lib/index.js",
    );
    await expect(loadWorkroomHostModule(async () => { throw error; })).rejects.toBe(error);
  });

  it('rethrows subpath misses of the workroom package', async () => {
    const error = moduleNotFound(
      "Cannot find module '/app/node_modules/@zhin.js/workroom/lib/missing.js' imported from /app/x.js",
    );
    await expect(loadWorkroomHostModule(async () => { throw error; })).rejects.toBe(error);
  });

  it('rethrows load failures instead of treating them as not installed', async () => {
    const corrupt = new Error('journal corrupt');
    await expect(loadWorkroomHostModule(async () => { throw corrupt; })).rejects.toBe(corrupt);
    const syntax = new SyntaxError('Unexpected token');
    await expect(loadWorkroomHostModule(async () => { throw syntax; })).rejects.toBe(syntax);
  });

  it('returns the module when it loads', async () => {
    const loaded = { marker: true } as unknown as WorkroomHostModule;
    await expect(loadWorkroomHostModule(async () => loaded)).resolves.toBe(loaded);
  });

  it('classifies only quoted package-root ERR_MODULE_NOT_FOUND errors as missing', () => {
    expect(isWorkroomPackageMissing(moduleNotFound("Cannot find package '@zhin.js/workroom' imported from x"))).toBe(true);
    expect(isWorkroomPackageMissing(new Error("Cannot find package '@zhin.js/workroom'"))).toBe(false);
    expect(isWorkroomPackageMissing(undefined)).toBe(false);
    expect(isWorkroomPackageMissing('@zhin.js/workroom')).toBe(false);
  });
});
