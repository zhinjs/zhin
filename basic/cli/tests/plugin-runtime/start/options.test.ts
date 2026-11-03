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
      watch: [],
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

  it('only watches explicitly selected sources', () => {
    expect(parseStartOptions([]).watch).toEqual([]);
    expect(parseStartOptions([]).noWatch).toBe(true);
    expect(parseStartOptions(['--watch', 'config']).watch).toEqual(['config']);
    expect(parseStartOptions(['--watch', 'source']).watch).toEqual(['source']);
    const both = parseStartOptions(['--watch', 'source', 'config', 'source', '--mode', 'production']);
    expect(both.watch).toEqual(['source', 'config']);
    expect(both.noWatch).toBe(false);
    expect(both.mode).toBe('production');
    expect(Object.isFrozen(both.watch)).toBe(true);
    expect(parseStartOptions(['--no-watch']).watch).toEqual([]);
  });

  it('rejects empty, unknown and contradictory watch selections', () => {
    for (const args of [['--watch'], ['--watch', '--open'], ['--watch', 'none'],
      ['--watch', 'config', 'other'], ['--watch', 'config', '--no-watch'],
      ['--no-watch', '--watch', 'source']]) {
      expect(() => parseStartOptions(args), args.join(' ')).toThrow(/watch/u);
    }
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
      '<scope...>': 'config',
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
    const parsedFlags = ['--mode', '--environment', '--watch', '--no-watch', '--once', '--open', '--daemon', '-d', '--log-file'];

    for (const flag of parsedFlags) {
      expect(help).toContain(flag);
    }
    expect(help).toContain('Start options:');
  });
});
