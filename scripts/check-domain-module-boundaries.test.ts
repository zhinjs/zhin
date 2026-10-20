import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDomainModuleBoundaries } from './check-domain-module-boundaries.mjs';

const domains = [{ name: 'Fixture domain', directory: 'packages/fixture/src/domain' }];

function inspect(source: string, missingEntry = false, legacyEntry = false) {
  const root = mkdtempSync(join(tmpdir(), 'zhin-domain-boundary-'));
  const write = (file: string, content: string) => {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  try {
    if (!missingEntry) write(`${domains[0].directory}/index.ts`, 'export {};');
    write(`${domains[0].directory}/internal.ts`, 'export const value = 1;');
    write(`${domains[0].directory}/consumer.ts`, "import { value } from './internal.js';");
    if (legacyEntry) write(`${domains[0].directory}.ts`, 'export {};');
    write('packages/fixture/src/consumer.ts', source);
    return checkDomainModuleBoundaries(root, domains);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('domain module boundary gate', () => {
  it.each([
    "import { value } from './domain/internal.js';",
    "import type { Value } from './domain/internal.js';",
    "export { value } from './domain/internal.js';",
    "import './domain/internal.js';",
    "const value = import('./domain/internal.js');",
    "const value = require('./domain/internal.js');",
    "import value = require('./domain/internal.js');",
    "type Value = import('./domain/internal.js').Value;",
  ])('rejects external access to internal modules: %s', (source) => {
    expect(inspect(`// fixture\n${source}`)).toEqual([
      expect.objectContaining({
        file: 'packages/fixture/src/consumer.ts',
        line: 2,
        specifier: './domain/internal.js',
      }),
    ]);
  });

  it('allows the canonical entry and collaboration inside the domain', () => {
    expect(inspect("import { value } from './domain/index.js';")).toEqual([]);
  });

  it('ignores comments and source examples, but checks executable template expressions', () => {
    const examples = [
      "// import './domain/internal.js';",
      "/* export { value } from './domain/internal.js'; */",
      'const example = "import(\'./domain/internal.js\')";',
      "const template = `import('./domain/internal.js')`;",
    ].join('\n');
    expect(inspect(examples)).toEqual([]);
    expect(inspect("const template = `${import('./domain/internal.js')}`;")).toHaveLength(1);
  });

  it('rejects missing canonical entries and legacy flat entries', () => {
    expect(inspect('', true)).toEqual([
      expect.objectContaining({ specifier: 'missing canonical entry' }),
    ]);
    expect(inspect('', false, true)).toEqual([
      expect.objectContaining({ specifier: 'legacy flat entry' }),
    ]);
    expect(inspect("import './domain.js';")).toEqual([
      expect.objectContaining({ specifier: './domain.js' }),
    ]);
  });
});
