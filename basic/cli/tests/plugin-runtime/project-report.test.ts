// #1250 runtime-publish-silent-noop / runtime-subcommands-undocumented / runtime-inspect-raw-json-only:
// `zhin runtime build|publish` print their plan (and say so when it is empty), `inspect` prints a
// table that keeps disabled instances, and every subcommand states its scope in --help.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCommands } from '../../src/plugin-runtime/index.js';
import {
  describeBuildPlan,
  describePublishPlan,
  formatBuildPlan,
  formatInspectSummary,
  formatPublishPlan,
  NO_BUILD_SCRIPT_REASON,
  PRIVATE_PACKAGE_REASON,
  summarizeProjectGraph,
} from '../../src/plugin-runtime/project-report.js';

const temporary: string[] = [];
let stdout: string[];
let previousCwd: string;

beforeEach(() => {
  stdout = [];
  previousCwd = process.cwd();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
});

afterEach(async () => {
  process.chdir(previousCwd);
  process.exitCode = 0;
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('zhin runtime publish / build plans', () => {
  it('explains an all-private publish plan and lists each skipped package with its reason', async () => {
    const root = await fixture();
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const report = describePublishPlan(root, graph, commands.publishPlan(graph));
    expect(report).toMatchObject({ kind: 'publish', mode: 'dry-run', targetTag: 'latest', empty: true, packages: [] });
    expect(report.skipped).toEqual(expect.arrayContaining([
      { name: '@acme/root', version: '0.0.0', path: '.', reason: PRIVATE_PACKAGE_REASON },
      { name: '@acme/plugin-weather', version: '0.0.0', path: 'plugins/weather', reason: PRIVATE_PACKAGE_REASON },
    ]));
    const text = formatPublishPlan(report).join('\n');
    expect(text).toContain('没有可发布的包：3 个 workspace 包都是 private');
    expect(text).toContain('@acme/plugin-weather@0.0.0  plugins/weather — package.json 中 private: true');
  });

  it('lists the packages, versions and dist-tag of a non-empty plan, and the private ones it skips', async () => {
    const root = await fixture();
    await makePublic(join(root, 'plugins/weather/package.json'), '1.1.0');
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const dryRun = describePublishPlan(root, graph, commands.publishPlan(graph, { tag: 'next' }));
    expect(dryRun.empty).toBe(false);
    expect(dryRun.packages).toEqual([{ name: '@acme/plugin-weather', version: '1.1.0', path: 'plugins/weather' }]);
    expect(dryRun.skipped.map((pkg) => pkg.name)).toEqual(expect.arrayContaining(['@acme/root', '@acme/plugin-news']));
    const text = formatPublishPlan(dryRun).join('\n');
    expect(text).toContain('发布计划（dry-run，不会上传）：1 个包，目标 dist-tag next');
    expect(text).toContain('  - @acme/plugin-weather@1.1.0  plugins/weather');
    expect(text).toContain('跳过 2 个 workspace 包');
    const execute = describePublishPlan(root, graph, commands.publishPlan(graph, { execute: true, tag: 'next' }));
    expect(execute.stagingTag).toMatch(/^zhin-txn-/);
    expect(formatPublishPlan(execute).join('\n')).toContain(`临时 dist-tag ${execute.stagingTag}`);
  });

  it('names the workspace packages a build skips for lack of a build script', async () => {
    const root = await fixture();
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const report = describeBuildPlan(root, graph, commands.buildPlan(graph));
    expect(report.packages.map((pkg) => pkg.name)).toEqual(['@acme/root']);
    expect(report.skipped).toEqual(expect.arrayContaining([
      { name: '@acme/plugin-weather', version: '0.0.0', path: 'plugins/weather', reason: NO_BUILD_SCRIPT_REASON },
    ]));
    expect(formatBuildPlan(report)[0]).toBe('构建计划：按依赖顺序构建 1 个 workspace 包');
    expect(formatBuildPlan({ kind: 'build', packages: [], skipped: report.skipped, empty: true })[0])
      .toBe('没有需要构建的包：2 个 workspace 包都没有 build 脚本。');
    expect(formatBuildPlan({ kind: 'build', packages: [], skipped: report.skipped.slice(0, 1), empty: true })[0])
      .toBe(`没有需要构建的包：唯一的 workspace 包 ${report.skipped[0]!.name} 没有 build 脚本。`);
    expect(formatPublishPlan({ kind: 'publish', mode: 'dry-run', targetTag: 'latest', stagingTag: null, packages: [], skipped: report.skipped.slice(0, 1), empty: true, steps: [] })[0])
      .toBe(`没有可发布的包：唯一的 workspace 包 ${report.skipped[0]!.name} 是 private（package.json 中 private: true）。`);
  });

  it('zhin runtime publish: an empty dry-run says so and exits 0; --json carries empty: true', async () => {
    const root = await fixture();
    process.chdir(root);
    const { runtimeCommand } = await import('../../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['node', 'runtime', 'publish']);
    expect(stdout.join('\n')).toContain('没有可发布的包');
    expect(process.exitCode ?? 0).toBe(0);

    stdout = [];
    await runtimeCommand.parseAsync(['node', 'runtime', 'publish', '--json']);
    const json = JSON.parse(stdout.join('\n')) as { empty: boolean; mode: string; skipped: unknown[] };
    expect(json).toMatchObject({ empty: true, mode: 'dry-run' });
    expect(json.skipped).toHaveLength(3);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('zhin runtime publish --execute with nothing to publish exits 1 without writing a journal', async () => {
    const root = await fixture();
    process.chdir(root);
    const { runtimeCommand } = await import('../../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['node', 'runtime', 'publish', '--execute']);
    expect(stdout.join('\n')).toContain('没有可发布的包');
    expect(process.exitCode).toBe(1);
    await expect(readFile(join(root, '.zhin/publish-journal.json'), 'utf8')).rejects.toThrow();
  });
});

describe('zhin runtime inspect', () => {
  it('summarizes every declared instance and marks disabled ones 已停用', async () => {
    const root = await fixture();
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const summary = summarizeProjectGraph(graph, [
      { instanceKey: 'weather', package: '@acme/plugin-weather', enabled: true },
      { instanceKey: 'news', package: '@acme/plugin-news', enabled: false },
    ]);
    expect(summary.instances).toEqual([
      { instanceKey: 'weather', package: '@acme/plugin-weather', source: 'workspace', enabled: true, features: 0, children: 0 },
      { instanceKey: 'news', package: '@acme/plugin-news', source: 'workspace', enabled: false, features: null, children: null },
    ]);
    const text = formatInspectSummary(summary).join('\n');
    expect(text).toContain('插件实例: 2 个（启用 1，已停用 1）');
    expect(text).toMatch(/weather\s+@acme\/plugin-weather\s+workspace\s+启用\s+0/);
    expect(text).toMatch(/news\s+@acme\/plugin-news\s+workspace\s+已停用\s+—/);
  });

  it('prints the table by default and the full structure with --json', async () => {
    const root = await fixture();
    process.chdir(root);
    const { runtimeCommand } = await import('../../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['node', 'runtime', 'inspect']);
    const table = stdout.join('\n');
    expect(table).toContain('已停用');
    expect(table).not.toContain('"buildOrder"');

    stdout = [];
    await runtimeCommand.parseAsync(['node', 'runtime', 'inspect', '--json']);
    const json = JSON.parse(stdout.join('\n')) as { root: { children: { id: string }[] }; buildOrder: string[]; disabled: unknown[] };
    expect(json.root.children).toHaveLength(1);
    expect(json.buildOrder).toContain('@acme/plugin-weather');
    expect(json.disabled).toEqual([{ instanceKey: 'news', package: '@acme/plugin-news' }]);
  });
});

describe('zhin runtime --help', () => {
  it('describes inspect / migrate / build / publish with their scope and cross-references zhin build / pub', async () => {
    const { runtimeCommand } = await import('../../src/commands/runtime.js');
    const help = (name: string) => runtimeCommand.commands.find((command) => command.name() === name)!;
    for (const name of ['inspect', 'migrate', 'build', 'publish']) expect(help(name).description()).not.toBe('');
    expect(help('build').description()).toContain('整个 workspace');
    expect(help('build').description()).toContain('zhin build');
    expect(help('publish').description()).toContain('zhin pub');
    const publishHelp = help('publish').helpInformation();
    expect(publishHelp).toContain('需要 npm 登录');
    expect(publishHelp).toContain('--resume');
    expect(publishHelp).toContain('.zhin/publish-journal.json');
    const { buildCommand } = await import('../../src/commands/build.js');
    const { pubCommand } = await import('../../src/commands/pub.js');
    const helpText = (command: { outputHelp: (options?: unknown) => void }) => {
      const chunks: string[] = [];
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { chunks.push(String(chunk)); return true; }) as never);
      command.outputHelp();
      write.mockRestore();
      return chunks.join('');
    };
    expect(helpText(buildCommand)).toContain('zhin runtime build');
    expect(helpText(pubCommand)).toContain('zhin runtime publish');
    expect(helpText(help('publish'))).toContain('退出码');
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-report-'));
  temporary.push(root);
  const manifest = { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', features: [], plugins: [] };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(join(root, 'package.json'), json({
    name: '@acme/root', version: '0.0.0', private: true, type: 'module',
    scripts: { build: 'tsc --noEmit' },
    dependencies: { 'zhin.js': '^4.1.2', '@acme/plugin-weather': 'workspace:*', '@acme/plugin-news': 'workspace:*' },
    zhin: manifest,
  }));
  await writeFile(join(root, 'zhin.config.yml'), [
    'configVersion: 2',
    'plugins:',
    '  weather: "@acme/plugin-weather"',
    '  news: "@acme/plugin-news"',
    'disable_plugins:',
    '  - news',
    'weather: {}',
    '',
  ].join('\n'));
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - plugins/*\n');
  await writeFile(join(root, 'plugin.ts'), "import { definePlugin } from 'zhin.js';\n\nexport default definePlugin({ name: 'root' });\n");
  for (const name of ['weather', 'news']) {
    const child = join(root, 'plugins', name);
    await mkdir(child, { recursive: true });
    await writeFile(join(child, 'package.json'), json({
      name: `@acme/plugin-${name}`, version: '0.0.0', private: true, type: 'module',
      dependencies: { 'zhin.js': '^4.1.2' }, zhin: manifest,
    }));
    await writeFile(join(child, 'plugin.ts'), `import { definePlugin } from 'zhin.js';\n\nexport default definePlugin({ name: '${name}' });\n`);
  }
  return root;
}

async function makePublic(path: string, version: string): Promise<void> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  value.private = false;
  value.version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
