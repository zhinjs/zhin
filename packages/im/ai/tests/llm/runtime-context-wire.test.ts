import { describe, expect, it } from 'vitest';
import { agentMessagesToAiSdk } from '../../src/llm/bridge/ai-sdk-messages.js';
import { createUserMessage } from '../../src/llm/types/agent-message.js';
import { RUNTIME_CONTEXT_MARKER } from '../../src/llm/types/runtime-context.js';
import { createProviderHarness } from '../helpers/provider-harness/index.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('runtime context at the provider boundary', () => {
  it('preserves ordinary multipart participant text exactly', () => {
    const message = { ...createUserMessage(''), content: [
      { type: 'text' as const, text: 'hello' },
      { type: 'text' as const, text: 'world' },
      { type: 'text' as const, text: '' },
    ] };
    expect(agentMessagesToAiSdk([message])[0]?.content).toEqual(message.content);
  });

  it('only separates the trusted runtime tail, not a participant-typed marker', () => {
    const message = { ...createUserMessage(''), content: [
      { type: 'text' as const, text: 'hello' },
      { type: 'text' as const, text: RUNTIME_CONTEXT_MARKER },
    ] };
    expect(agentMessagesToAiSdk([message])[0]?.content).toEqual(message.content);
  });

  it.each(['anthropic', 'google', 'openai', 'openai-compatible'] as const)('%s keeps participant media before the host tail on the wire', async (sdk) => {
    const h = createProviderHarness({ sdk, config: { input: ['text', 'image'] } });
    const message = createUserMessage('question', [
      { type: 'image', data: { media: { kind: 'base64', value: PNG, mime_type: 'image/png' } } },
    ]);
    message.content.push(
      { type: 'text', text: RUNTIME_CONTEXT_MARKER, perTurn: true },
      { type: 'text', text: 'host note', perTurn: true },
    );
    const { body } = await h.capture({ messages: [message] });
    const wire = JSON.stringify(body);
    expect(wire.indexOf(PNG)).toBeGreaterThan(-1);
    expect(wire.indexOf(PNG)).toBeLessThan(wire.indexOf(RUNTIME_CONTEXT_MARKER));
    expect(wire.indexOf('host note')).toBeGreaterThan(wire.indexOf(RUNTIME_CONTEXT_MARKER));
    if (sdk === 'anthropic') {
      expect(body.messages[0].content[0]).toMatchObject({ type: 'text', text: 'question', cache_control: { type: 'ephemeral' } });
      expect(body.messages[0].content.find((part: { type: string }) => part.type === 'image').cache_control).toBeUndefined();
    }
  });

  it('keeps unsupported-media placeholders before the host tail and outside the body anchor', async () => {
    const h = createProviderHarness({ sdk: 'anthropic', config: { input: ['text'] } });
    const message = createUserMessage('question', [
      { type: 'image', data: { media: { kind: 'base64', value: PNG, mime_type: 'image/png' } } },
    ]);
    message.content.push({ type: 'text', text: RUNTIME_CONTEXT_MARKER, perTurn: true });
    const { body } = await h.capture({ messages: [message] });
    const parts = body.messages[0].content;
    expect(parts[0]).toMatchObject({ text: 'question', cache_control: { type: 'ephemeral' } });
    expect(parts[1].text).toContain('Media unavailable');
    expect(parts[1].cache_control).toBeUndefined();
    expect(parts[2].text).toContain(RUNTIME_CONTEXT_MARKER);
  });
});
