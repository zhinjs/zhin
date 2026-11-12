import type { ImRuntime } from '@zhin.js/core/runtime';
import type { AgentRuntime } from '@zhin.js/agent/runtime';
import { DisposeStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { AgentRuntimeFoundation } from '@zhin.js/agent/runtime';
import type { AgentHostAIConfig } from '@zhin.js/agent/runtime';

describe('AgentRuntimeFoundation', () => {
  it.each([
    { providers: {} }, { modelCatalog: {} }, { modelPolicy: {} }, { decisions: {} }, { plan: {} },
    { agents: { helper: { model: 'retired-selector' } } },
    { agents: { helper: { mcpServers: [' '] } } },
  ])('rejects invalid or retired AI configuration before constructing auxiliary runtimes: %j', async config => {
    const inferenceFactory = vi.fn(() => { throw new Error('Invalid startup must not acquire inference'); });
    const acquireDeploymentModels = vi.fn(async () => { throw new Error('Invalid startup must not acquire models'); });
    const lifecycle = new DisposeStack();
    const register = vi.spyOn(lifecycle, 'add');
    const resources = new Scope(rootPluginId());
    const provide = vi.spyOn(resources, 'provide');
    await expect(AgentRuntimeFoundation.create({
      config: config as AgentHostAIConfig,
      modelRuntime: { rootId: '/project', hostOwnerId: 'host', inferenceFactory,
        context: () => { throw new Error('Invalid startup must not construct a caller'); } },
      acquireDeploymentModels,
      im: {} as ImRuntime,
      projectRoot: process.cwd(),
      processRuntime: {} as AgentRuntime,
      resources,
      lifecycle,
    })).rejects.toThrow('Agent Host rejected invalid AI configuration');
    expect(inferenceFactory).not.toHaveBeenCalled();
    expect(acquireDeploymentModels).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(provide).not.toHaveBeenCalled();
  });
});
