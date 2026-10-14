import { findBarrelViolations, parseImports, parseReexports } from './lib/parse-imports.mjs';

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
    ['multi-line import type', `import type {\n  A,\n  B\n} from '${spec}';`],
    ['dynamic import()', `const m = import('${spec}');`],
    ['import() type', `type T = import('${spec}').T;`],
    ['bare import', `import '${spec}';`],
    ['require', `const m = require('${spec}');`],
  ])('reports %s with includeTypeOnly', (_name, source) => {
    expect(parseImports(source, typed)).toContain(spec);
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
    ].join('\n');
    expect(parseReexports(source).sort()).toEqual(['./b.js', './c.js', './d.js', './e.js', './f.js']);
  });
});

describe('barrel re-export rule', () => {
  const restricted = (value: string) => value.startsWith('./workroom/');

  it('accepts pure re-exports', () => {
    const source = `export { a } from './workroom/a.js';\nexport type { B } from './workroom/b.js';\nexport * from './workroom/c.js';`;
    expect(findBarrelViolations(source, restricted)).toEqual([]);
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
