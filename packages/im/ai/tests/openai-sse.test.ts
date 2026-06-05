import { describe, it, expect } from 'vitest';
import {
  aggregateOpenAISseToChatCompletion,
  isOpenAISseBody,
  parseOpenAIChatCompletionBody,
} from '../src/providers/openai-sse.js';

describe('openai-sse', () => {
  it('detects SSE bodies', () => {
    expect(isOpenAISseBody('data: {"id":"x"}\n')).toBe(true);
    expect(isOpenAISseBody('{"choices":[]}')).toBe(false);
  });

  it('parses plain JSON unchanged', () => {
    const json = JSON.stringify({
      id: 'c1',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });
    const res = parseOpenAIChatCompletionBody(json);
    expect(res.choices[0].message.content).toBe('ok');
  });

  it('aggregates streamed chunks into one completion', () => {
    const lines = [
      'data: ' + JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'm',
        choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }],
      }),
      'data: ' + JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'm',
        choices: [{ index: 0, delta: { content: 'b' }, finish_reason: 'stop' }],
      }),
    ];
    const res = aggregateOpenAISseToChatCompletion(lines.join('\n'));
    expect(res.choices[0].message.content).toBe('ab');
    expect(res.choices[0].finish_reason).toBe('stop');
  });
});
