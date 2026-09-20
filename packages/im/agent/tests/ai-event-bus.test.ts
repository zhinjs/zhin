import { describe, it, expect } from 'vitest';
import {
  createAIHookBusPayload,
  isAISessionCompactPayload,
  isAISessionNewPayload,
} from '../src/ai-event-bus.js';
import { createAIHookEvent } from '../src/resource-hub/index.js';
import { mockCommMessage } from './helpers/mock-comm-message.js';

describe('ai-event-bus helpers', () => {
  it('builds hook payload with fallback session id', () => {
    const payload = createAIHookBusPayload(
      createAIHookEvent('tool', 'call', undefined, {
        commMessage: mockCommMessage({
          adapter: 'mock',
          endpoint: 'bot1',
          scope: 'private',
          senderId: 'user1',
          sceneId: 'scene1',
        }),
        toolName: 'read_file',
        args: { filePath: 'README.md' },
      }),
      'orchestrator-hook',
      'agent-1',
    );

    expect(payload.sessionId).toBe('mock:bot1:private:user1');
    expect(payload.toolName).toBe('read_file');
    expect(payload.agentId).toBe('agent-1');
  });

  it('detects stable session payloads', () => {
    expect(isAISessionNewPayload({
      sessionId: 's1',
      source: 'zhin-agent',
      reason: 'first_message',
    })).toBe(true);

    expect(isAISessionCompactPayload({
      sessionId: 's1',
      source: 'zhin-agent',
      compactedCount: 1,
      savedTokens: 20,
      totalTokensBefore: 100,
      totalTokensAfter: 80,
    })).toBe(true);
  });

});
