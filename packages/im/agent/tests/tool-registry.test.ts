import { describe, it, expect } from 'vitest';
import { ToolRegistry, defineTool } from '../src/orchestrator/tool-registry.js';

function makeTool(name: string, source?: string, result: string = name) {
  return defineTool({
    name,
    source,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => result,
  });
}

describe('ToolRegistry naming policy', () => {
  it('非保留名冲突时后注册覆盖', async () => {
    const registry = new ToolRegistry();
    registry.addTool(makeTool('weather', undefined, 'a'), undefined, 'plugin:a');
    registry.addTool(makeTool('weather', undefined, 'b'), undefined, 'plugin:b');
    const result = await registry.execute('weather', {});
    expect(result).toBe('b');
  });

  it('保留名冲突时忽略非内置来源', async () => {
    const registry = new ToolRegistry();
    registry.addTool(makeTool('bash'), undefined, 'builtin');
    registry.addTool(makeTool('bash'), undefined, 'plugin:x');
    const tool = registry.get('bash');
    expect(tool?.source).toBe('builtin');
  });

  it('保留名前缀应拒绝普通来源注册', () => {
    const registry = new ToolRegistry();
    registry.addTool(makeTool('internal_secret'), undefined, 'plugin:x');
    expect(registry.get('internal_secret')).toBeUndefined();
  });
});
