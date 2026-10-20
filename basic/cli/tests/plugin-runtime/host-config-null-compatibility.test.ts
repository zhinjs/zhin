import { describe, expect, it } from 'vitest';
import { HOST_CONFIG_SCHEMA, parsePluginConfigSchema } from '../../../../packages/im/runtime/src/config-composer.js';
import { resolveAssistantDefaultsConfig, resolveAssistantEventsConfig, resolveAssistantQueueConfig } from '../../../../packages/im/agent/src/assistant/config.js';
import { resolveAssistantHomeConfig } from '../../../../packages/im/agent/src/assistant/home-config.js';
import { normalizeAiRoutingConfig } from '../../../../packages/im/agent/src/config/normalize-ai-config.js';
import { resolvePerceptionConfig } from '../../../../packages/im/agent/src/config/perception-config.js';
import { resolveRecallOptions } from '../../../../packages/im/agent/src/memory/semantic-recall.js';
import { createSpeechPipeline } from '../../../../packages/toolkit/speech/src/pipeline.js';
import { resolveAgentHostMcpServers } from '../../src/plugin-runtime/agent/config.js';
import { resolveHttpConfig } from '../../src/plugin-runtime/http-host-installer.js';

describe('Host schema null compatibility with actual configuration consumers', () => {
  it('keeps explicit null MCP entries and Assistant queue blocks accepted by the existing resolvers', () => {
    const input = { ai: { mcpServers: null }, assistant: { queue: null } };
    expect(parsePluginConfigSchema(HOST_CONFIG_SCHEMA, input)).toEqual({ value: input, errors: [] });
    expect(resolveAgentHostMcpServers(input.ai as never)).toEqual([]);
    expect(resolveAssistantQueueConfig(input.assistant.queue as never)).toEqual({
      maxConcurrency: 3, maxRetries: 2, defaultTimeoutMs: 120_000,
    });
  });

  it('retains the nullish defaults of the actual AI routing, perception and recall helpers', () => {
    const ai = { providers: null, agents: null, mcpServers: null, multimodal: { perception: null }, memory: { semantic: { recall: null } } };
    expect(parsePluginConfigSchema(HOST_CONFIG_SCHEMA, { ai }).errors).toEqual([]);
    expect(normalizeAiRoutingConfig(ai as never)).toEqual({ providers: {}, agents: {}, mcpServerNames: [] });
    expect(normalizeAiRoutingConfig({ providers: { unused: null }, agents: {} } as never).providers).toEqual({});
    expect(resolvePerceptionConfig(ai.multimodal.perception)).toBeUndefined();
    expect(resolveRecallOptions(ai.memory.semantic.recall as never)).toEqual(resolveRecallOptions(undefined));
  });

  it('retains Assistant nested nullish defaults without resolving credentials or loading files', () => {
    const queue = { maxConcurrency: null, maxRetries: null, defaultTimeoutMs: null };
    const home = { aliases: null, watch: null, policy: { confirmServices: null, allowedServiceDomains: null }, debounceMs: null };
    expect(parsePluginConfigSchema(HOST_CONFIG_SCHEMA, { assistant: { queue, home, defaults: null, events: null } }).errors).toEqual([]);
    expect(resolveAssistantQueueConfig(queue as never)).toEqual(resolveAssistantQueueConfig(undefined));
    expect(resolveAssistantHomeConfig(home as never)).toEqual(resolveAssistantHomeConfig(undefined));
    expect(resolveAssistantDefaultsConfig(null as never)).toEqual(resolveAssistantDefaultsConfig(undefined));
    expect(resolveAssistantEventsConfig(null as never)).toEqual(resolveAssistantEventsConfig(undefined));
  });

  it('retains null Speech blocks through the actual pipeline merge without synthesis or transcription', () => {
    const input = { speech: { stt: null, tts: null } };
    expect(parsePluginConfigSchema(HOST_CONFIG_SCHEMA, input).errors).toEqual([]);
    const pipeline = createSpeechPipeline(input.speech as never);
    expect(pipeline.transcribe).toBeTypeOf('function');
    expect(pipeline.synthesize).toBeTypeOf('function');
  });

  it('retains null HTTP optional inputs as omitted without opening a server or reading TLS files', async () => {
    const input = { http: { host: null, port: null, token: null, tokens: null, corsOrigins: null, base: null } };
    expect(parsePluginConfigSchema(HOST_CONFIG_SCHEMA, input).errors).toEqual([]);
    const resolved = await resolveHttpConfig(input, {}, '/unused-fixture');
    expect(resolved).toEqual({ host: undefined, port: undefined, token: undefined, tokens: undefined, corsOrigins: undefined, apiBase: undefined, tls: undefined });
    const partial = { http: { tokens: [null, { token: null }, { token: 'fixture', scope: null, principalId: null }], corsOrigins: [null, 'https://fixture.invalid'] } };
    expect(parsePluginConfigSchema(HOST_CONFIG_SCHEMA, partial).errors).toEqual([]);
    expect(await resolveHttpConfig(partial, {}, '/unused-fixture')).toMatchObject({ tokens: [{ token: 'fixture', scope: 'demo' }], corsOrigins: ['https://fixture.invalid'] });
  });
});
