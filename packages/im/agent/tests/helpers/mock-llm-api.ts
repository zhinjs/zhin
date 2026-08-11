/**
 * Test helper — ai-sdk 原生面 mock：直接注册 `ai-sdk` ApiProvider，把应答器
 * 产出的 AssistantMessage 经 createAssistantMessageEventStream 回流给 agentLoop，
 * 测试链路走真实的 ai-sdk stream 转换路径（原 OpenAI wire 测试桥已退役）。
 * 断言面：calls[] 的 model/context（AgentMessage 层）。
 */
import {
  createAssistantMessageEventStream,
  registerApiProvider,
  registerProviderInstance,
  setLiveModelsResolver,
  EMPTY_TOKEN_USAGE,
  SdkProviderAdapter,
  type AssistantMessage,
  type Context,
  type Model,
} from '@zhin.js/ai';

export interface MockLlmCall {
  readonly model: Model;
  readonly context: Context;
}

export type MockLlmResponder = (context: Context) => AssistantMessage | Promise<AssistantMessage>;

export interface MockLlmApi {
  readonly provider: SdkProviderAdapter;
  readonly calls: MockLlmCall[];
  respondWith(next: MockLlmResponder): void;
  respondText(text: string): void;
  /** 永不返回（模拟挂起的长任务）。 */
  hang(): void;
  fail(error: Error): void;
}

export function assistantTextReply(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'ai-sdk',
    provider: 'mock',
    model: 'mock',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

export function assistantToolCallReply(
  toolCalls: ReadonlyArray<{ id: string; name: string; arguments: Record<string, unknown> }>,
  text = '',
): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (text) content.push({ type: 'text', text });
  for (const call of toolCalls) content.push({ type: 'toolCall', ...call });
  return {
    role: 'assistant',
    content,
    api: 'ai-sdk',
    provider: 'mock',
    model: 'mock',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: 'toolCalls',
    timestamp: Date.now(),
  };
}

export function wireMockLlmApi(options: {
  name?: string;
  models?: readonly string[];
  responder?: MockLlmResponder;
} = {}): MockLlmApi {
  const name = options.name ?? 'mock';
  const models = [...(options.models ?? ['mock-model'])];
  const provider = new SdkProviderAdapter(name, 'openai', { sdk: 'openai', apiKey: 'test-key' }, models);
  registerProviderInstance(name, { sdk: 'openai', apiKey: 'test-key' }, models);
  setLiveModelsResolver((alias) => (alias === name ? [...models] : []));

  const calls: MockLlmCall[] = [];
  let responder: MockLlmResponder = options.responder ?? (() => assistantTextReply('ok'));
  const streamFn = (model: Model, context: Context) =>
    createAssistantMessageEventStream(async (push) => {
      calls.push({ model, context });
      const message = await responder(context);
      const text = message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      if (text) push({ type: 'text_delta', text });
      return message;
    });
  registerApiProvider({ api: 'ai-sdk', stream: streamFn, streamSimple: streamFn });

  return {
    provider,
    calls,
    respondWith(next) { responder = next; },
    respondText(text) { responder = () => assistantTextReply(text); },
    hang() { responder = () => new Promise<AssistantMessage>(() => {}); },
    fail(error) { responder = () => { throw error; }; },
  };
}
