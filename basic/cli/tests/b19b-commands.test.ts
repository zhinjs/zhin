// #1250 batch 19b at the command level: `zhin update --dry-run` never reaches the gateway's
// stop / transaction, the `packages install` deprecation goes to stderr only, and
// `zhin packages list --json` prints clean JSON (from a subdirectory too).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  withGateway: vi.fn(),
  viaGateway: vi.fn(),
  direct: vi.fn(),
}));
vi.mock('../src/utils/gateway.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/gateway.js')>(),
  probeGateway: async () => ({
    gateway: { pid: 2 ** 30, mode: 'daemon', version: '1.4.0', args: [], ports: [8086], origins: [], startedAt: Date.now(), socket: 's' },
    instance: { state: 'running', pid: 1, restarts: 0 },
    consoleInitialized: true,
  }),
  withGateway: gateway.withGateway,
  runPackageOperationViaGateway: gateway.viaGateway,
  runPackageOperationDirect: gateway.direct,
}));
const install = vi.hoisted(() => ({ planInstall: vi.fn(async () => ({ plan: 'ok' })) }));
vi.mock('@zhin.js/gateway/plugin-management', async importOriginal => {
  const original = await importOriginal<typeof import('@zhin.js/gateway/plugin-management')>();
  class Workflow { planInstall = install.planInstall; }
  return { ...original, PluginManagementWorkflow: Workflow };
});

let root: string;
let prevCwd: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  prevCwd = process.cwd();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-b19b-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: { 'zhin.js': 'workspace:*', zod: '^3.0.0' } }));
  fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: []\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'zod'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'zod', 'package.json'), JSON.stringify({ name: 'zod', version: '3.1.0' }));
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as never);
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(`${args.join(' ')}\n`); });
});
afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  gateway.withGateway.mockReset();
  gateway.viaGateway.mockReset();
  gateway.direct.mockReset();
});

describe('zhin update --dry-run', () => {
  it('previews without stopping the instance or running a transaction', async () => {
    // Only an exact version request: no registry lookup for a range.
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: { 'zhin.js': 'workspace:*' } }));
    process.chdir(root);
    const { updateCommand } = await import('../src/commands/lifecycle.js');
    await updateCommand.parseAsync(['--dry-run'], { from: 'user' });
    expect(gateway.withGateway).not.toHaveBeenCalled();
    expect(gateway.viaGateway).not.toHaveBeenCalled();
    expect(gateway.direct).not.toHaveBeenCalled();
    const text = stdout.join('');
    expect(text).toContain('不会修改任何文件，也不会停止或重启实例');
    expect(text).toContain('所有依赖都已是范围内的最新版本');
  });
});

describe('zhin packages', () => {
  it('writes the install deprecation notice to stderr only', async () => {
    process.chdir(root);
    const { packagesCommand } = await import('../src/commands/packages.js');
    await packagesCommand.parseAsync(['install', 'zhin.js-plugin-rss', '--dry-run'], { from: 'user' });
    const out = stdout.join('');
    expect(stderr.join('')).toContain('zhin packages install <npm 包> 已弃用');
    expect(out).not.toContain('已弃用');
    expect(out).toContain('dry-run');
  });

  it('prints only JSON for list --json, from a subdirectory as well', async () => {
    const member = path.join(root, 'plugins', 'foo');
    fs.mkdirSync(member, { recursive: true });
    fs.writeFileSync(path.join(member, 'package.json'), JSON.stringify({ name: 'foo', dependencies: { left: '^1.0.0' } }));
    process.chdir(member);
    const { packagesCommand } = await import('../src/commands/packages.js');
    await packagesCommand.parseAsync(['list', '--json'], { from: 'user' });
    const parsed = JSON.parse(stdout.join('')) as { packages: Array<{ name: string; group: string; installedVersion: string | null }>; skillPacks: unknown[] };
    expect(parsed.packages).toEqual([
      { name: 'zhin.js', range: 'workspace:*', dependencyType: 'dependencies', installedVersion: null, group: 'missing' },
      { name: 'zod', range: '^3.0.0', dependencyType: 'dependencies', installedVersion: '3.1.0', group: 'dependency' },
    ]);
    expect(Array.isArray(parsed.skillPacks)).toBe(true);
    expect(stderr.join('')).not.toContain('已弃用');
  });
});
