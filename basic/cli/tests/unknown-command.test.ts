import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { pluginCommand } from '../src/commands/plugin.js';
import { closestCommand, findUnknownCommand, formatUnknownCommand } from '../src/utils/unknown-command.js';

function program(): Command {
  const root = new Command('zhin').option('--verbose');
  root.addCommand(new Command('status').action(() => undefined));
  root.addCommand(new Command('start').allowUnknownOption(true).allowExcessArguments(true).action(() => undefined));
  root.addCommand(pluginCommand);
  const packages = new Command('packages');
  packages.command('list').action(() => undefined);
  root.addCommand(packages);
  const schedule = new Command('schedule').option('--host <url>');
  schedule.command('list').action(() => undefined);
  root.addCommand(schedule);
  return root;
}

describe('unknown subcommands (#1250 cli-unknown-command-help-exit0)', () => {
  it('reports an unknown root command with --help, and suggests the closest one', () => {
    expect(findUnknownCommand(program(), ['statsu', '--help'])).toMatchObject({ parent: ['zhin'], name: 'statsu', suggestion: 'status' });
    expect(findUnknownCommand(program(), ['--verbose', 'endpoint', '--help'])).toMatchObject({ name: 'endpoint', hint: expect.stringContaining('zhin status') });
  });

  it('reports `zhin plugin list` with the author-toolkit hint and the command that lists installed plugins', () => {
    const unknown = findUnknownCommand(program(), ['plugin', 'list']);
    expect(unknown).toMatchObject({ parent: ['zhin', 'plugin'], name: 'list' });
    const text = formatUnknownCommand(unknown!).join('\n');
    expect(text).toContain("unknown command 'list'");
    expect(text).toContain('插件作者工具');
    expect(text).toContain('zhin packages list');
  });

  it('leaves known paths, help, commands with their own arguments and option values alone', () => {
    for (const args of [['status', '--help'], ['help', 'status'], ['start', 'anything'], ['plugin', 'check', '--help'],
      ['packages', 'list'], ['schedule', '--host', 'http://h', 'list'], ['--help'], []]) {
      expect(findUnknownCommand(program(), args), args.join(' ')).toBeUndefined();
    }
  });

  it('suggests by prefix and edit distance, nothing when far away', () => {
    expect(closestCommand('stat', ['status', 'start', 'stop'])).toBe('status');
    expect(closestCommand('restrat', ['restart', 'status'])).toBe('restart');
    expect(closestCommand('xyzzy', ['restart', 'status'])).toBeUndefined();
  });

  it('the real CLI exits 1 for `zhin endpoint --help` (not the root help with exit 0)', () => {
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--conditions=development', '--import', 'tsx', cli, 'endpoint', '--help'], {
      encoding: 'utf8', timeout: 60_000, cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'endpoint'");
    expect(result.stdout).not.toContain('Usage: zhin');
  }, 60_000);
});
