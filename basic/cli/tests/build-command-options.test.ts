import { describe, expect, it } from 'vitest';
import { buildCommand } from '../src/commands/build.js';
import { installCommand } from '../src/commands/install.js';
import { uninstallCommand } from '../src/commands/uninstall.js';

describe('CLI option surface', () => {
  it('build: production defaults to true and can be turned off; --analyze is gone', () => {
    const flags = buildCommand.options.map((option) => option.long);
    expect(flags).toContain('--production');
    expect(flags).toContain('--no-production');
    expect(flags).not.toContain('--analyze');
    expect(buildCommand.opts().production).toBe(true);
    expect(buildCommand.parseOptions(['--no-production']).unknown).toEqual([]);
    expect(buildCommand.opts().production).toBe(false);
    buildCommand.setOptionValue('production', true);
  });

  it('install: no `add` alias (`zhin add` generates convention files and forwards anything else), and the unread -S/--save flag is gone', () => {
    expect(installCommand.aliases()).toEqual([]);
    expect(installCommand.options.map((option) => option.long)).not.toContain('--save');
  });

  it('uninstall: only plugin and adapter; services are removed with `zhin service uninstall`', () => {
    expect(uninstallCommand.commands.map((command) => command.name())).toEqual(['plugin', 'adapter']);
  });
});
