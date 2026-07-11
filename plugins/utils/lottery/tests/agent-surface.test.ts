import { describe, it, expect } from 'vitest';
import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { namespaceAuthoringName } from '@zhin.js/agent';

describe('lottery agent/ surface', () => {
  it('namespaces tool slots with plugin prefix', () => {
    expect(namespaceAuthoringName('lottery', 'sync')).toBe('lottery_sync');
    expect(namespaceAuthoringName('lottery', 'compute_recommend')).toBe('lottery_compute_recommend');
  });

  it('defineTool accepts zod schema', () => {
    const tool = defineTool({
      description: 'sync',
      inputSchema: z.object({ game: z.string().optional() }),
      async execute() { return 'ok'; },
    });
    expect(tool.description).toBe('sync');
  });
});
