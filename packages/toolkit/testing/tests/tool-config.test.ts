import { definePlugin } from '@zhin.js/plugin-runtime';
import { defineAgentTool } from '@zhin.js/tool';
import {
  PluginConfigValidationError, createFakeMessage, createFakePlugin, createToolContext, resolvePluginConfig,
  runPluginSetup, runTool, toolOriginFromMessage,
} from '../src/index.js';

const configSchema = {
  toJsonSchema: () => ({
    type: 'object',
    properties: {
      target: { type: 'string' },
      limit: { type: 'integer', minimum: 1, default: 10 },
    },
    required: ['target'],
  }),
};

describe('runPluginSetup config validation', () => {
  let seen: unknown;
  const plugin = definePlugin<{ target: string; limit: number }>({
    name: 'configured',
    config: configSchema,
    setup({ config }) { seen = config.get(); },
  });

  it('applies schema defaults and keeps only declared top-level fields', async () => {
    const fake = await runPluginSetup(plugin, { config: { target: 'g1', stray: true } as never });
    expect(seen).toEqual({ target: 'g1', limit: 10 });
    expect(fake.config).toEqual({ target: 'g1', limit: 10 });
    await fake.dispose();
  });

  it('rejects invalid config with Runtime-style messages', async () => {
    await expect(runPluginSetup(plugin, { config: { limit: 0 } })).rejects.toThrow(PluginConfigValidationError);
    let caught: unknown;
    try { resolvePluginConfig(plugin, { limit: 0 }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PluginConfigValidationError);
    expect((caught as PluginConfigValidationError).issues).toEqual([
        "/ must have required property 'target'",
      '/limit must be >= 1',
    ]);
    expect((caught as Error).message).toContain('Invalid config for plugin configured');
  });

  it('opts out with validateConfig: false', async () => {
    const fake = await runPluginSetup(plugin, { config: { limit: 0 }, validateConfig: false });
    expect(seen).toEqual({ limit: 0 });
    await fake.dispose();
  });

  it('passes config through unchanged when the plugin declares no schema', async () => {
    const bare = definePlugin<{ anything: number }>({ name: 'bare', setup({ config }) { seen = config.get(); } });
    await (await runPluginSetup(bare, { config: { anything: 1 } })).dispose();
    expect(seen).toEqual({ anything: 1 });
    expect(resolvePluginConfig(bare)).toEqual({});
  });
});

describe('runTool', () => {
  const echo = defineAgentTool<{ text: string }, string, { prefix: string }>({
    description: 'Echo text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    execute: (input, context) => `${context.config.prefix}${input.text}@${
      context.origin.kind === 'im' ? `${context.origin.platform}/${context.origin.sceneId}` : context.origin.kind}`
      + ` by ${context.principal.subjectId}`,
  });

  it('runs a tool definition with an IM origin derived from a fake message', async () => {
    const fake = createFakePlugin({ config: { prefix: '> ' } });
    const message = createFakeMessage({ id: 'm1', sender: { id: 'u1', roles: ['admin'] },
      conversation: { endpoint: { id: 'bot', adapter: 'qq' }, kind: 'private', id: 'u1' } });
    expect(await runTool(fake, echo, { text: 'hi' }, { message })).toBe('> hi@qq/u1 by u1');
    expect(toolOriginFromMessage(message)).toEqual({
      kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1', messageId: 'm1',
    });
    expect(await runTool(fake, echo, { text: 'x' })).toBe('> x@test/test-group by test-user');
  });

  it('parses executable input schemas and reports invalid input like the Runtime', async () => {
    const schema = {
      safeParse: (input: unknown) => typeof (input as { n?: unknown }).n === 'number'
        ? { success: true as const, data: { n: (input as { n: number }).n * 2 } }
        : { success: false as const, error: { issues: [{ path: ['n'], message: 'expected number' }] } },
      toJSONSchema: () => ({ type: 'object', properties: { n: { type: 'number' } } }),
    };
    const double = defineAgentTool<{ n: number }, number>({ description: 'Double', inputSchema: schema,
      execute: input => input.n });
    const fake = createFakePlugin();
    expect(await runTool(fake, double, { n: 2 })).toBe(4);
    await expect(runTool(fake, double, { n: 'x' })).rejects.toThrow('Invalid Agent Tool input for tool: n: expected number');
  });

  it('runs a tool registered through addTool() by local name and enforces adapter binding', async () => {
    const qqOnly = defineAgentTool({ description: 'QQ only', adapter: 'qq' as never, execute: (_input, context) => context.$client });
    const plugin = definePlugin({ name: 'tooled', setup(context) {
      (context as unknown as { addTool(name: string, d: unknown): void }).addTool('qq-only', qqOnly);
    } });
    const fake = await runPluginSetup(plugin);
    await expect(runTool(fake, 'missing')).rejects.toThrow('registered: qq-only');
    await expect(runTool(fake, 'qq-only')).rejects.toThrow('requires adapter qq');
    expect(await runTool(fake, 'qq-only', {}, { client: { adapter: 'qq', get: () => 'native' } })).toBe('native');
  });

  it('builds a frozen context with safe default policy', () => {
    const context = createToolContext(createFakePlugin());
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.policy).toEqual({ permissions: [], unattended: false, network: { enabled: false } });
    expect(context.principal).toEqual({ subjectId: 'test-user', roles: [] });
  });
});
