import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModuleDependencyIndex } from '../src/module-dependency-index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('ModuleDependencyIndex', () => {
  it('does not traverse a package-name import that resolves outside the followed roots (#1250)', async () => {
    const workspace = await fixture();
    const project = join(workspace, 'project');
    const framework = join(workspace, 'framework');
    const local = join(project, 'plugins/weather');
    for (const directory of [join(project, 'tools/lookup'), join(project, 'node_modules/@test'), framework, local]) {
      await mkdir(directory, { recursive: true });
    }
    // Linked like pnpm does: the framework realpaths into sources outside the project.
    await writeFile(join(framework, 'package.json'), JSON.stringify({ name: '@test/framework', type: 'module', exports: './index.ts' }));
    await writeFile(join(framework, 'index.ts'), "import './internal.ts';\nexport const core = 1;\n");
    await writeFile(join(framework, 'internal.ts'), 'export {};\n');
    await writeFile(join(local, 'package.json'), JSON.stringify({ name: '@test/weather', type: 'module', exports: './wttr.ts' }));
    await writeFile(join(local, 'wttr.ts'), 'export const forecast = 1;\n');
    await symlink(framework, join(project, 'node_modules/@test/framework'), 'dir');
    await symlink(local, join(project, 'node_modules/@test/weather'), 'dir');
    const entry = join(project, 'tools/lookup/index.ts');
    await writeFile(entry, "import '@test/framework';\nimport '@test/weather';\nexport default 1;\n");

    const followed = await new ModuleDependencyIndex({
      followPackageImport: (source) => !relative(project, source).startsWith('..'),
    }).analyze(entry);
    expect([...followed.dependencies]).toEqual([join(local, 'wttr.ts')]);

    const unrestricted = await new ModuleDependencyIndex().analyze(entry);
    expect([...unrestricted.dependencies].sort()).toEqual(
      [join(framework, 'index.ts'), join(framework, 'internal.ts'), join(local, 'wttr.ts')].sort(),
    );
  });

  it('resolves package imports with ESM import conditions', async () => {
    const root = await fixture();
    const entry = join(root, 'commands/status/index.ts');
    const imported = join(root, 'src/import-target.ts');
    const required = join(root, 'src/require-target.ts');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      type: 'module',
      imports: {
        '#target': {
          import: './src/import-target.ts',
          require: './src/require-target.ts',
        },
      },
    }));
    await writeFile(entry, "import '#target';\nexport default 1;\n");
    await writeFile(imported, 'export default 1;\n');
    await writeFile(required, 'export default 2;\n');
    const index = new ModuleDependencyIndex();

    const result = await index.analyze(entry);

    expect([...result.dependencies]).toContain(imported);
    expect([...result.dependencies]).not.toContain(required);
  });

  it('matches .js authoring specifiers to .mts and .cts sources', async () => {
    const root = await fixture();
    const mtsEntry = join(root, 'commands/status/index.ts');
    const ctsEntry = join(root, 'commands/legacy/index.ts');
    const mts = join(root, 'commands/status/helper.mts');
    const cts = join(root, 'commands/legacy/helper.cts');
    await mkdir(join(root, 'commands/legacy'), { recursive: true });
    await writeFile(mtsEntry, "import './helper.js';\n");
    await writeFile(ctsEntry, "import './helper.js';\n");
    await writeFile(mts, 'export default 1;\n');
    await writeFile(cts, 'export default 2;\n');
    const index = new ModuleDependencyIndex();

    expect([...(await index.analyze(mtsEntry)).dependencies]).toContain(mts);
    expect([...(await index.analyze(ctsEntry)).dependencies]).toContain(cts);
  });

  it('tracks transitive CommonJS require calls and marks their entry as restart-only', async () => {
    const root = await fixture();
    const entry = join(root, 'commands/status/index.cts');
    const bridge = join(root, 'commands/status/bridge.cjs');
    const helper = join(root, 'commands/status/helper.js');
    await writeFile(entry, "module.exports = require('./bridge.cjs');\n");
    await writeFile(bridge, "module.exports = require('./helper.js');\n");
    await writeFile(helper, "module.exports = 'ready';\n");
    const index = new ModuleDependencyIndex();
    index.commit(entry, await index.analyze(entry));

    expect(index.affectedSources(helper)).toEqual([helper, entry]);
    expect(index.hasCommonJsImpact(helper)).toBe(true);
  });

  it('ignores require text in comments, strings, and template literals', async () => {
    const root = await fixture();
    const entry = join(root, 'commands/status/index.cts');
    const real = join(root, 'commands/status/real.cjs');
    const phantomNames = ['comment.cjs', 'string.cjs', 'template.cjs'];
    await writeFile(entry, [
      "// require('./comment.cjs')",
      "const text = \"require('./string.cjs')\";",
      "const template = `require('./template.cjs')`;",
      "module.exports = require('./real.cjs');",
    ].join('\n'));
    await writeFile(real, "module.exports = 'ready';\n");
    await Promise.all(phantomNames.map((name) =>
      writeFile(join(root, 'commands/status', name), 'module.exports = 0;\n'),
    ));
    const index = new ModuleDependencyIndex();

    const result = await index.analyze(entry);

    expect([...result.dependencies]).toEqual([real]);
  });

  it('treats .js entries under type commonjs as CommonJS closures', async () => {
    const root = await fixture();
    const entry = join(root, 'commands/status/index.js');
    const helper = join(root, 'commands/status/helper.js');
    await writeFile(join(root, 'package.json'), '{"type":"commonjs"}\n');
    await writeFile(entry, "module.exports = require('./helper.js');\n");
    await writeFile(helper, "module.exports = 'ready';\n");
    const index = new ModuleDependencyIndex();
    index.commit(entry, await index.analyze(entry));

    expect(index.affectedSources(helper)).toEqual([helper, entry]);
    expect(index.hasCommonJsImpact(helper)).toBe(true);
  });

  it('reuses a clean closure and re-analyzes it after a dependency changes', async () => {
    const root = await fixture();
    const entry = join(root, 'commands/status/index.js');
    const helper = join(root, 'commands/status/helper.js');
    const firstLeaf = join(root, 'commands/status/first.js');
    const secondLeaf = join(root, 'commands/status/second.js');
    await writeFile(entry, "import './helper.js';\n");
    await writeFile(helper, "import './first.js';\n");
    await writeFile(firstLeaf, 'export default 1;\n');
    await writeFile(secondLeaf, 'export default 2;\n');
    const index = new ModuleDependencyIndex();
    const first = await index.analyze(entry);
    index.commit(entry, first);

    await writeFile(helper, "import './second.js';\n");
    const cached = await index.analyze(entry);
    expect([...cached.dependencies]).toContain(firstLeaf);
    expect([...cached.dependencies]).not.toContain(secondLeaf);

    index.invalidate(helper);
    const refreshed = await index.analyze(entry);
    expect([...refreshed.dependencies]).not.toContain(firstLeaf);
    expect([...refreshed.dependencies]).toContain(secondLeaf);
  });

  it('re-analyzes cross-package closures when a dependency package changes module type', async () => {
    const root = await fixture();
    const dependencyRoot = join(root, 'packages/dependency');
    const dependencyManifest = join(dependencyRoot, 'package.json');
    const helper = join(dependencyRoot, 'helper.js');
    const entry = join(root, 'commands/status/index.js');
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(dependencyManifest, '{"type":"module"}\n');
    await writeFile(helper, 'export default 1;\n');
    await writeFile(entry, "import '../../packages/dependency/helper.js';\n");
    const index = new ModuleDependencyIndex();
    index.commit(entry, await index.analyze(entry));
    expect(index.hasCommonJsImpact(helper)).toBe(false);

    await writeFile(dependencyManifest, '{"type":"commonjs"}\n');
    index.invalidate(dependencyManifest);
    index.commit(entry, await index.analyze(entry));

    expect(index.hasCommonJsImpact(helper)).toBe(true);
  });

  it('removes reverse mappings for entries absent from committed ownership', async () => {
    const root = await fixture();
    const firstEntry = join(root, 'commands/status/index.js');
    const secondEntry = join(root, 'commands/legacy/index.js');
    const firstHelper = join(root, 'commands/status/helper.js');
    const secondHelper = join(root, 'commands/legacy/helper.js');
    await mkdir(join(root, 'commands/legacy'), { recursive: true });
    await writeFile(firstEntry, "import './helper.js';\n");
    await writeFile(secondEntry, "import './helper.js';\n");
    await writeFile(firstHelper, 'export default 1;\n');
    await writeFile(secondHelper, 'export default 2;\n');
    const index = new ModuleDependencyIndex();
    index.commit(firstEntry, await index.analyze(firstEntry));
    index.commit(secondEntry, await index.analyze(secondEntry));

    index.retain([firstEntry]);

    expect(index.affectedSources(firstHelper)).toEqual([firstHelper, firstEntry]);
    expect(index.affectedSources(secondHelper)).toEqual([secondHelper]);
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-module-dependencies-'));
  temporary.push(root);
  await mkdir(join(root, 'commands/status'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  return realpath(root);
}
