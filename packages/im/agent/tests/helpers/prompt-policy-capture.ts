import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type StreamOptions } from '@zhin.js/ai';
import { estimatePromptTokens } from '../../src/prompt/estimate-tokens.js';
import { wireMockLlmApi } from './mock-llm-api.js';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const measure = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { chars: text.length, estimatedTokens: estimatePromptTokens(text), sha256: createHash('sha256').update(text).digest('hex') };
};

/** L1 capture: the actual ApiProvider entry. No provider configuration or Zod objects are exported. */
export function capturePromptRequests(respond: (request: Context, index: number) => AssistantMessage | Promise<AssistantMessage>) {
  const llm = wireMockLlmApi({ models: ['synthetic-model'] });
  const requests: Array<ReturnType<typeof snapshot>> = [];
  const stream = (model: Model, context: Context, options?: StreamOptions) => createAssistantMessageEventStream(async push => {
    // Copy now: agentLoop may subsequently mutate this very messages array.
    requests.push(snapshot(model, context, options));
    const response = await respond(context, requests.length - 1);
    const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (text) push({ type: 'text_delta', text });
    return response;
  });
  llm.runtime.registerApiProvider({ api: 'ai-sdk', stream, streamSimple: stream });
  return { ...llm, requests };
}

function snapshot(model: Model, context: Context, options?: StreamOptions) {
  const messages = copy(context.messages);
  const tools = (context.tools ?? []).map(tool => ({ name: tool.name, description: tool.description,
    ...(tool.inputJsonSchema ? { inputJsonSchema: copy(tool.inputJsonSchema) } : { inputJsonSchema: null }),
    ...(tool.deferLoading !== undefined ? { deferLoading: tool.deferLoading } : {}),
  }));
  const runtime = messages.flatMap(message => 'content' in message && Array.isArray(message.content)
    ? message.content.filter(block => 'perTurn' in block && block.perTurn === true) : []);
  const body = messages.map(message => 'content' in message && Array.isArray(message.content)
    ? { ...message, content: message.content.filter(block => !('perTurn' in block) || block.perTurn !== true) } : message);
  const outputSchema = options?.outputSchema ? copy(options.outputSchema) : undefined;
  const system = context.systemPrompt ?? '';
  return {
    model: { id: model.id, provider: model.provider, api: model.api, sdk: model.sdk },
    system, ...(context.systemPromptCacheBreakpoint !== undefined ? { cacheBreakpoint: context.systemPromptCacheBreakpoint } : {}),
    messages, tools,
    options: { ...(outputSchema ? { outputSchema } : {}),
      ...(options?.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.promptCache !== undefined ? { promptCache: options.promptCache } : {}),
      ...(options?.promptCacheKey !== undefined ? { promptCacheKey: options.promptCacheKey } : {}),
      ...(options?.promptCacheRetention !== undefined ? { promptCacheRetention: options.promptCacheRetention } : {}),
    },
    // `messages` is complete evidence above. Its metric below excludes the blocks measured as runtime.
    metrics: { system: measure(system), messages: measure(body), runtime: measure(runtime),
      schemas: measure({ tools, ...(outputSchema ? { outputSchema } : {}) }),
      toolCount: tools.length, runtimeBlockCount: runtime.length, messageCount: messages.length,
      schemasMissingAtL1: tools.filter(tool => tool.inputJsonSchema === null).map(tool => tool.name) },
  };
}

/** Optional external synthetic artifact; normal test runs do not write snapshots into the repository. */
export async function savePromptRequests(name: string, requests: ReturnType<typeof capturePromptRequests>['requests']) {
  const directory = process.env.ZHIN_PROMPT_POLICY_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), `${JSON.stringify({
    captureLayer: 'L1 actual ApiProvider context; provider response mocked',
    evidence: 'Synthetic assembly/authority evidence, not real-model behavior, network or billing evidence',
    metricMethod: 'CJK-aware estimatePromptTokens. Messages metric excludes perTurn blocks; runtime measures those blocks once. Schemas use inputJsonSchema, never Zod parameters. L1 missing schemas remain unknown until SDK capture. Final SDK cache_control/providerOptions are not observed at L1.',
    requests,
  }, null, 2)}\n`);
}
