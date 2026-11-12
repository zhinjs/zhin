import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeExportConditions,
  INSTANCE_CLI_ENTRY,
  INSTANCE_ENTRY,
  ProjectInstanceNotFoundError,
  resolveProjectModule,
} from '../../src/utils/project-instance.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function project(withInstance: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-cli-instance-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  if (withInstance) {
    const pkg = join(root, 'node_modules/zhin.js');
    await mkdir(join(pkg, 'lib/instance/cli'), { recursive: true });
    await mkdir(join(pkg, 'src/instance'), { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'zhin.js',
      type: 'module',
      exports: {
        './instance': { development: './src/instance/index.ts', import: './lib/instance/index.js' },
        './instance/cli': { import: './lib/instance/cli/index.js' },
      },
    }));
    await writeFile(join(pkg, 'lib/instance/index.js'), 'export const marker = "fixture";\n');
    await writeFile(join(pkg, 'src/instance/index.ts'), 'export const marker = "fixture-source";\n');
    await writeFile(join(pkg, 'lib/instance/cli/index.js'), 'export {};\n');
  }
  return root;
}

describe('project instance resolution (ADR 0054 §0)', () => {
  it('reads custom export conditions from execArgv and NODE_OPTIONS', () => {
    const conditions = activeExportConditions(['--conditions=alpha', '-C', 'beta', '--import', 'tsx'], '--conditions gamma --max-old-space-size=1');
    expect(conditions).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
    expect(conditions).not.toContain('tsx');
  });

  it("resolves the project's own zhin.js instance entries", async () => {
    const root = await project(true);
    // Tests load the CLI from TypeScript sources, which selects the `development` condition.
    expect(fileURLToPath(resolveProjectModule(root, INSTANCE_ENTRY))).toBe(join(root, 'node_modules/zhin.js/src/instance/index.ts'));
    expect(fileURLToPath(resolveProjectModule(root, INSTANCE_CLI_ENTRY))).toBe(join(root, 'node_modules/zhin.js/lib/instance/cli/index.js'));
  });

  it("falls back to the CLI's own install location when the project has no zhin.js", async () => {
    const root = await project(false);
    const resolved = fileURLToPath(resolveProjectModule(root, INSTANCE_ENTRY));
    expect(resolved.startsWith(root)).toBe(false);
    expect(resolved).toMatch(/instance[\\/]index\.(?:ts|js)$/u);
  });

  it('reports a missing instance entry with the project root', () => {
    expect(() => resolveProjectModule(tmpdir(), 'zhin.js/does-not-exist')).toThrow(ProjectInstanceNotFoundError);
  });
});
