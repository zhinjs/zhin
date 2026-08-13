import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { createDeferredTurnController } from '../../src/tool-catalog/deferred-turn-controller.js';

function deferredTool(name: string): AgentTool {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    execute: async () => `${name}-ok`,
  } as AgentTool;
}

describe('DeferredTurnController', () => {
  it('owns load state per turn without a Message identity', async () => {
    const bash = deferredTool('bash');
    const persistedA: string[][] = [];
    const persistedB: string[][] = [];
    const create = (persisted: string[][]) => createDeferredTurnController({
      sessionId: 'same-session',
      platform: 'sandbox',
      catalog: [{
        name: 'bash',
        brief: 'shell',
        fullTool: bash,
        source: 'builtin',
        deferDefault: true,
      }],
      skillRegistry: null,
      snapshot: { loadedTools: {}, loadedSkills: [] },
      maxLoadedPerSession: 12,
      discoverTopK: 5,
      persistSnapshot: async (snapshot) => {
        persisted.push(Object.keys(snapshot.loadedTools));
      },
      skillLoadOpts: {
        skillDirList: () => [],
        skillMaxChars: 4_000,
      },
    });
    const turnA = create(persistedA);
    const turnB = create(persistedB);

    const loadTool = turnA.tools.find(tool => tool.name === 'load_tool');
    expect(loadTool).toBeDefined();
    await loadTool!.execute({ name: 'bash' });

    expect(turnA.loadedToolNames()).toEqual(['bash']);
    expect(turnB.loadedToolNames()).toEqual([]);
    expect(persistedA).toEqual([['bash']]);
    expect(persistedB).toEqual([]);
  });
});
