import { findForbiddenRelativeImports } from './lib/find-forbidden-imports.mjs';
import { findBarrelViolations, parseImports, parseReexports } from './lib/parse-imports.mjs';
import { isWorkroomPackageSpecifier } from './lib/workroom-specifier.mjs';

const typed = { includeTypeOnly: true };
const spec = './workroom/a.js';

describe('architecture layer import parsing', () => {
  it('skips type-only imports and re-exports by default', () => {
    expect(parseImports(`import type { X } from '${spec}';`)).toEqual([]);
    expect(parseImports(`export type { X } from '${spec}';`)).toEqual([]);
  });

  it.each([
    ['import type', `import type { X } from '${spec}';`],
    ['export type {..} from', `export type { X } from '${spec}';`],
    ['export type * from', `export type * from '${spec}';`],
    ['export * as ns from', `export * as ns from '${spec}';`],
    ['export type * as ns from', `export type * as ns from '${spec}';`],
    ['multi-line import type', `import type {\n  A,\n  B\n} from '${spec}';`],
    ['dynamic import()', `const m = import('${spec}');`],
    ['import() type', `type T = import('${spec}').T;`],
    ['bare import', `import '${spec}';`],
    ['require', `const m = require('${spec}');`],
  ])('reports %s with includeTypeOnly', (_name, source) => {
    expect(parseImports(source, typed)).toContain(spec);
  });

  it.each([
    `export type * from '${spec}';`,
    `export type { X } from '${spec}';`,
    `export * from '${spec}';`,
    `export * as ns from '${spec}';`,
    `export type * as ns from '${spec}';`,
  ])('parseImports returns exactly one entry per statement: %s', (source) => {
    expect(parseImports(source, typed)).toEqual([spec]);
  });

  it('default mode skips export type * forms but keeps export * forms', () => {
    expect(parseImports(`export type * from '${spec}';`)).toEqual([]);
    expect(parseImports(`export type * as ns from '${spec}';`)).toEqual([]);
    expect(parseImports(`export * as ns from '${spec}';`)).toEqual([spec]);
    expect(parseImports(`export * from '${spec}';`)).toEqual([spec]);
  });

  it('ignores imports inside comments and template strings', () => {
    const source = [
      `// import type { X } from '${spec}';`,
      `/* import { X } from '${spec}'; */`,
      'const t = `import type { X } from \'' + spec + '\'`;',
    ].join('\n');
    expect(parseImports(source, typed)).toEqual([]);
  });

  it('parseReexports returns export-from specifiers only', () => {
    const source = [
      `import x from './a.js';`,
      `export { y } from './b.js';`,
      `export type { Z } from './c.js';`,
      `export * from './d.js';`,
      `export type * from './e.js';`,
      `export * as ns from './f.js';`,
      `export type * as ns from './g.js';`,
    ].join('\n');
    expect(parseReexports(source).sort()).toEqual(['./b.js', './c.js', './d.js', './e.js', './f.js', './g.js']);
  });
});

describe('barrel re-export rule', () => {
  const restricted = (value: string) => value.startsWith('./workroom/');

  it('accepts pure re-exports', () => {
    const source = `export { a } from './workroom/a.js';\nexport type { B } from './workroom/b.js';\nexport * from './workroom/c.js';`;
    expect(findBarrelViolations(source, restricted)).toEqual([]);
  });

  it.each([
    `export type * from './workroom/a.js';`,
    `export * as ns from './workroom/a.js';`,
    `export type * as ns from './workroom/a.js';`,
  ])('accepts %s', (source) => {
    expect(findBarrelViolations(source, restricted)).toEqual([]);
  });

  it('reports a mixed export type * and import as exactly one violation', () => {
    const source = `export type * from './workroom/a.js'; import { a } from './workroom/a.js';`;
    expect(findBarrelViolations(source, restricted)).toEqual(['./workroom/a.js']);
  });

  it('reports import ... from into a domain directory', () => {
    expect(findBarrelViolations(`import { a } from './workroom/a.js';`, restricted)).toEqual(['./workroom/a.js']);
    expect(findBarrelViolations(`import type { A } from './workroom/a.js';`, restricted)).toEqual(['./workroom/a.js']);
    expect(findBarrelViolations(`const m = import('./workroom/a.js');`, restricted)).toEqual(['./workroom/a.js']);
  });

  it('still reports an import that shares a specifier with a re-export', () => {
    const source = `import x from './workroom/a.js';\nexport { y } from './workroom/a.js';`;
    expect(findBarrelViolations(source, restricted)).toEqual(['./workroom/a.js']);
  });

  it('ignores non-restricted imports', () => {
    expect(findBarrelViolations(`import x from './other.js';`, restricted)).toEqual([]);
  });
});

