import { createRequire } from 'node:module';
import type { ImageModel, LanguageModel } from 'ai';
import type { OpenAiCompatFlags } from '../llm/types/model.js';
import { isGroqGateway, transformGroqRequestBody } from '../llm/groq.js';

const requirePeer = createRequire(import.meta.url);

import type { SdkFamily } from './sdk-family.js';

function peer<T>(name: string): T {
  let resolved: string;
  try { resolved = requirePeer.resolve(name); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Install the Provider's optional SDK dependency: ${name}`);
    }
    throw error;
  }
  return requirePeer(resolved) as T;
}

export interface SdkModelInput {
  readonly family: SdkFamily;
  readonly api?: string;
  readonly model: string;
  readonly baseUrl: string;
  /** Only a real grant obtained for this call; never an environment fallback or placeholder. */
  readonly token?: string;
  readonly bearer?: boolean;
  readonly compat?: OpenAiCompatFlags;
  readonly fetch: typeof globalThis.fetch;
}

export function languageModel(input: SdkModelInput): LanguageModel {
  const common = { baseURL: input.baseUrl, fetch: input.fetch };
  switch (input.family) {
    case 'openai': {
      const { createOpenAI } = peer<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
      const provider = createOpenAI({ ...common, apiKey: input.token });
      return input.api === 'responses' ? provider.responses(input.model) : provider.chat(input.model);
    }
    case 'anthropic': {
      const { createAnthropic } = peer<typeof import('@ai-sdk/anthropic')>('@ai-sdk/anthropic');
      return createAnthropic({ ...common, ...(input.bearer ? { authToken: input.token } : { apiKey: input.token }) })(input.model);
    }
    case 'google': {
      const { createGoogleGenerativeAI } = peer<typeof import('@ai-sdk/google')>('@ai-sdk/google');
      return createGoogleGenerativeAI({ ...common, apiKey: input.token })(input.model);
    }
    case 'deepseek': {
      const { createDeepSeek } = peer<typeof import('@ai-sdk/deepseek')>('@ai-sdk/deepseek');
      return createDeepSeek({ ...common, apiKey: input.token })(input.model);
    }
    case 'minimax': {
      const { createMiniMax } = peer<typeof import('@ai-sdk/minimax')>('@ai-sdk/minimax');
      return createMiniMax({ ...common, apiKey: input.token })(input.model);
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = peer<typeof import('@ai-sdk/openai-compatible')>('@ai-sdk/openai-compatible');
      return createOpenAICompatible({ ...common, name: 'openai-compatible', apiKey: input.token,
        includeUsage: input.compat?.includeUsage !== false,
        ...(isGroqGateway(undefined, input.baseUrl) ? { transformRequestBody: transformGroqRequestBody } : {}),
      })(input.model);
    }
  }
}

export function imageModel(input: SdkModelInput): ImageModel | undefined {
  const common = { baseURL: input.baseUrl, fetch: input.fetch, apiKey: input.token };
  if (input.family === 'openai') {
    const { createOpenAI } = peer<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
    return createOpenAI(common).image(input.model);
  }
  if (input.family === 'google') {
    const { createGoogleGenerativeAI } = peer<typeof import('@ai-sdk/google')>('@ai-sdk/google');
    return createGoogleGenerativeAI(common).image(input.model);
  }
  if (input.family === 'openai-compatible') {
    const { createOpenAICompatible } = peer<typeof import('@ai-sdk/openai-compatible')>('@ai-sdk/openai-compatible');
    return createOpenAICompatible({ ...common, name: 'openai-compatible' }).imageModel(input.model);
  }
  return undefined;
}
