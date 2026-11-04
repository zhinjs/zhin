import { projectProviderDiagnostics, PROVIDER_STATE_OMITTED } from '../src/llm/provider-diagnostics.js';

it('projects only known replay-only state without changing private history or useful diagnostic options', () => {
  const original = { role: 'assistant', providerStateScope: { accountIncarnation: 'private-account' }, content: [
    { type: 'thinking', thinking: 'considered', providerOptions: { anthropic: { signature: 'private-signature', cacheControl: { type: 'ephemeral' } }, openai: { reasoningEncryptedContent: 'private-encrypted', itemId: 'private-item', parallelToolCalls: false } } },
    { type: 'toolCall', id: 'call-real', name: 'lookup', arguments: { signature: 'user-argument', providerOptions: { anthropic: { signature: 'ordinary-tool-argument' } } }, providerOptions: { google: { thoughtSignature: 'private-thought', usefulOption: true } } },
  ] };
  const projected = projectProviderDiagnostics(original);
  const text = JSON.stringify(projected);
  for (const marker of ['private-account', 'private-signature', 'private-encrypted', 'private-item', 'private-thought']) expect(text).not.toContain(marker);
  expect(text).toContain('ordinary-tool-argument'); expect(text).toContain('call-real'); expect(text).toContain('user-argument'); expect(text).toContain('cacheControl'); expect(text).toContain('parallelToolCalls');
  expect(projected.providerStateScope).toBe(PROVIDER_STATE_OMITTED);
  expect(JSON.stringify(original)).toContain('private-signature');
});

it('handles raw native protocol state and preserves cycles for the existing downstream cycle sanitizer', () => {
  const original: Record<string, unknown> = { parts: [
    { type: 'reasoning', encrypted_content: 'private-encrypted' }, { type: 'thinking', signature: 'private-signed' },
    { type: 'redacted_thinking', data: 'private-redacted' }, { functionCall: { name: 'lookup' }, thoughtSignature: 'private-thought' },
  ] };
  original.self = original;
  const projected = projectProviderDiagnostics(original);
  expect(projected.self).toBe(projected);
  expect(JSON.stringify(projected.parts)).not.toMatch(/private-/);
});
