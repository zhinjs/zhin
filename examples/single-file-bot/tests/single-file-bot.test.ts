import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStartCommand } from 'zhin.js/instance';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commandFeatureId,
  isCommandIndex,
  type CommandDefinition,
  type CommandIndex,
} from 'zhin.js/command';
import { ImRuntime } from 'zhin.js/core/runtime';
import {
  NativeDevelopmentModuleRuntime,
  RootRuntime,
  supportsNativeTypeScript,
} from 'zhin.js/runtime';
import botPlugin from '../bot.js';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => {
  fs.rmSync(path.join(botRoot, '.zhin'), { recursive: true, force: true });
});

describe('single-file-bot runtime contract', () => {
  it('registers hello and status commands via definePlugin setup({ addCommand })', async () => {
    expect(botPlugin.name).toBe('single-file-bot');
    const commands = new Map<string, CommandDefinition>();
    await botPlugin.setup?.({
      addCommand: (name: string, definition: unknown) => {
        commands.set(name, definition as CommandDefinition);
      },
    } as Parameters<NonNullable<typeof botPlugin.setup>>[0]);

    expect([...commands.keys()]).toEqual(['hello', 'status']);
    const hello = commands.get('hello')!;
    expect(hello.description).toBe('打招呼');
    const helloReply = await hello.execute({} as Parameters<CommandDefinition['execute']>[0]);
    expect(helloReply).toBe('Hello from single-file-bot! 👋 (试试发送 /status 查看运行状态)');

    const status = commands.get('status')!;
    expect(status.description).toBe('查看运行状态');
    const statusReply = await status.execute({} as Parameters<CommandDefinition['execute']>[0]);
    expect(String(statusReply)).toMatch(
      /^single-file-bot 运行中 \| RSS \d+MB \| Uptime \d+s$/,
    );
  });

  it.skipIf(!supportsNativeTypeScript())(
    'starts RootRuntime + ImRuntime on bot.ts and projects hello and status into CommandIndex',
    async () => {
      const im = new ImRuntime();
      const runtime = new RootRuntime({
        projectRoot: botRoot,
        modules: new NativeDevelopmentModuleRuntime({ projectRoot: botRoot, watch: false }),
        environment: { name: 'test', mode: 'test', platform: 'node' },
        config: { configVersion: 2, plugins: {} },
        installResources: ({ resources }) => im.install(resources),
      });
      im.attach(runtime.snapshots);

      try {
        const snapshot = await runtime.start();
        expect(snapshot.generation).toBe(1);
        const commands = snapshot.projections.get(commandFeatureId);
        expect(isCommandIndex(commands)).toBe(true);
        const commandNames = (commands as CommandIndex).list().map((entry) => entry.name);
        expect(commandNames).toContain('hello');
        expect(commandNames).toContain('status');

        const helloResult = await (commands as CommandIndex).execute('hello');
        expect(helloResult).toBe(
          'Hello from single-file-bot! 👋 (试试发送 /status 查看运行状态)',
        );

        const statusResult = await (commands as CommandIndex).execute('status');
        expect(String(statusResult)).toMatch(
          /^single-file-bot 运行中 \| RSS \d+MB \| Uptime \d+s$/,
        );
      } finally {
        await runtime.stop();
      }
    },
  );

  it.skipIf(!supportsNativeTypeScript())(
    'starts through the CLI composition root (--once)',
    async () => {
      const output: string[] = [];
      const errors: string[] = [];
      await runStartCommand({
        root: botRoot,
        args: ['--once', '--no-watch', '--mode=test'],
        // In-process Node HTTP server: no gateway in this test (ADR 0054 §3).
        standaloneHttp: true,
        writeOutput: (value) => output.push(value),
        writeError: (value) => errors.push(value),
      });

      expect(errors).toEqual([]);
      expect(JSON.parse(output.join(''))).toMatchObject({
        started: true,
        generation: 1,
      });
    },
  );
});
