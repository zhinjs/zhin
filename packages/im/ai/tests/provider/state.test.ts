import { projectProviderState, providerStateScope, stampProviderState } from '../../src/provider/state.js';
import { resolveProviderProfile } from '../../src/provider/selection.js';
import { serializeAgentMessage, parseAgentMessageRow } from '../../src/memory/agent-db-models.js';
import type { AssistantMessage } from '../../src/llm/types/agent-message.js';
import { context, graphFixture, assistant } from './fixtures.js';

describe('provider-owned opaque history', () => {
  const binding = resolveProviderProfile({ graph: graphFixture(), context, kind: 'language', purpose: 'chat' });
  const scope = providerStateScope({ binding, context });
  const signed = stampProviderState({ scope, message: { ...assistant(), content: [
    { type: 'thinking', thinking: '', providerOptions: { openai: { itemId: 'reason', reasoningEncryptedContent: 'encrypted' } } },
    { type: 'text', text: 'answer', providerOptions: { google: { thoughtSignature: 'signature' } } },
    { type: 'toolCall', id: 'call', name: 'read', arguments: {}, providerOptions: { google: { thoughtSignature: 'signed-tool' } } },
  ] } });
  it('round-trips exact opaque ownership through the real storage serializer', () => {
    const row = serializeAgentMessage(signed);
    const message = parseAgentMessageRow(row) as AssistantMessage;
    const projected = projectProviderState({ context: { systemPrompt: '', messages: [message] }, scope });
    expect(projected.messages[0]).toEqual(signed);
    expect(scope.sessionKey).not.toContain(context.sessionKey!);
  });
  it.each(['account', 'model', 'protocol', 'service', 'session', 'epoch'])('does not replay another %s scope', field => {
    const changed = field === 'session' ? providerStateScope({ binding, context: { ...context, sessionKey: 'other' } })
      : field === 'epoch' ? providerStateScope({ binding, context: { ...context, epoch: 'other' } })
        : { ...scope, ...({ account: { accountIncarnation: 'other' }, model: { model: 'other' }, protocol: { protocol: 'other' }, service: { serviceId: 'other' } }[field] ?? {}) };
    const projected = projectProviderState({ context: { systemPrompt: '', messages: [signed] }, scope: changed });
    const message = projected.messages[0] as AssistantMessage;
    expect(message.content).toEqual([{ type: 'text', text: 'answer' }, { type: 'toolCall', id: 'call', name: 'read', arguments: {} }]);
    expect(message.providerStateScope).toBeUndefined();
    expect(signed.content[0].type).toBe('thinking');
  });
  it('does not grant old unscoped signatures ownership by provider or model name', () => {
    const { providerStateScope: _scope, ...legacy } = signed;
    expect((projectProviderState({ context: { systemPrompt: '', messages: [legacy] }, scope }).messages[0] as AssistantMessage).content)
      .toEqual([{ type: 'text', text: 'answer' }, { type: 'toolCall', id: 'call', name: 'read', arguments: {} }]);
  });
});
