import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createToolNameCodec,
  GEMINI_TOOL_NAME_PATTERN,
  isGeminiSafeToolName,
  sanitizeGeminiToolName,
} from '../../src/llm/bridge/tool-name-wire.js';
import { agentMessagesToAiSdk, llmToolsToAiSdk } from '../../src/llm/bridge/ai-sdk-messages.js';
import { EMPTY_TOKEN_USAGE, type AgentMessage } from '../../src/llm/types/agent-message.js';

const DIGIT_TOOLS = [
  '60s__skill__60s-life__duanzi',
  '60s__skill__60s-life__history_today',
  '60s__skill__60s-life__weather',
];

const tool = (name: string) => ({ name, description: name, parameters: z.object({}) });

describe('Gemini tool-name wire codec', () => {
  it('keeps valid names and fixes digit-leading, illegal-char and over-long names', () => {
    expect(sanitizeGeminiToolName('get_weather')).toBe('get_weather');
    expect(sanitizeGeminiToolName('mcp:fs.read-file')).toBe('mcp:fs.read-file');
    expect(sanitizeGeminiToolName('60s__skill__60s-life__weather')).toBe('_60s__skill__60s-life__weather');
    expect(sanitizeGeminiToolName('天气 查询')).toBe('_____');
    expect(sanitizeGeminiToolName('-x')).toBe('_-x');
    const long = sanitizeGeminiToolName(`9${'a'.repeat(300)}`);
    expect(long).toHaveLength(128);
    expect(isGeminiSafeToolName(long)).toBe(true);
    expect(sanitizeGeminiToolName(`9${'a'.repeat(300)}`)).toBe(long);
  });

  it('round-trips every name, never reuses a valid name, and resolves collisions', () => {
    const names = [...DIGIT_TOOLS, '_60s__skill__60s-life__weather', 'a b', 'a_b', 'a?b', 'get_weather'];
    const codec = createToolNameCodec(names, 'google');
    const wires = names.map((n) => codec.toWire(n));
    expect(new Set(wires).size).toBe(names.length);
    for (const wire of wires) expect(wire).toMatch(GEMINI_TOOL_NAME_PATTERN);
    for (const name of names) expect(codec.fromWire(codec.toWire(name))).toBe(name);
    expect(codec.toWire('_60s__skill__60s-life__weather')).toBe('_60s__skill__60s-life__weather');
    expect(codec.toWire('a_b')).toBe('a_b');
    expect(codec.toWire('60s__skill__60s-life__weather')).not.toBe('_60s__skill__60s-life__weather');
    // Names seen only in history are assigned on demand and stay valid.
    expect(codec.toWire('1history_only')).toBe('_1history_only');
    expect(codec.fromWire('_1history_only')).toBe('1history_only');
    expect(codec.fromWire('unknown_tool')).toBe('unknown_tool');
  });

  it('is a no-op for SDKs without the Gemini rule', () => {
    const codec = createToolNameCodec(DIGIT_TOOLS, 'deepseek');
    expect(codec.toWire(DIGIT_TOOLS[0]!)).toBe(DIGIT_TOOLS[0]);
    expect(Object.keys(llmToolsToAiSdk(DIGIT_TOOLS.map(tool), { sdk: 'deepseek' })!)).toEqual(DIGIT_TOOLS);
  });

  it('sanitizes tool-set keys and history tool names for google by default', () => {
    const keys = Object.keys(llmToolsToAiSdk([tool('get_weather'), ...DIGIT_TOOLS.map(tool)], { sdk: 'google' })!);
    for (const key of keys) expect(key).toMatch(GEMINI_TOOL_NAME_PATTERN);
    expect(keys).toContain('_60s__skill__60s-life__weather');

    const messages: AgentMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '天气' }], timestamp: 0 },
      {
        role: 'assistant', api: 'ai-sdk', provider: 'gemini', model: 'm', timestamp: 1,
        usage: { ...EMPTY_TOKEN_USAGE }, stopReason: 'toolCalls',
        content: [{ type: 'toolCall', id: 'c1', name: '60s__skill__60s-life__weather', arguments: {} }],
      },
      { role: 'toolResult', toolCallId: 'c1', toolName: '60s__skill__60s-life__weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 2 },
    ];
    const google = JSON.stringify(agentMessagesToAiSdk(messages, undefined, { sdk: 'google' }));
    expect(google).toContain('"toolName":"_60s__skill__60s-life__weather"');
    expect(google).not.toContain('"toolName":"60s__');
    const deepseek = JSON.stringify(agentMessagesToAiSdk(messages, undefined, { sdk: 'deepseek' }));
    expect(deepseek).toContain('"toolName":"60s__skill__60s-life__weather"');
  });
});
