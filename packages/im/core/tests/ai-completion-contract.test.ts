import { describe, expect, it } from 'vitest';
import { createToken, rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import {
  aiCompletionToken,
  hasResource,
  isAiCompletionQuotaError,
  usageGroupId,
  usageSubjectFromMessage,
  type UsageSubjectSource,
} from '../src/ai-completion-contract.js';
import * as core from '../src/index.js';

function message(overrides: Partial<UsageSubjectSource> = {}, kind = 'group'): UsageSubjectSource {
  return {
    conversation: { endpoint: { adapter: 'icqq', id: 'bot-1' }, kind, id: 'g100' },
    sender: { id: 'u1', roles: [] },
    ...overrides,
  };
}

describe('usageSubjectFromMessage (#877)', () => {
  it('builds the same group key as Agent turns in group and channel chats', () => {
    expect(usageSubjectFromMessage(message())).toEqual({ userId: 'u1', groupId: 'icqq:bot-1:g100', owner: false });
    expect(usageSubjectFromMessage(message({}, 'channel'))?.groupId).toBe(usageGroupId('icqq', 'bot-1', 'g100'));
  });

  it('omits groupId in private chats', () => {
    const subject = usageSubjectFromMessage(message({}, 'private'));
    expect(subject).toEqual({ userId: 'u1', owner: false });
    expect(subject && 'groupId' in subject).toBe(false);
  });

  it('prefers clientAdapter / endpointId like the turn ingress does', () => {
    expect(usageSubjectFromMessage(message({ clientAdapter: 'onebot11', endpointId: 'bot-2' }))?.groupId)
      .toBe('onebot11:bot-2:g100');
  });

  it('marks master senders as owner', () => {
    expect(usageSubjectFromMessage(message({ sender: { id: 'u1', roles: ['admin', 'master'] } }))?.owner).toBe(true);
    expect(usageSubjectFromMessage(message({ sender: { id: 'u1', roles: ['admin'] } }))?.owner).toBe(false);
  });

  it('returns undefined instead of throwing when there is no sender', () => {
    expect(usageSubjectFromMessage(message({ sender: undefined }))).toBeUndefined();
    expect(usageSubjectFromMessage(message({ sender: { id: '  ' } }))).toBeUndefined();
  });

  it('rejects malformed conversations', () => {
    expect(() => usageSubjectFromMessage(message({}, 'unknown'))).toThrow(TypeError);
    expect(() => usageSubjectFromMessage({ ...message(), conversation: { endpoint: { adapter: 'icqq', id: '' }, kind: 'group', id: 'g' } }))
      .toThrow(/endpoint/);
  });

  it('returns a frozen subject', () => {
    expect(Object.isFrozen(usageSubjectFromMessage(message()))).toBe(true);
  });
});

describe('isAiCompletionQuotaError', () => {
  it('recognises the quota error by shape, without importing the agent', () => {
    const error = Object.assign(new Error('slow down'), { name: 'AiCompletionQuotaError', scope: 'user', retryAfterSeconds: 30 });
    expect(isAiCompletionQuotaError(error)).toBe(true);
    expect(isAiCompletionQuotaError(new Error('x'))).toBe(false);
    expect(isAiCompletionQuotaError(Object.assign(new Error('x'), { name: 'AiCompletionQuotaError' }))).toBe(false);
    expect(isAiCompletionQuotaError({ name: 'AiCompletionQuotaError', scope: 'user', retryAfterSeconds: 1 })).toBe(false);
  });
});

describe('hasResource', () => {
  const absent = createToken<string>('fixture.absent');

  it('uses context.has when present', () => {
    const scope = new Scope(rootPluginId());
    scope.provide(aiCompletionToken, { completeText: async () => ({ text: '', model: 'm', durationMs: 0 }) });
    expect(hasResource(scope, aiCompletionToken)).toBe(true);
    expect(hasResource(scope, absent)).toBe(false);
  });

  it('falls back to probing use() for contexts without has', () => {
    const context = { use: <T>(token: { id: string }): T => { if (token.id === aiCompletionToken.id) return {} as T; throw new Error('missing'); } };
    expect(hasResource(context, aiCompletionToken)).toBe(true);
    expect(hasResource(context, absent)).toBe(false);
  });
});

describe('core entry', () => {
  it('exports the contract with the agent token id', () => {
    expect(core.aiCompletionToken).toBe(aiCompletionToken);
    expect(aiCompletionToken.id).toBe('zhin.agent.ai-completion');
    expect(typeof core.usageSubjectFromMessage).toBe('function');
    expect(typeof core.isAiCompletionQuotaError).toBe('function');
    expect(typeof core.hasResource).toBe('function');
  });
});
