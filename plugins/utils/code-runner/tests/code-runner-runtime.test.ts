import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import runCommand from '../commands/run/[language:string].ts';
import { formatResult } from '../src/run-code.js';

describe('@zhin.js/plugin-code-runner', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('code-runner');
  });

  it('brands run command', () => {
    expect(parseCommandDefinition(runCommand)).toBe(runCommand);
  });

  it('formats empty run result', () => {
    expect(formatResult({ stdout: '', stderr: '', error: '' })).toBe('（无输出）');
  });

  it('rejects unsupported language without network', async () => {
    const result = await runCommand.execute({
      owner: {} as never,
      generation: 0,
      config: {},
      use: () => {
        throw new Error('unused');
      },
      params: { language: 'brainfuck' },
      args: ['++'],
      input: undefined,
    });
    expect(String(result)).toContain('不支持的语言');
  });
});
