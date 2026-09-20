import type { ImRuntime } from '@zhin.js/core/runtime';
import type { AgentRuntime } from '@zhin.js/agent/runtime';
import { DisposeStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { AgentRuntimeFoundation } from '../../../src/plugin-runtime/agent/runtime-foundation.js';

describe('AgentRuntimeFoundation', () => {
  it('rejects invalid AI configuration before constructing auxiliary runtimes', async () => {
    await expect(AgentRuntimeFoundation.create({
      config: {},
      im: {} as ImRuntime,
      projectRoot: process.cwd(),
      processRuntime: {} as AgentRuntime,
      resources: new Scope(rootPluginId()),
      lifecycle: new DisposeStack(),
    })).rejects.toThrow('Agent Host rejected invalid AI configuration');
  });
});
