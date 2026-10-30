import { describe, expect, it } from 'vitest';
import type { ConversationRef } from '@zhin.js/im-contract';
import {
  compileModelPolicy, createModelPolicyResolver, ModelPolicyValidationError,
  MODEL_POLICY_SCOPE_FIELDS, type ModelPolicyResolveInput,
} from '../../src/model-policy/index.js';

function address() {
  return {
    rootId: 'root', platform: 'qq', endpoint: 'account-1',
    conversation: {
      endpoint: { adapter: 'adapter-feature', id: 'plugin\0adapter\0qq~bot' },
      kind: 'channel' as const, id: 'channel-1',
      parent: { kind: 'group' as const, id: 'guild-1' }, threadId: 'thread-1',
    },
  };
}
function input(): ModelPolicyResolveInput {
  const { rootId, ...origin } = address();
  return { rootId, origin };
}
function config() {
  const scene = address();
  return {
    defaults: { chat: 'host-chat', perception: 'host-vision', summary: 'host-summary' },
    adapters: { qq: { chat: 'adapter-chat', perception: 'adapter-vision' } },
    endpoints: [{
      address: { rootId: scene.rootId, platform: scene.platform, endpoint: scene.endpoint, adapterId: scene.conversation.endpoint.id },
      models: { chat: 'endpoint-chat', perception: 'endpoint-vision' },
    }],
    scenes: [{ address: scene, models: { chat: 'scene-chat' } }],
  };
}

