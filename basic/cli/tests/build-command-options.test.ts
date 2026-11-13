import { describe, expect, it, vi } from 'vitest';
import { buildCommand } from '../src/commands/build.js';
import { addAliasCommand, installCommand } from '../src/commands/install.js';
import { uninstallCommand } from '../src/commands/uninstall.js';
import { disableCommand, enableCommand } from '../src/commands/enable.js';

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

  it('install: no `add` alias, and the unread -S/--save flag is gone', () => {
    expect(installCommand.aliases()).toEqual([]);
    expect(installCommand.options.map((option) => option.long)).not.toContain('--save');
  });

  it('`zhin add <package>` is the hidden old spelling of install: it forwards the original arguments', async () => {
    const install = vi.spyOn(installCommand, 'parseAsync').mockResolvedValue(installCommand);
    try {
      await addAliasCommand.parseAsync(['@zhin.js/adapter-qq', '-D'], { from: 'user' });
      expect(install).toHaveBeenCalledWith(['@zhin.js/adapter-qq', '-D'], { from: 'user' });
    } finally {
      install.mockRestore();
    }
  });

  it('uninstall: only plugin and adapter; services are removed with `zhin service uninstall`', () => {
    expect(uninstallCommand.commands.map((command) => command.name())).toEqual(['plugin', 'adapter']);
  });

  it('enable / disable: one required <plugin> argument, no options, help explains the gateway and offline paths', () => {
    for (const [command, name] of [[enableCommand, 'enable'], [disableCommand, 'disable']] as const) {
      expect(command.name()).toBe(name);
      expect(command.aliases()).toEqual([]);
      expect(command.options).toEqual([]);
      expect(command.registeredArguments.map((argument) => [argument.name(), argument.required])).toEqual([['plugin', true]]);
      let help = '';
      command.configureOutput({ writeOut: (text) => { help += text; } });
      command.outputHelp();
      expect(help).toContain(`Usage: ${name} [options] <plugin>`);
      expect(help).toContain('disable_plugins');
      expect(help).toContain('网关运行中');
      expect(help).toContain(`zhin ${name} sandbox`);
    }
  });
});
