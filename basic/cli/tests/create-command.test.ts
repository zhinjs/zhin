import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CREATE_KINDS,
  CreateConventionError,
  createCommand,
  createConvention,
  conventionTemplate,
  parseConventionName,
  type AddKind,
} from '../src/commands/create.js';
import { checkPluginSource } from '../src/plugin-check/source-checks.js';

const cliPath = path.resolve(__dirname, '../lib/cli.js');

let root: string;

function writePlugin(directory: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function pluginManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'zhin.js-demo',
    version: '0.1.0',
    type: 'module',
    peerDependencies: { 'zhin.js': 'workspace:^', '@zhin.js/command': 'workspace:^' },
    peerDependenciesMeta: { '@zhin.js/command': { optional: true } },
    devDependencies: { 'zhin.js': 'workspace:*', '@zhin.js/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.js',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [{ package: '@zhin.js/command', api: '^1.0.0' }],
      plugins: [],
    },
    ...overrides,
  };
}

function readManifest(directory = root): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-create-'));
  writePlugin(root, pluginManifest());
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('zhin create: convention files and manifest features', () => {
  const cases: ReadonlyArray<{ kind: AddKind; name: string; file: string; feature: string; importFrom: string }> = [
    { kind: 'command', name: 'gh/issue', file: 'commands/gh/issue/index.ts', feature: '@zhin.js/command', importFrom: 'zhin.js/command' },
    { kind: 'middleware', name: 'audit', file: 'middlewares/audit/index.ts', feature: '@zhin.js/middleware', importFrom: 'zhin.js/middleware' },
    { kind: 'handler', name: 'message/receive', file: 'handlers/message/receive/index.ts', feature: '@zhin.js/handler', importFrom: 'zhin.js/handler' },
    { kind: 'tool', name: 'lookup', file: 'tools/lookup/index.ts', feature: '@zhin.js/tool', importFrom: '@zhin.js/tool' },
    { kind: 'component', name: 'status-card', file: 'components/status-card/index.tsx', feature: '@zhin.js/component', importFrom: 'zhin.js/component' },
  ];

  it.each(cases)('$kind $name → $file + $feature', ({ kind, name, file, feature, importFrom }) => {
    const result = createConvention({ kind, name, cwd: root });

    expect(result.file).toBe(file);
    expect(result.pluginDirectory).toBe(root);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    expect(source).toContain(`from '${importFrom}'`);
    expect(source).toMatch(/^export default define[A-Za-z]+(?:<[^>]+>)?\(/mu);

    const manifest = readManifest();
    const features = manifest.zhin.features.filter((entry: { package: string }) => entry.package === feature);
    expect(features).toEqual([{ package: feature, api: '^1.0.0' }]);
    // Same policy as `zhin new`: the Runtime rejects features not declared as a dependency.
    expect(manifest.peerDependencies[feature]).toBe('workspace:^');
    expect(manifest.peerDependenciesMeta[feature]).toEqual({ optional: true });
    expect(manifest.devDependencies[feature]).toBe('workspace:*');

    // The author-facing check accepts the result (no "feature not declared" warning).
    const problems = checkPluginSource(root, manifest);
    expect(problems.warnings.filter((warning) => warning.includes('zhin.features'))).toEqual([]);
  });

  it('command reuses the existing feature and leaves package.json byte-for-byte unchanged', () => {
    const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const result = createConvention({ kind: 'command', name: 'hello', cwd: root });
    expect(result.manifestChanges).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('is idempotent: a second kind of the same feature adds nothing twice', () => {
    createConvention({ kind: 'middleware', name: 'one', cwd: root });
    const afterFirst = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const second = createConvention({ kind: 'middleware', name: 'two', cwd: root });
    expect(second.manifestChanges).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(afterFirst);
    expect(afterFirst.endsWith('}\n')).toBe(true);
    expect(afterFirst).toContain('\n  "zhin": {\n');
  });

  it('accepts string feature entries and dependencies declared outside peers', () => {
    writePlugin(root, pluginManifest({
      dependencies: { '@zhin.js/tool': 'workspace:*' },
      zhin: { ...(pluginManifest().zhin as object), features: ['@zhin.js/tool'] },
    }));
    const result = createConvention({ kind: 'tool', name: 'lookup', cwd: root });
    expect(result.manifestChanges).toEqual([]);
    expect(readManifest().peerDependencies['@zhin.js/tool']).toBeUndefined();
  });

  it('uses release ranges outside the workspace', () => {
    writePlugin(root, pluginManifest({
      peerDependencies: { 'zhin.js': '^1.0.0' },
      devDependencies: { 'zhin.js': '^1.0.0' },
    }));
    createConvention({ kind: 'middleware', name: 'audit', cwd: root });
    const manifest = readManifest();
    expect(manifest.peerDependencies['@zhin.js/middleware']).toMatch(/^\^\d+\.\d+\.\d+/u);
    expect(manifest.devDependencies['@zhin.js/middleware']).toBe(manifest.peerDependencies['@zhin.js/middleware']);
  });

  it('finds the plugin package from a nested directory', () => {
    const nested = path.join(root, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    const result = createConvention({ kind: 'command', name: 'hello', cwd: nested });
    expect(result.pluginDirectory).toBe(root);
    expect(fs.existsSync(path.join(root, 'commands/hello/index.ts'))).toBe(true);
  });

  it('command [param] segment declares the matching params entry', () => {
    createConvention({ kind: 'command', name: 'echo/[text]', cwd: root });
    const source = fs.readFileSync(path.join(root, 'commands/echo/[text]/index.ts'), 'utf8');
    expect(source).toContain("text: { type: 'string'");
    expect(source).toContain('params.text');
  });

  it('handler --event overrides path inference', () => {
    createConvention({ kind: 'handler', name: 'welcome', event: 'notice.receive', cwd: root });
    expect(fs.readFileSync(path.join(root, 'handlers/welcome/index.ts'), 'utf8')).toContain("event: 'notice.receive'");
  });
});

describe('zhin create: refusals', () => {
  it('refuses to overwrite an existing file unless --force', () => {
    createConvention({ kind: 'command', name: 'hello', cwd: root });
    const file = path.join(root, 'commands/hello/index.ts');
    fs.writeFileSync(file, '// mine\n');

    expect(() => createConvention({ kind: 'command', name: 'hello', cwd: root })).toThrow(/已存在.*--force/u);
    expect(fs.readFileSync(file, 'utf8')).toBe('// mine\n');

    const forced = createConvention({ kind: 'command', name: 'hello', cwd: root, force: true });
    expect(forced.overwritten).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('defineCommand');
  });

  it.each([
    ['command', 'Hello'],
    ['command', 'gh//issue'],
    ['command', '9lives'],
    ['command', 'echo/[[text]]'],
    ['command', 'echo/[...rest]'],
    ['command', '[text]/echo'],
    ['command', '[text]'],
    ['middleware', 'a/b'],
    ['tool', 'my_tool'],
    ['component', 'Card'],
    ['handler', 'message/Receive'],
  ])('rejects %s name %j', (kind, name) => {
    expect(() => createConvention({ kind, name, cwd: root })).toThrow(CreateConventionError);
    expect(fs.readdirSync(root)).toEqual(['package.json']);
  });

  it('rejects unknown kinds and points to zhin install', () => {
    expect(() => createConvention({ kind: 'some-plugin', name: 'x', cwd: root })).toThrow(/zhin install/u);
  });

  it('handler without a canonical path asks for --event', () => {
    expect(() => createConvention({ kind: 'handler', name: 'welcome', cwd: root })).toThrow(/--event/u);
    expect(() => createConvention({ kind: 'command', name: 'x', event: 'notice.receive', cwd: root })).toThrow(/handler/u);
  });

  it('refuses outside a plugin package', () => {
    const app = path.join(root, 'app');
    writePlugin(app, { name: 'bot-app', private: true });
    expect(() => createConvention({ kind: 'command', name: 'hello', cwd: app })).toThrow(/不是插件包/u);
    expect(fs.existsSync(path.join(app, 'commands'))).toBe(false);

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-create-bare-'));
    try {
      expect(() => createConvention({ kind: 'command', name: 'hello', cwd: bare })).toThrow(CreateConventionError);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('zhin create: templates', () => {
  const samples: ReadonlyArray<[AddKind, string, { event?: string }?]> = [
    ['command', 'gh/issue'],
    ['command', 'echo/[text]'],
    ['command', 'echo/[my-text]'],
    ['middleware', 'audit'],
    ['handler', 'message/receive'],
    ['handler', 'custom', { event: 'custom.event' }],
    ['tool', 'lookup'],
    ['component', 'status-card'],
  ];

  it.each(samples)('%s %s parses as TypeScript', (kind, name, extra) => {
    const { segments, parameter } = parseConventionName(kind, name);
    const source = conventionTemplate(kind, segments, { parameter, event: extra?.event });
    const output = ts.transpileModule(source, {
      fileName: kind === 'component' ? 'index.tsx' : 'index.ts',
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: 'zhin.js',
      },
    });
    expect((output.diagnostics ?? []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });

  it('lists every kind once', () => {
    expect([...CREATE_KINDS]).toEqual(['command', 'middleware', 'handler', 'tool', 'component']);
  });
});

describe('zhin create: CLI', () => {
  it('is listed in zhin --help and documents its kinds', () => {
    const help = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8', timeout: 20_000 });
    expect(help).toMatch(/^\s+create \[options\] <kind> <name>/mu);
    const addHelp = execFileSync(process.execPath, [cliPath, 'create', '--help'], { encoding: 'utf8', timeout: 20_000 });
    for (const text of ['Usage: zhin create [options] <kind> <name>', '--cwd <dir>', '--force', '--event <event>', 'components/<name>/index.tsx']) {
      expect(addHelp).toContain(text);
    }
  });

  it('writes the file, reports it, and exits non-zero on refusal', () => {
    const ok = spawnSync(process.execPath, [cliPath, 'create', 'command', 'hello', '--cwd', root], { encoding: 'utf8', timeout: 20_000 });
    expect(ok.status).toBe(0);
    expect(ok.stdout + ok.stderr).toContain(path.join('commands', 'hello', 'index.ts'));

    const again = spawnSync(process.execPath, [cliPath, 'create', 'command', 'hello', '--cwd', root], { encoding: 'utf8', timeout: 20_000 });
    expect(again.status).toBe(1);
    expect(again.stdout + again.stderr).toContain('--force');
  });
});
