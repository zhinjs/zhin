import { describe, it, expect, beforeEach } from 'vitest';
import { PromptSectionLoader } from '../../src/prompt/prompt-section-loader.js';
import { PromptAssemblyRegistry } from '../../src/prompt/prompt-assembly-registry.js';
import { defineAgentPromptSection } from '../../src/prompt/define-agent-prompt-section.js';

describe('defineAgentPromptSection', () => {
  it('should default layer to "plugin"', () => {
    const section = defineAgentPromptSection({
      id: 'test',
      title: 'Test',
      content: 'test content',
    });

    expect(section.layer).toBe('plugin');
  });

  it('should allow overriding layer', () => {
    const section = defineAgentPromptSection({
      id: 'test',
      title: 'Test',
      content: 'test content',
      layer: 'context',
    });

    expect(section.layer).toBe('context');
  });

  it('should preserve all fields', () => {
    const section = defineAgentPromptSection({
      id: 'my-plugin:ctx',
      title: 'My Context',
      content: 'hello',
      priority: 75,
      truncatable: true,
      maxChars: 500,
      metadata: { source: 'test' },
    });

    expect(section).toEqual(expect.objectContaining({
      id: 'my-plugin:ctx',
      title: 'My Context',
      content: 'hello',
      priority: 75,
      truncatable: true,
      maxChars: 500,
      metadata: { source: 'test' },
      layer: 'plugin',
    }));
  });
});

describe('PromptSectionLoader', () => {
  let loader: PromptSectionLoader;
  let registry: PromptAssemblyRegistry;

  beforeEach(() => {
    loader = new PromptSectionLoader();
    registry = new PromptAssemblyRegistry();
  });

  it('should register sections to registry', async () => {
    const section = defineAgentPromptSection({
      id: 'test',
      title: 'Test',
      content: 'test',
      priority: 50,
    });

    await loader.registerToRegistry([section], registry);

    const entries = registry.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('test');
  });

  it('should sort by priority when listing', async () => {
    const low = defineAgentPromptSection({
      id: 'low',
      title: 'Low',
      content: 'low',
      priority: 10,
    });

    const high = defineAgentPromptSection({
      id: 'high',
      title: 'High',
      content: 'high',
      priority: 100,
    });

    await loader.registerToRegistry([low, high], registry);

    const list = registry.entries();
    expect(list[0].id).toBe('high');
    expect(list[1].id).toBe('low');
  });

  it('should apply default priority 50 when not specified', async () => {
    const section = defineAgentPromptSection({
      id: 'default-priority',
      title: 'Default',
      content: 'content',
    });

    await loader.registerToRegistry([section], registry);
    const entries = registry.entries();
    expect(entries[0].priority).toBe(50);
  });

  it('should apply default truncatable true when not specified', async () => {
    const section = defineAgentPromptSection({
      id: 'truncatable',
      title: 'T',
      content: 'c',
    });

    await loader.registerToRegistry([section], registry);
    const entries = registry.entries();
    expect(entries[0].truncatable).toBe(true);
  });

  it('should return empty array for non-existent directory', async () => {
    const sections = await loader.loadFromDir('/tmp/non-existent-dir-zhin-test-12345');
    expect(sections).toHaveLength(0);
  });
});

describe('PromptAssemblyRegistry.onRegister', () => {
  it('should call callback when a section is registered', () => {
    const registry = new PromptAssemblyRegistry();
    const calls: string[] = [];

    registry.onRegister((id) => {
      calls.push(id);
    });

    registry.register('a', {
      layer: 'context',
      title: 'A',
      content: 'content-a',
      priority: 50,
      truncatable: false,
    });

    registry.register('b', {
      layer: 'system',
      title: 'B',
      content: 'content-b',
      priority: 80,
      truncatable: false,
    });

    expect(calls).toEqual(['a', 'b']);
  });

  it('should support unregistering the callback', () => {
    const registry = new PromptAssemblyRegistry();
    const calls: string[] = [];

    const unregister = registry.onRegister((id) => {
      calls.push(id);
    });

    registry.register('x', {
      layer: 'context',
      title: 'X',
      content: 'x',
      priority: 50,
      truncatable: false,
    });

    unregister();

    registry.register('y', {
      layer: 'context',
      title: 'Y',
      content: 'y',
      priority: 50,
      truncatable: false,
    });

    expect(calls).toEqual(['x']);
  });
});
