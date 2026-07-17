import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { AdapterIndex, adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { ImRuntime, type MessageGateway } from '@zhin.js/core/runtime';
import { capabilityId, rootPluginId } from '@zhin.js/plugin-runtime';
import { NativeDevelopmentModuleRuntime, RootRuntime } from '@zhin.js/runtime';
import { MigrationReadiness, runStartCommand } from '@zhin.js/cli';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalEndpoint } from '../adapters/terminal.js';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  zhin: {
    entry: string;
    features: Array<{ package: string }>;
    plugins: unknown[];
  };
};
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('minimal-bot Stable Plugin Runtime contract', () => {
  it('uses a static manifest and convention directories without legacy registration', () => {
    expect(packageJson.zhin.entry).toBe('./plugin.ts');
    expect(packageJson.zhin.features.map((feature) => feature.package)).toEqual([
      '@zhin.js/adapter',
      '@zhin.js/command',
      '@zhin.js/component',
    ]);
    expect(packageJson.zhin.plugins).toEqual([]);
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/adapter-sandbox');
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/host-api');
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/host-router');

    expect(configText).toMatch(/plugin:\s*\n/);
    expect(configText).toMatch(/interactive:\s*true/);
    expect(configText).toMatch(/plugins:\s*\{\}/);
    expect(fs.existsSync(path.join(botRoot, 'src', 'plugins'))).toBe(false);

    for (const source of ['commands/hello.ts', 'commands/card.ts']) {
      expect(fs.readFileSync(path.join(botRoot, source), 'utf8')).toContain('defineCommand');
    }
    expect(fs.readFileSync(path.join(botRoot, 'components/status-card.ts'), 'utf8'))
      .toContain('defineComponent');
    expect(fs.readFileSync(path.join(botRoot, 'adapters/terminal.ts'), 'utf8'))
      .toContain('defineAdapter');
    expect(fs.readFileSync(path.join(botRoot, 'tools/echo.ts'), 'utf8'))
      .toContain('defineAgentTool');
  });

  it('runs Adapter -> ImRuntime -> Command/Component -> Endpoint in one snapshot', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const im = new ImRuntime();
    const runtime = new RootRuntime({
      projectRoot: botRoot,
      modules: new NativeDevelopmentModuleRuntime({ projectRoot: botRoot, watch: false }),
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: { plugin: { terminal: { interactive: false } } },
      installResources: ({ resources }) => im.install(resources),
    });
    im.attach(runtime.controller.snapshots);

    try {
      const snapshot = await runtime.start();
      const adapters = snapshot.projections.get(adapterFeatureId);
      expect(isAdapterIndex(adapters)).toBe(true);
      const terminal = (adapters as AdapterIndex).list()[0];
      expect(terminal?.name).toBe('terminal');

      const hello = await im.receive({
        adapter: terminal!.id,
        target: 'terminal',
        content: '/hello',
      });
      expect(hello).toMatchObject({ matched: true, command: 'hello' });
      expect(writes.join('')).toContain('Hello from minimal-bot.');

      const card = await im.receive({
        adapter: terminal!.id,
        target: 'terminal',
        content: '/card',
      });
      expect(card).toMatchObject({ matched: true, command: 'card' });
      expect(writes.join('')).toContain('minimal-bot');
      expect(writes.join('')).toContain('RSS');
    } finally {
      await runtime.stop();
    }
  });

  it('accepts messages from the current process stream and restores the prompt', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const writes: string[] = [];
    output.on('data', (chunk: Buffer) => writes.push(chunk.toString()));
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const gateway: MessageGateway = {
      receive,
      send: vi.fn(),
    };
    const endpoint = new TerminalEndpoint({
      id: capabilityId(rootPluginId(), adapterFeatureId, 'terminal'),
      gateway,
      input,
      output,
      error: output,
      interactive: true,
      prompt: 'zhin> ',
    });

    endpoint.start();
    endpoint.open();
    await vi.waitFor(() => expect(writes.join('')).toContain('zhin> '));
    input.write('/hello\n');
    await vi.waitFor(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      content: '/hello',
      sender: 'local-user',
    })));
    await vi.waitFor(() => {
      expect(writes.join('').match(/zhin> /gu)).toHaveLength(2);
    });
    endpoint.stop();
  });

  it('starts through the CLI composition root and is migration-ready', async () => {
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
      plugins: 1,
      capabilities: 4,
      projections: 3,
    });
    expect((await new MigrationReadiness().inspect(botRoot)).state).toBe('ready');
  });
});
