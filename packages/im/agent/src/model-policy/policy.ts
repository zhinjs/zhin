import type { ConversationKind, ConversationRef } from '@zhin.js/im-contract';
import {
  MODEL_POLICY_SCOPE_FIELDS, ModelPolicyValidationError,
  type ModelPolicyConfig, type ModelPolicyEndpointAddress, type ModelPolicySceneAddress,
  type ModelPolicyRefs, type ModelPolicyScope, type ModelPolicySource,
  type ModelPolicyResolveInput, type EffectiveModelPolicy, type ModelPurpose,
} from './types.js';

function invalid(path: string, reason: string): never {
  throw new ModelPolicyValidationError(path, reason);
}
function record(input: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid(path, 'expected an object');
  const result = input as Record<string, unknown>;
  for (const key of Reflect.ownKeys(result)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key))) invalid(path, 'unknown field');
  }
  return result;
}
function text(input: unknown, path: string): string {
  if (typeof input !== 'string' || !input.trim() || input !== input.trim()) invalid(path, 'expected a non-empty canonical string');
  return input;
}
function fields(input: unknown, scope: ModelPolicyScope, path: string): ModelPolicyRefs {
  const source = record(input, path, MODEL_POLICY_SCOPE_FIELDS[scope]);
  return Object.freeze(Object.fromEntries(Object.entries(source).map(([key, value]) => [key, text(value, `${path}.${key}`)])));
}
function list(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input)) invalid(path, 'expected an array');
  return input;
}
function kind(input: unknown, path: string): ConversationKind {
  if (input !== 'private' && input !== 'group' && input !== 'channel') invalid(path, 'invalid conversation kind');
  return input;
}
function conversation(input: unknown, path: string): ConversationRef {
  const source = record(input, path, ['endpoint', 'kind', 'id', 'parent', 'threadId', 'name']);
  const endpoint = record(source.endpoint, `${path}.endpoint`, ['adapter', 'id']);
  const parent = source.parent === undefined ? undefined : record(source.parent, `${path}.parent`, ['kind', 'id']);
  // Display names are validated but deliberately omitted from identity and provenance.
  if (source.name !== undefined && typeof source.name !== 'string') invalid(`${path}.name`, 'expected a string');
  return Object.freeze({
    endpoint: Object.freeze({ adapter: text(endpoint.adapter, `${path}.endpoint.adapter`), id: text(endpoint.id, `${path}.endpoint.id`) }),
    kind: kind(source.kind, `${path}.kind`), id: text(source.id, `${path}.id`),
    ...(parent ? { parent: Object.freeze({ kind: kind(parent.kind, `${path}.parent.kind`), id: text(parent.id, `${path}.parent.id`) }) } : {}),
    ...(source.threadId !== undefined ? { threadId: text(source.threadId, `${path}.threadId`) } : {}),
  });
}
function endpointAddress(input: unknown, path: string): ModelPolicyEndpointAddress {
  const source = record(input, path, ['rootId', 'platform', 'endpoint', 'adapterId']);
  return Object.freeze({ rootId: text(source.rootId, `${path}.rootId`), platform: text(source.platform, `${path}.platform`),
    endpoint: text(source.endpoint, `${path}.endpoint`), adapterId: text(source.adapterId, `${path}.adapterId`) });
}
function sceneAddress(input: unknown, path: string): ModelPolicySceneAddress {
  const source = record(input, path, ['rootId', 'platform', 'endpoint', 'conversation']);
  return Object.freeze({ rootId: text(source.rootId, `${path}.rootId`), platform: text(source.platform, `${path}.platform`),
    endpoint: text(source.endpoint, `${path}.endpoint`), conversation: conversation(source.conversation, `${path}.conversation`) });
}
// Fixed JSON tuples preserve field boundaries even for canonical IDs containing NUL or separators.
export function modelPolicyEndpointAddressKey(address: ModelPolicyEndpointAddress): string {
  return JSON.stringify([address.rootId, address.platform, address.endpoint, address.adapterId]);
}
export function modelPolicySceneAddressKey(address: ModelPolicySceneAddress): string {
  const value = address.conversation;
  return JSON.stringify([address.rootId, address.platform, address.endpoint, value.endpoint.adapter, value.endpoint.id,
    value.kind, value.id, value.parent?.kind ?? null, value.parent?.id ?? null, value.threadId ?? null]);
}

/** A validated immutable policy, with private indexes owned by this compiled snapshot. */
export class CompiledModelPolicy {
  readonly config: ModelPolicyConfig;
  readonly #endpoints = new Map<string, NonNullable<ModelPolicyConfig['endpoints']>[number]>();
  readonly #scenes = new Map<string, NonNullable<ModelPolicyConfig['scenes']>[number]>();

