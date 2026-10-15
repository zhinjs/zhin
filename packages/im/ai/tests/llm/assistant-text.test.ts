import { describe, it, expect } from 'vitest';
import { assistantText, assistantAnswerText, CompletionFailureError, EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/index.js';

function assistant(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'ai-sdk',
    provider: 'test',
    model: 'test',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: 'stop',
    timestamp: 0,
  };
}

describe('assistantText', () => {
  it('joins text blocks', () => {
    expect(assistantText(assistant([
      { type: 'text', text: '你好' },
      { type: 'text', text: '！' },
    ]))).toBe('你好！');
  });

  it('falls back to thinking blocks when there is no text and no tool call', () => {
    expect(assistantText(assistant([{ type: 'thinking', thinking: '推理中' }]))).toBe('推理中');
  });

  it('does not surface thinking as text when the turn ended with tool calls', () => {
    expect(assistantText(assistant([
      { type: 'thinking', thinking: '推理中' },
      { type: 'toolCall', id: 'c1', name: 'search', arguments: {} },
    ]))).toBe('');
  });
});

describe('assistantAnswerText', () => {
  it('returns only text blocks', () => {
    expect(assistantAnswerText(assistant([
      { type: 'thinking', thinking: '推理中' },
      { type: 'text', text: '答案' },
    ]))).toBe('答案');
  });

  it('returns empty text instead of thinking', () => {
    expect(assistantAnswerText(assistant([{ type: 'thinking', thinking: '推理中' }]))).toBe('');
  });

  it('throws the user-presentable error for a failed finish', () => {
    const failed = { ...assistant([{ type: 'thinking', thinking: '推理中' }]), stopReason: 'error' as const, errorMessage: '模型输出达到长度上限，未生成回复（length）' };
    expect(() => assistantAnswerText(failed)).toThrow(CompletionFailureError);
    expect(() => assistantAnswerText(failed)).toThrow('模型输出达到长度上限');
  });
});
