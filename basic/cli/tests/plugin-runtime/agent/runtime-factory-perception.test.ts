import { AIService, SubagentSystem } from '@zhin.js/agent';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ModelExecutionScope } from '@zhin.js/agent/model-runtime';
import { createRuntimeZhinAgent } from '../../../src/plugin-runtime/agent/runtime-factory.js';

const factory = vi.hoisted(() => ({ create: vi.fn(), perceive: vi.fn() }));
vi.mock('@zhin.js/agent/model-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zhin.js/agent/model-runtime')>()),
  createScopedPerceptionFactory: factory.create,
}));

it('binds child perception through a generation-local factory using the acquired child scope', async () => {
  const port = { perceive: vi.fn() };
  factory.perceive.mockReturnValue(port);
  factory.create.mockReturnValue(factory.perceive);
  const routing = vi.spyOn(SubagentSystem.prototype, 'configureRouting');
  const service = new AIService({ agents: { zhin: {} } });
  const im = { endpoints: { send: vi.fn() } } as unknown as ImRuntime;
  const created = createRuntimeZhinAgent({ service, im, projectRoot: '/synthetic-child-scope' });
  try {
    const child = Object.freeze({
      context: { sessionKey: 'child-session' },
    }) as ModelExecutionScope;
    const callback = routing.mock.calls[0][0].createPerception;
    expect(callback).toBeTypeOf('function');
    expect(callback!(child)).toBe(port);
    expect(factory.create).toHaveBeenCalledOnce();
    expect(factory.perceive).toHaveBeenCalledExactlyOnceWith({
      scope: child,
      sessionKey: 'child-session',
      settings: service.getPerceptionConfig(),
      resilience: service.getAgentConfig()?.providerResilience,
    });
  } finally {
    routing.mockRestore();
    await created.agent.getSubagentSystem()?.dispose();
    await service.dispose();
  }
});
