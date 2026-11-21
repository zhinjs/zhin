/**
 * `zhin uninstall plugin --remove-dir` (#1250): deletes the local plugin directory without asking,
 * on a terminal or not; without the flag a non-interactive run keeps it and a terminal is asked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ interactive: false, gateway: false, uninstalled: [] as string[], gatewayOps: [] as string[] }));
vi.mock('../src/utils/interactive.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/interactive.js')>();
  return { ...original, stdinIsInteractive: () => state.interactive };
});
vi.mock('../src/utils/gateway.js', () => ({
  probeGateway: async () => state.gateway,
  runPackageOperationViaGateway: async (_root: unknown, request: { packages: string[] }) => {
    state.gatewayOps.push(...request.packages);
    return { ok: true };
  },
}));
vi.mock('@zhin.js/gateway/plugin-management', () => ({
  PluginManagementWorkflow: class {
    async uninstall(name: string) { state.uninstalled.push(name); }
  },
}));
const prompt = vi.hoisted(() => vi.fn(async () => ({ confirmDelete: false })));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { localPluginDirKeepReason, uninstallCommand } from '../src/commands/uninstall.js';

let tmp: string;
let prevCwd: string;
const pluginDir = () => path.join(tmp, 'plugins', 'demo');

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-uninstall-test-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  fs.mkdirSync(pluginDir(), { recursive: true });
  fs.writeFileSync(path.join(pluginDir(), 'package.json'), '{"name":"demo"}');
  process.chdir(tmp);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  Object.assign(state, { interactive: false, gateway: false, uninstalled: [], gatewayOps: [] });
  prompt.mockClear();
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const run = (...args: string[]) => uninstallCommand.parseAsync(['node', 'uninstall', 'plugin', 'demo', ...args]);

describe('zhin uninstall plugin --remove-dir (#1250)', () => {
  it('without a terminal and without the flag keeps the directory and does not prompt', async () => {
    await run();
    expect(state.uninstalled).toEqual(['demo']);
    expect(fs.existsSync(pluginDir())).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('without a terminal, --remove-dir deletes the directory', async () => {
    await run('--remove-dir');
    expect(state.uninstalled).toEqual(['demo']);
    expect(fs.existsSync(pluginDir())).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('on a terminal, --remove-dir deletes without asking; without it the answer decides', async () => {
    state.interactive = true;
    await run();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(pluginDir())).toBe(true);
    await run('--remove-dir');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(pluginDir())).toBe(false);
  });

  it('through a running gateway, --remove-dir also deletes the directory', async () => {
    state.gateway = true;
    await run('--remove-dir');
    expect(state.gatewayOps).toEqual(['demo']);
    expect(state.uninstalled).toEqual([]);
    expect(fs.existsSync(pluginDir())).toBe(false);
  });
  it('--remove-dir keeps the directory while package.json still depends on its package', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'bot', dependencies: { demo: 'workspace:*' } }));
    await run('--remove-dir');
    expect(state.uninstalled).toEqual(['demo']);
    expect(fs.existsSync(pluginDir())).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('never resolves a directory outside ./plugins', () => {
    fs.mkdirSync(path.join(tmp, 'outside'), { recursive: true });
    expect(localPluginDirKeepReason(tmp, '../outside')).toMatch(/单个目录名/u);
    expect(localPluginDirKeepReason(tmp, 'a/b')).toMatch(/单个目录名/u);
    expect(localPluginDirKeepReason(tmp, '..')).toMatch(/单个目录名/u);
    expect(localPluginDirKeepReason(tmp, '')).toMatch(/单个目录名/u);
    expect(localPluginDirKeepReason(tmp, 'demo')).toBeUndefined();
  });
});