describe('strict model policy compiler and scope resolver', () => {
  it('uses the field allowlist and ordered scope overrides, preserving per-purpose provenance', () => {
    const policy = createModelPolicyResolver(compileModelPolicy(config()));
    const result = policy.resolve({ ...input(), session: { chat: { kind: 'preset', presetId: 'personal-chat' } } });
    expect(result.refs).toEqual({ chat: 'personal-chat', perception: 'endpoint-vision', summary: 'host-summary' });
    expect(result.sources.chat).toEqual({ level: 'session', address: address() });
    expect(result.sources.perception?.level).toBe('endpoint');
    expect(result.sources.summary?.level).toBe('default');
    expect(MODEL_POLICY_SCOPE_FIELDS).toEqual({
      default: ['chat', 'perception', 'summary'], adapter: ['chat', 'perception'],
      endpoint: ['chat', 'perception'], scene: ['chat'], session: ['chat'],
    });
  });

  it('restores inheritance through inherit selection and removed config overrides', () => {
    const full = config();
    expect(compileModelPolicy(full).resolve({ ...input(), session: { chat: { kind: 'inherit' } } }).refs.chat).toBe('scene-chat');
    const { scenes: _scenes, ...endpointConfig } = full;
    expect(compileModelPolicy(endpointConfig).resolve(input()).refs.chat).toBe('endpoint-chat');
    const { endpoints: _endpoints, ...adapterConfig } = endpointConfig;
    expect(compileModelPolicy(adapterConfig).resolve(input()).refs.chat).toBe('adapter-chat');
    expect(compileModelPolicy({ defaults: full.defaults }).resolve(input()).refs.chat).toBe('host-chat');
    expect(compileModelPolicy({ defaults: {} }).resolve(input())).toEqual({ refs: {}, sources: {} });
  });

  it.each([
    ['top level', { ...config(), decision: 'llm-decision' }],
    ['default', { defaults: { chat: 'a', decision: 'b' } }],
    ['adapter', { defaults: {}, adapters: { qq: { summary: 'a' } } }],
    ['endpoint', { ...config(), endpoints: [{ ...config().endpoints[0], models: { summary: 'a' } }] }],
    ['scene', { ...config(), scenes: [{ address: address(), models: { perception: 'a' } }] }],
    ['nested address', { ...config(), scenes: [{ address: { ...address(), ownerId: 'spoof' }, models: {} }] }],
    ['nested conversation', { ...config(), scenes: [{ address: { ...address(), conversation: { ...address().conversation, unknown: true } }, models: {} }] }],
  ])('rejects unknown and forbidden %s fields', (_label, value) => {
    expect(() => compileModelPolicy(value)).toThrow(ModelPolicyValidationError);
  });

  it.each([null, '', ' ', ' padded', 42, {}, undefined])('rejects invalid explicit preset reference %j', value => {
    expect(() => compileModelPolicy({ defaults: { chat: value } })).toThrow(ModelPolicyValidationError);
  });

  it('rejects null clearing and malformed runtime selections before returning an inherited value', () => {
    const policy = compileModelPolicy(config());
    for (const selection of [null, '', { kind: 'preset', presetId: '' }, { kind: 'inherit', presetId: 'x' }, { kind: 'unknown' }]) {
      const request = { ...input(), session: { chat: selection } } as unknown as ModelPolicyResolveInput;
      expect(() => policy.resolve(request)).toThrow(ModelPolicyValidationError);
    }
    expect(() => policy.resolve({ ...input(), session: { perception: 'x' } } as unknown as ModelPolicyResolveInput)).toThrow(ModelPolicyValidationError);
  });

  it('does not silently replace an explicit unresolved catalog reference with a default', () => {
    const policy = compileModelPolicy(config());
    // Catalog authorization/capabilities remain the caller's responsibility. The exact explicit
    // reference must reach that boundary so catalog errors cannot become host-model fallback.
    const result = policy.resolve({ ...input(), session: { chat: { kind: 'preset', presetId: 'missing-or-forbidden' } } });
    expect(result.refs.chat).toBe('missing-or-forbidden');
    expect(result.sources.chat?.level).toBe('session');
  });

  it('isolates every scene identity component while retaining lower-scope inheritance', () => {
    const policy = compileModelPolicy(config());
    const base = input();
    const changes: Array<[Partial<ModelPolicyResolveInput['origin']>, string]> = [
      [{ platform: 'discord' }, 'host-chat'],
      [{ endpoint: 'account-2' }, 'adapter-chat'],
      [{ conversation: { ...base.origin.conversation, endpoint: { ...base.origin.conversation.endpoint, id: 'another-entry' } } }, 'adapter-chat'],
      [{ conversation: { ...base.origin.conversation, endpoint: { ...base.origin.conversation.endpoint, adapter: 'another-feature' } } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, kind: 'group' } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, id: 'channel-2' } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, parent: { kind: 'channel', id: 'guild-1' } } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, parent: { kind: 'group', id: 'guild-2' } } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, parent: undefined } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, threadId: 'thread-2' } }, 'endpoint-chat'],
      [{ conversation: { ...base.origin.conversation, threadId: undefined } }, 'endpoint-chat'],
    ];
    expect(policy.resolve({ ...base, rootId: 'other-root' }).refs.chat).toBe('adapter-chat');
    for (const [patch, expected] of changes) {
      expect(policy.resolve({ ...base, origin: { ...base.origin, ...patch } }).refs.chat).toBe(expected);
    }
    expect(policy.resolve({ ...base, origin: { ...base.origin, conversation: { ...base.origin.conversation, name: 'renamed' } } }).refs.chat).toBe('scene-chat');
  });

  it('uses structural identity boundaries even for embedded separators and NUL', () => {
    const first = { ...address(), rootId: 'a:b', platform: 'c' };
    const second = { ...address(), rootId: 'a', platform: 'b:c' };
    const policy = compileModelPolicy({ defaults: {}, scenes: [
      { address: first, models: { chat: 'first' } }, { address: second, models: { chat: 'second' } },
    ] });
    for (const [value, expected] of [[first, 'first'], [second, 'second']] as const) {
      const { rootId, ...origin } = value;
      expect(policy.resolve({ rootId, origin }).refs.chat).toBe(expected);
    }
    const alternate: ConversationRef = { ...address().conversation,
      endpoint: { adapter: 'adapter-feature\0plugin', id: 'adapter\0qq~bot' } };
    const { rootId, ...origin } = first;
    expect(policy.resolve({ rootId, origin: { ...origin, conversation: alternate } }).refs.chat).toBeUndefined();
  });

  it('rejects duplicate exact addresses, including scene names that differ only for display', () => {
    const value = config();
    expect(() => compileModelPolicy({ ...value, endpoints: [value.endpoints[0], value.endpoints[0]] })).toThrow('duplicate endpoint scope');
    expect(() => compileModelPolicy({ defaults: {}, scenes: [value.scenes[0], {
      address: { ...address(), conversation: { ...address().conversation, name: 'renamed' } }, models: {},
    }] })).toThrow('duplicate scene scope');
  });

  it('copies and freezes compiled input, outputs, and provenance without mutating callers', () => {
    const value = config();
    const request = input();
    const before = structuredClone(value);
    const policy = compileModelPolicy(value);
    const result = policy.resolve(request);
    expect(value).toEqual(before);
    expect(Object.isFrozen(value)).toBe(false);
    value.scenes[0].models.chat = 'changed';
    value.defaults.summary = 'changed';
    expect(policy.resolve(request).refs).toEqual(result.refs);
    expect(Reflect.set(policy.config.defaults, 'chat', 'mutated')).toBe(false);
    expect(Reflect.set(result.refs, 'chat', 'mutated')).toBe(false);
    expect(Object.isFrozen(result.sources.chat)).toBe(true);
    const source = result.sources.chat;
    expect(source?.level).toBe('scene');
    if (source?.level === 'scene') {
      expect(Reflect.set(source.address.conversation.endpoint, 'id', 'mutated')).toBe(false);
    }
    expect(Object.isFrozen(request)).toBe(false);
  });
});
