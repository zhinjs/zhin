import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as gateway from '../src/index.js';
import * as iam from '../src/iam.js';
import * as terminal from '../src/terminal.js';
import * as config from '../src/config.js';
import * as pluginManagement from '../src/plugin-management.js';
import * as project from '../src/project.js';
import * as supervisor from '../src/supervisor.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
// ADR 0054 §0: the gateway never loads zhin.js or IM layers.
const IM_SPECIFIER = /(?:from\s+|import\(\s*)'(zhin\.js|@zhin\.js\/(?:kernel|ai|core|agent|harness|adapter|command|component|middleware|handler|tool|skill|agent-feature|mcp-feature|prompt-section|schedule-feature|feature-kit|permission|im-contract|jsx|mcp|a2a|cli))(?:\/[^']*)?'/u;

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  }));
  return files.flat();
}

describe('@zhin.js/gateway package boundary', () => {
  it('exposes each area through its subpath and the root entry', () => {
    expect(iam.ConsoleIamService).toBeTypeOf('function');
    expect(iam.ConsoleSetupService).toBeTypeOf('function');
    expect(iam.installConsoleIam).toBeTypeOf('function');
    expect(terminal.installHostConsoleTerminal).toBeTypeOf('function');
    expect(terminal.TerminalService).toBeTypeOf('function');
    expect(config.ConsoleConfigurationStore).toBeTypeOf('function');
    expect(pluginManagement.PluginManagementWorkflow).toBeTypeOf('function');
    expect(project.findConfigFile).toBeTypeOf('function');
    expect(project.loadRuntimeEnvironmentLayers).toBeTypeOf('function');
    expect(supervisor.NativeTypeScriptSupervisor).toBeTypeOf('function');
    for (const area of [iam, terminal, config, pluginManagement, project, supervisor]) {
      for (const [name, value] of Object.entries(area)) expect(gateway[name as keyof typeof gateway]).toBe(value);
    }
  });

  it('declares every subpath it implements in package.json exports', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { development: string }>;
      publishConfig: { exports: Record<string, unknown> };
    };
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      await expect(readFile(join(packageRoot, target.development), 'utf8')).resolves.toBeTypeOf('string');
      expect(manifest.publishConfig.exports[subpath]).toBeDefined();
    }
  });

  it('imports neither zhin.js nor IM layers nor the CLI', async () => {
    const violations: string[] = [];
    for (const file of await sources(join(packageRoot, 'src'))) {
      const match = IM_SPECIFIER.exec(await readFile(file, 'utf8'));
      if (match) violations.push(`${file}: ${match[1]}`);
    }
    expect(violations).toEqual([]);
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const dependencies = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']
      .flatMap(section => Object.keys(manifest[section] ?? {}));
    expect(dependencies.filter(name => IM_SPECIFIER.test(`from '${name}'`))).toEqual([]);
  });
});
