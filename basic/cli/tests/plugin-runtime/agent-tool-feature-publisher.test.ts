import { describe, expect, it, vi } from 'vitest';
import type { AIService } from '@zhin.js/agent';
import { publishAgentToolFeatures } from '../../src/plugin-runtime/agent-tool-feature-publisher.js';

describe('Agent Tool feature publisher', () => {
  it('projects Host, runtime, and native tools through one generation callback', () => {
    const names: string[] = [];
    const service = {
      getProvider: vi.fn(),
      getImageGenerationDefaults: vi.fn(() => ({})),
    } as unknown as AIService;

    publishAgentToolFeatures({
      addFeature: (_feature, name) => { names.push(name); },
      projectRoot: process.cwd(),
      service,
      mcpServers: [],
      hostTools: [{
        name: 'voice_stt',
        description: 'Transcribe one voice message.',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'text',
      }],
      runtimeTools: [{ name: 'schedule_list', definition: Object.freeze({}) }],
    });

    expect(names).toContain('voice_stt');
    expect(names).toContain('schedule_list');
    expect(names).toContain('bash');
    expect(names).toContain('read_file');
    expect(names).toContain('web_search');
    expect(names).toContain('generate_image');
    expect(names).toContain('todo_read');
    expect(names).toContain('ask_user');
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects a Host tool without a useful description', () => {
    expect(() => publishAgentToolFeatures({
      addFeature: () => undefined,
      projectRoot: process.cwd(),
      service: {} as AIService,
      mcpServers: [],
      hostTools: [{
        name: 'invalid',
        description: '   ',
        parameters: { type: 'object' },
        execute: async () => undefined,
      }],
      runtimeTools: [],
    })).toThrow('description cannot be empty');
  });
});
