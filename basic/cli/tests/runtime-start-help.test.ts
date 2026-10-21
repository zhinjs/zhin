import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('zhin runtime start --help', () => {
  it('lists the start options instead of only --help', () => {
    const cliPath = path.resolve(__dirname, '../lib/cli.js');

    const help = execFileSync(process.execPath, [cliPath, 'runtime', 'start', '--help'], {
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(help).toContain('Usage: zhin runtime start [options]');
    expect(help).toContain('Start options:');
    for (const flag of ['--mode <mode>', '--environment <name>', '--no-watch', '--once', '--open', '-d, --daemon', '--log-file <path>']) {
      expect(help).toContain(flag);
    }
  });
});
