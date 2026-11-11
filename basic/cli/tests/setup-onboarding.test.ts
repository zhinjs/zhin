/** `zhin setup` non-interactive steps 3–4 (ADR 0053 §5): same OnboardingService as the Console. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { OnboardingService } from '@zhin.js/gateway/onboarding';
import { PluginManagementWorkflow } from '@zhin.js/gateway/plugin-management';

let tmp: string;
let prevCwd: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-setup-onboarding-')));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo-bot', version: '1.0.0', dependencies: { 'zhin.js': 'latest' } }, null, 2));
  fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  process.chdir(tmp);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function fakePackageManager(calls: string[][], fail?: string) {
  return async (args: readonly string[], root: string) => {
    calls.push([...args]);
    for (const spec of args.slice(1).filter(arg => !arg.startsWith('-'))) {
      const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
      const name = at < 0 ? spec : spec.slice(0, at);
      if (name === fail) throw new Error(`fake failure for ${name}`);
      const directory = path.join(root, 'node_modules', ...name.split('/'));
      if (args[0] === 'add') {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
      } else fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function load(calls: string[][], fail?: string) {
  const onboarding = await import('../src/commands/setup-onboarding.js');
  const output: string[] = [];
  onboarding.setupOnboardingDeps.io = { log: m => output.push(m), error: m => output.push(`ERR ${m}`), write: c => output.push(c) };
  onboarding.setupOnboardingDeps.createService = root => new OnboardingService({
    projectRoot: root, hasOwner: () => false,
    installer: new PluginManagementWorkflow(root, { installDependencies: fakePackageManager(calls, fail) }),
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { setupCommand } = await import('../src/commands/setup.js');
  return { setupCommand, output };
}

const readState = () => JSON.parse(fs.readFileSync(path.join(tmp, '.zhin/onboarding.json'), 'utf8'));

describe('zhin setup (non-interactive)', () => {
  it('-y --adapter sandbox --skip-ai writes config, marks steps and asks nothing', async () => {
    const calls: string[][] = [];
    const { setupCommand } = await load(calls);
    const inquirer = (await import('inquirer')).default;
    const prompt = vi.spyOn(inquirer, 'prompt');
    await setupCommand.parseAsync(['node', 'zhin', '-y', '--adapter', 'sandbox', '--skip-ai']);
    expect(prompt).not.toHaveBeenCalled();
    const config = yaml.parse(fs.readFileSync(path.join(tmp, 'zhin.config.yml'), 'utf8'));
    expect(config.plugins.sandbox).toBe('@zhin.js/adapter-sandbox');
    expect(readState().steps).toEqual({ database: 'pending', owner: 'pending', ai: 'skipped', adapters: 'done' });
    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'SOUL.md'))).toBe(false);
  });

  it('--enable-ai --skip-adapters --install installs allowlisted AI packages through the service', async () => {
    const calls: string[][] = [];
    const { setupCommand, output } = await load(calls);
    await setupCommand.parseAsync(['node', 'zhin', '-y', '--enable-ai', '--skip-adapters', '--install']);
    expect(readState().steps).toMatchObject({ ai: 'done', adapters: 'skipped' });
    const installed = calls.map(call => call.at(-1)!.replace(/(?<=.)@.*$/u, ''));
    expect(installed).toEqual(expect.arrayContaining(['@zhin.js/agent', 'zod', 'ai', '@zhin.js/tool', '@zhin.js/prompt-section']));
    expect(calls.every(call => /^(?:@[^/]+\/)?[a-z0-9.-]+(?:@\^[\d.]+)?$/u.test(call.at(-1)!))).toBe(true);
    expect(calls.every(call => call[0] === 'add')).toBe(true);
    expect(output.some(line => line.startsWith('✓ @zhin.js/agent'))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a failed install with its rollback and sets a failing exit code', async () => {
    const calls: string[][] = [];
    const { setupCommand, output } = await load(calls, 'ai');
    await setupCommand.parseAsync(['node', 'zhin', '-y', '--enable-ai', '--install']);
    expect(process.exitCode).toBe(1);
    expect(output.some(line => line.includes('✗ ai'))).toBe(true);
    expect(calls.filter(call => call[0] === 'remove').length).toBeGreaterThan(0);
    expect(output.some(line => line.startsWith('已回滚'))).toBe(true);
  });

  it('refuses contradictory flags', async () => {
    const { setupCommand } = await load([]);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(setupCommand.parseAsync(['node', 'zhin', '--adapter', 'sandbox', '--skip-adapters'])).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
