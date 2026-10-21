import { describe, expect, it } from 'vitest';
import {
  formatStartOptionHelp,
  parseStartOptions,
  START_OPTION_HELP,
} from '../../../src/plugin-runtime/start/options.js';

describe('start options', () => {
  it('parses process, runtime, and Remote Console options into one immutable value', () => {
    const options = parseStartOptions([
      '--open', '--once', '--no-watch', '--environment=test', '--mode', 'test',
      '--daemon', '--log-file=.zhin/test.log',
    ]);

    expect(options).toEqual({
      open: true,
      once: true,
      noWatch: true,
      environment: 'test',
      mode: 'test',
      daemon: true,
      logFile: '.zhin/test.log',
    });
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('rejects unknown options and invalid environment or runtime mode values', () => {
    expect(() => parseStartOptions(['--unknown'])).toThrow('Unknown start option');
    expect(() => parseStartOptions(['--environment', '../production'])).toThrow('Invalid environment name');
    expect(() => parseStartOptions(['--mode', 'staging'])).toThrow('Invalid Runtime mode');
  });

  it('uses the runtime mode as the default environment while preserving explicit overlays', () => {
    expect(parseStartOptions(['--mode', 'production']).environment).toBe('production');
    expect(parseStartOptions(['--mode', 'production', '--environment', 'staging']).environment).toBe('staging');
  });

  it('documents only options the parser accepts', () => {
    const sampleValues: Record<string, string> = {
      '<mode>': 'production',
      '<name>': 'staging',
      '<path>': '.zhin/runtime.log',
    };
    for (const option of START_OPTION_HELP) {
      const longFlag = option.flags.split(', ').at(-1)!;
      const [flag, placeholder] = longFlag.split(' ');
      const argumentsForFlag = placeholder ? [flag!, sampleValues[placeholder]!] : [flag!];

      expect(() => parseStartOptions(argumentsForFlag), option.flags).not.toThrow();
    }
  });

  it('lists every parsed option in the help text', () => {
    const help = formatStartOptionHelp();
    const parsedFlags = ['--mode', '--environment', '--no-watch', '--once', '--open', '--daemon', '-d', '--log-file'];

    for (const flag of parsedFlags) {
      expect(help).toContain(flag);
    }
    expect(help).toContain('Start options:');
  });
});
