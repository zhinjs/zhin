import { describe, expect, it } from 'vitest';
import { runStartCommand } from '@zhin.js/cli';
import { supportsNativeTypeScript } from '@zhin.js/runtime';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const botRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('capabilities-bot 契约', () => {
  it.skipIf(!supportsNativeTypeScript())(
    '一个插件 + 一个 zhin.config.yml 即可启动，且 setup 各能力面生效',
    async () => {
      const output: string[] = [];
      const errors: string[] = [];
      await runStartCommand({
        root: botRoot,
        args: ['--once', '--no-watch', '--mode=test'],
        writeOutput: (value) => output.push(value),
        writeError: (value) => errors.push(value),
      });

      expect(errors).toEqual([]);
      expect(JSON.parse(output.join(''))).toMatchObject({
        started: true,
        generation: 1,
        plugins: 2,
      });
    },
    60_000,
  );
});
