import { describe, it, expect } from 'vitest';
import { validateToolCall, convertLegacyTools } from '@zhin.js/ai';
import { createToolSearchTool } from '../../src/builtin/tool-search-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('tool_search validate in orchestrator path', () => {
  it('accepts query after normalizeTool', () => {
    const commMessage = mockCommMessage({ adapter: 'test', endpoint: 'bot1', sceneId: 'scene1', senderId: 'user1' });
    const [tool] = convertLegacyTools([
      normalizeTool(createToolSearchTool({ getDeferredCatalog: () => [] }), commMessage),
    ]);
    expect(() => validateToolCall([tool], {
      id: 'call-1',
      name: 'tool_search',
      arguments: { query: 'read_current_time' },
    })).not.toThrow();
  });
});
