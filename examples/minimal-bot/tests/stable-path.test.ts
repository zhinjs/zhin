import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  AdapterIndex,
  adapterFeatureId,
  bindEndpoint,
  isAdapterIndex,
  materializeEndpoint,
  type AdapterContext,
  type Endpoint,
  type EndpointEventGateway,
} from 'zhin.js/adapter';
import { ImRuntime } from 'zhin.js/core/runtime';
import { capabilityId, rootPluginId } from 'zhin.js';
import {
  NativeDevelopmentModuleRuntime,
  RootRuntime,
  supportsNativeTypeScript,
} from '@zhin.js/runtime';
import { MigrationReadiness, runStartCommand } from '@zhin.js/cli';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTerminalEndpoint,
  type TerminalClient,
  type TerminalEndpointOptions,
} from '../adapters/terminal/index.js';

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
  it('loads the terminal source using native Node without the Vitest transformer', () => {
    expect(() => execFileSync(process.execPath, [
      '--experimental-strip-types', '--input-type=module', '-e',
      "await import('./adapters/terminal/index.ts?zhin-generation=0')",
    ], { cwd: botRoot, env: { ...process.env, NODE_OPTIONS: '' }, stdio: 'pipe' })).not.toThrow();
  });

  it('forwards terminal Ctrl+C to process shutdown and restores cooked input', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const emit = vi.spyOn(process, 'emit').mockReturnValue(true);
    const endpoint = createBoundTerminalEndpoint({
      input, output, error: output, interactive: true, prompt: 'zhin> ',
    });
    try {
      await endpoint.start(new AbortController().signal);
      endpoint.open();
      input.write('\x03');
      expect(emit).toHaveBeenCalledWith('SIGINT');
    } finally {
      await endpoint.stop();
    }
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(input.isPaused()).toBe(true);
  });

  it('uses a static manifest and convention directories without legacy registration', () => {
    expect(packageJson.zhin.entry).toBe('./plugin.ts');
    // AI remains opt-in; the example mounts Tool explicitly for tools/echo/index.ts.
    expect(packageJson.zhin.features).toEqual([
      { package: '@zhin.js/tool', api: '^1.0.0' },
    ]);
    expect(packageJson.zhin.plugins).toEqual([]);
    expect(packageJson.dependencies).toHaveProperty('zhin.js');
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/command');
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/adapter-sandbox');
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/host-api');
    expect(packageJson.dependencies).not.toHaveProperty('@zhin.js/host-router');

    expect(configText).toMatch(/plugin:\s*\n/);
    expect(configText).toMatch(/interactive:\s*true/);
    expect(configText).toMatch(/plugins:\s*\{\}/);
    expect(fs.existsSync(path.join(botRoot, 'src', 'plugins'))).toBe(false);

    for (const source of ['commands/hello/index.ts', 'commands/card/index.ts']) {
      expect(fs.readFileSync(path.join(botRoot, source), 'utf8')).toContain('defineCommand');
    }
    expect(fs.readFileSync(path.join(botRoot, 'components/status-card/index.ts'), 'utf8'))
      .toContain('defineComponent');
    expect(fs.readFileSync(path.join(botRoot, 'adapters/terminal/index.ts'), 'utf8'))
      .toContain('defineAdapter');
    expect(fs.readFileSync(path.join(botRoot, 'tools/echo/index.ts'), 'utf8'))
      .toContain('defineAgentTool');
  });

  it.skipIf(!supportsNativeTypeScript())(
    'runs Adapter -> ImRuntime -> Command/Component -> Endpoint in one snapshot',
    async () => {
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
    im.attach(runtime.snapshots);

    try {
      const snapshot = await runtime.start();
      const adapters = snapshot.projections.get(adapterFeatureId);
      expect(isAdapterIndex(adapters)).toBe(true);
      const terminal = (adapters as AdapterIndex).list()[0];
      expect(terminal?.name).toBe('terminal');

      const conversationOf = (id: string) => ({
        endpoint: { id: String(terminal!.id), adapter: String(terminal!.id).split('\0')[0]! },
        kind: 'private' as const,
        id,
      });
      const endpoint = (adapters as AdapterIndex).connection('terminal', 'terminal')!;
      const receive = (content: string) => im.endpointEvents.receive(Object.freeze({
        name: 'message.receive',
        payload: Object.freeze({ conversation: conversationOf('terminal'), content }),
        endpoint: endpoint.identity,
        client: endpoint.client,
      }));
      const hello = await receive('/hello');
      expect(hello).toMatchObject({ matched: true, command: 'hello' });
      expect(writes.join('')).toContain('Hello from minimal-bot.');

      const card = await receive('/card');
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
    const endpoint = createBoundTerminalEndpoint({
      input,
      output,
      error: output,
      interactive: true,
      prompt: 'zhin> ',
    }, receive);

    await endpoint.start(new AbortController().signal);
    endpoint.open();
    await vi.waitFor(() => expect(writes.join('')).toContain('zhin> '));
    input.write('/hello\n');
    await vi.waitFor(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      name: 'message.receive',
      payload: expect.objectContaining({
        content: '/hello',
        sender: expect.objectContaining({ id: 'local-user' }),
      }),
    })));
    await vi.waitFor(() => {
      expect(writes.join('').match(/zhin> /gu)).toHaveLength(2);
    });
    await endpoint.stop();
  });

  it('hands the current process stream to the next Adapter generation', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    Object.defineProperty(input, 'isTTY', { value: true });
    Object.defineProperty(output, 'isTTY', { value: true });
    const previousReceive = vi.fn(async () => Object.freeze({ matched: true }));
    const nextReceive = vi.fn(async () => Object.freeze({ matched: true }));
    const createEndpoint = (receive: EndpointEventGateway['receive']) => createBoundTerminalEndpoint({
      input,
      output,
      error: output,
      interactive: true,
      prompt: 'zhin> ',
    }, receive);
    const previous = createEndpoint(previousReceive);
    const next = createEndpoint(nextReceive);

    await previous.start(new AbortController().signal);
    previous.open();
    previous.close();
    await next.start(new AbortController().signal);
    next.open();
    await previous.stop();
    input.write('/hello\n');

    await vi.waitFor(() => expect(nextReceive.mock.calls.filter(
      ([event]) => event.name === 'message.receive',
    )).toHaveLength(1));
    expect(previousReceive).not.toHaveBeenCalled();
    await next.stop();
  });

  it('reopens the previous terminal Endpoint when a generation rolls back', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    Object.defineProperty(input, 'isTTY', { value: true });
    Object.defineProperty(output, 'isTTY', { value: true });
    const receive = vi.fn(async () => Object.freeze({ matched: true }));
    const previous = createBoundTerminalEndpoint({
      input,
      output,
      error: output,
      interactive: true,
      prompt: 'zhin> ',
    }, receive);

    await previous.start(new AbortController().signal);
    previous.open();
    previous.close();
    previous.open();
    input.write('/hello\n');

    await vi.waitFor(() => expect(receive.mock.calls.filter(
      ([event]) => event.name === 'message.receive',
    )).toHaveLength(1));
    await previous.stop();
  });

  it.skipIf(!supportsNativeTypeScript())(
    'starts through the CLI composition root and is migration-ready',
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
      plugins: 1,
      capabilities: 5,
      // adapter + command + component + middleware + handler + schedule + tool（platformFeatures 继承）
      projections: 7,
    });
    expect((await new MigrationReadiness().inspect(botRoot)).state).toBe('ready');
  });
});

function createBoundTerminalEndpoint(
  options: TerminalEndpointOptions,
  receive: EndpointEventGateway['receive'] = async () => undefined,
): Endpoint<TerminalClient> {
  const context = {
    id: capabilityId(rootPluginId(), adapterFeatureId, 'terminal'),
    endpointId: 'terminal',
    name: 'terminal',
    use: () => Object.freeze({ receive }),
  } as unknown as AdapterContext;
  const endpoint = materializeEndpoint(createTerminalEndpoint(options), context);
  bindEndpoint(endpoint, context);
  return endpoint;
}
