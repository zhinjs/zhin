import { describe, expect, it } from 'vitest';
import { createUserMessage, EMPTY_TOKEN_USAGE, type AssistantMessage } from '@zhin.js/ai';
import { stampAssistantHeaders, stampUserHeader } from '../../src/session/participant-header-stamp.js';

const reply = (content: AssistantMessage['content'], name?: string): AssistantMessage => ({
  role: 'assistant', content, api: 'a', provider: 'p', model: 'm', usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', timestamp: 1, ...(name ? { name } : {}),
});

describe('participant header stamping (ADR 0041 §4)', () => {
  it('stores the full header of the host-built actor in name', () => {
    const user = { ...createUserMessage('hi', undefined, 1, { subjectId: '10002', displayName: '小明', roles: ['scene_admin'], scope: 'group' }), messageId: 'm1' };
    expect(stampUserHeader(user).name).toMatch(/^\[id:m1;user_id:10002;name:小明;role:admin;time:\d{2}:\d{2}:\d{2}\.\d{3};\]$/u);
    const anonymous = createUserMessage('synthetic');
    expect(stampUserHeader(anonymous)).toBe(anonymous);
  });

  it('stamps only assistant messages with text, from the turn bot facts, never overwriting', () => {
    const bot = { id: '20001', name: 'Zhin', platformRole: 'admin' };
    const text = reply([{ type: 'text', text: 'hi' }]);
    const calls = reply([{ type: 'toolCall', id: 'c', name: 't', arguments: {} }]);
    const named = reply([{ type: 'text', text: 'x' }], '[user_id:other;]');
    const [a, b, c] = stampAssistantHeaders([text, calls, named], bot) as AssistantMessage[];
    expect(a!.name).toMatch(/^\[user_id:20001;name:Zhin;role:admin;time:/u);
    expect(b).toBe(calls);
    expect(c).toBe(named);
    const noBot = [text];
    expect(stampAssistantHeaders(noBot, undefined)).toBe(noBot);
  });
});