describe('data-governance direction rule', () => {
  const src = '/repo/packages/im/agent/src';
  const file = `${src}/data-governance/a.ts`;
  const forbiddenRoots = ['workroom', 'workroom-runtime', 'portfolio'].map(n => `${src}/${n}`);
  const run = (content: string) => findForbiddenRelativeImports({ file, content, forbiddenRoots });

  it.each([
    ['import', `import { x } from '../workroom/x.js';`],
    ['type-only import', `import type { X } from '../workroom/x.js';`],
    ['export * from', `export * from '../workroom/x.js';`],
    ['workroom-runtime', `import { x } from '../workroom-runtime/x.js';`],
    ['portfolio', `import { x } from '../portfolio/x.js';`],
    ['inline import() type', `export type T = import('../workroom/x.js').X;`],
    ['export { x } from', `export { x } from '../workroom/x.js';`],
  ])('reports %s', (_n, content) => {
    expect(run(content)).toHaveLength(1);
  });

  it.each([
    `import { x } from './canonical-value.js';`,
    `import { x } from '../data-governance/x.js';`,
    `import fs from 'node:fs';`,
    `import { x } from '../workroom-extra/x.js';`,
    `export type T = import('./x.js').X;`,
  ])('does not report %s', content => {
    expect(run(content)).toEqual([]);
  });

  it.each(['workroom', 'workroom-runtime', 'portfolio'])('exposes the matching root for %s', name => {
    expect(run(`import { x } from '../${name}/x.js';`)[0].root).toBe(`${src}/${name}`);
  });
});

describe('workroom package specifier rule', () => {
  it.each([
    '@zhin.js/workroom',
    '@zhin.js/workroom/workroom/a.js',
    '@zhin.js/workroom/portfolio/b.js',
  ])('matches %s', (s) => {
    expect(isWorkroomPackageSpecifier(s)).toBe(true);
  });

  it.each([
    '@zhin.js/workroom-extra',
    '@zhin.js/workroomx',
    '@zhin.js/agent',
    './workroom/a.js',
    'workroom',
  ])('does not match %s', (s) => {
    expect(isWorkroomPackageSpecifier(s)).toBe(false);
  });

  it.each([
    `export * from '@zhin.js/workroom/workroom/a.js';`,
    `export { a } from '@zhin.js/workroom';`,
  ])('barrel may re-export: %s', (source) => {
    expect(findBarrelViolations(source, isWorkroomPackageSpecifier)).toEqual([]);
  });

  it.each([
    `import { a } from '@zhin.js/workroom';`,
    `import type {A} from '@zhin.js/workroom/workroom/a.js';`,
    `const m = import('@zhin.js/workroom');`,
  ])('barrel must not import: %s', (source) => {
    expect(findBarrelViolations(source, isWorkroomPackageSpecifier)).toHaveLength(1);
  });

  it('non-barrel branch sees bare specifiers, including import type', () => {
    const source = `import type { A } from '@zhin.js/workroom/workroom/a.js';\nimport { b } from '@zhin.js/workroom';`;
    const hits = parseImports(source, typed).filter(isWorkroomPackageSpecifier);
    expect(hits).toEqual(['@zhin.js/workroom/workroom/a.js', '@zhin.js/workroom']);
  });
});