  constructor(input: unknown) {
    const source = record(input, '$', ['defaults', 'adapters', 'endpoints', 'scenes']);
    const defaults = fields(source.defaults, 'default', '$.defaults');
    const adapters = source.adapters === undefined ? undefined : Object.freeze(Object.fromEntries(
      Object.entries(record(source.adapters, '$.adapters')).map(([key, value]) =>
        [text(key, '$.adapters key'), fields(value, 'adapter', `$.adapters.${key}`)]),
    ));
    const endpoints = source.endpoints === undefined ? undefined : Object.freeze(list(source.endpoints, '$.endpoints').map((value, index) => {
      const path = `$.endpoints[${index}]`;
      const entry = record(value, path, ['address', 'models']);
      const result = Object.freeze({ address: endpointAddress(entry.address, `${path}.address`), models: fields(entry.models, 'endpoint', `${path}.models`) });
      const key = modelPolicyEndpointAddressKey(result.address);
      if (this.#endpoints.has(key)) invalid(path, 'duplicate endpoint scope');
      this.#endpoints.set(key, result);
      return result;
    }));
    const scenes = source.scenes === undefined ? undefined : Object.freeze(list(source.scenes, '$.scenes').map((value, index) => {
      const path = `$.scenes[${index}]`;
      const entry = record(value, path, ['address', 'models']);
      const result = Object.freeze({ address: sceneAddress(entry.address, `${path}.address`), models: fields(entry.models, 'scene', `${path}.models`) });
      const key = modelPolicySceneAddressKey(result.address);
      if (this.#scenes.has(key)) invalid(path, 'duplicate scene scope');
      this.#scenes.set(key, result);
      return result;
    }));
    this.config = Object.freeze({ defaults, ...(adapters ? { adapters } : {}), ...(endpoints ? { endpoints } : {}), ...(scenes ? { scenes } : {}) });
    Object.freeze(this);
  }

  resolve(input: ModelPolicyResolveInput): EffectiveModelPolicy {
    const source = record(input, '$input', ['rootId', 'origin', 'session']);
    const origin = record(source.origin, '$input.origin', ['platform', 'endpoint', 'conversation']);
    const address = sceneAddress({ rootId: source.rootId, ...origin }, '$input.address');
    const endpoint = Object.freeze({ rootId: address.rootId, platform: address.platform, endpoint: address.endpoint, adapterId: address.conversation.endpoint.id });
    const refs: Partial<Record<ModelPurpose, string>> = {};
    const sources: Partial<Record<ModelPurpose, ModelPolicySource>> = {};
    const apply = (patch: ModelPolicyRefs | undefined, provenance: ModelPolicySource) => {
      for (const purpose of MODEL_POLICY_SCOPE_FIELDS.default) {
        if (patch?.[purpose] !== undefined) { refs[purpose] = patch[purpose]; sources[purpose] = provenance; }
      }
    };
    apply(this.config.defaults, Object.freeze({ level: 'default', rootId: address.rootId }));
    const adapter = Object.hasOwn(this.config.adapters ?? {}, address.platform) ? this.config.adapters?.[address.platform] : undefined;
    apply(adapter, Object.freeze({ level: 'adapter', rootId: address.rootId, platform: address.platform }));
    const endpointEntry = this.#endpoints.get(modelPolicyEndpointAddressKey(endpoint));
    apply(endpointEntry?.models, Object.freeze({ level: 'endpoint', address: endpointEntry?.address ?? endpoint }));
    const sceneEntry = this.#scenes.get(modelPolicySceneAddressKey(address));
    apply(sceneEntry?.models, Object.freeze({ level: 'scene', address: sceneEntry?.address ?? address }));
    if (source.session !== undefined) {
      const session = record(source.session, '$input.session', MODEL_POLICY_SCOPE_FIELDS.session);
      if (session.chat !== undefined) {
        const selection = record(session.chat, '$input.session.chat', ['kind', 'presetId']);
        if (selection.kind === 'inherit') {
          if (Object.hasOwn(selection, 'presetId')) invalid('$input.session.chat', 'inherit selection cannot contain presetId');
        } else if (selection.kind === 'preset') {
          apply({ chat: text(selection.presetId, '$input.session.chat.presetId') }, Object.freeze({ level: 'session', address }));
        } else invalid('$input.session.chat.kind', 'expected inherit or preset');
      }
    }
    return Object.freeze({ refs: Object.freeze(refs), sources: Object.freeze(sources) });
  }
}

export function compileModelPolicy(config: unknown): CompiledModelPolicy {
  return new CompiledModelPolicy(config);
}
export function createModelPolicyResolver(compiled: CompiledModelPolicy): Readonly<{ resolve(input: ModelPolicyResolveInput): EffectiveModelPolicy }> {
  return Object.freeze({ resolve: (input: ModelPolicyResolveInput) => compiled.resolve(input) });
}
