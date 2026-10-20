import type { AgentTool } from '@zhin.js/ai';
import { ExecutableToolRegistry } from '../../src/tool/executable-tool-registry.js';

function tool(name: string): AgentTool {
  return { name, description: name, parameters: { type: 'object', properties: {} }, execute: () => name };
}

describe('ExecutableToolRegistry', () => {
  it('replaces the complete turn-owned tool snapshot', () => {
    const registry = new ExecutableToolRegistry([tool('first')]);
    registry.replace([tool('second')]);

    expect(registry.resolve('first')).toBeUndefined();
    expect(registry.list().map((entry) => entry.name)).toEqual(['second']);
  });

  it('merges deferred tools without replacing an existing authority', () => {
    const original = tool('shared');
    const registry = new ExecutableToolRegistry([original]);
    registry.addMissing([tool('shared'), tool('deferred')]);

    expect(registry.resolve('shared')).toBe(original);
    expect(registry.list().map((entry) => entry.name)).toEqual(['shared', 'deferred']);
  });
});
