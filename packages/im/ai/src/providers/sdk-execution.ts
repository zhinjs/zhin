import { createHash } from 'node:crypto';
import { APICallError, RetryError, generateImage, type JSONValue } from 'ai';
import type { CredentialGrant, ProviderCreateExecutionOptions, ProviderExecution } from '../provider/driver.js';
import type { LanguageRequest } from '../provider/types.js';
import type { Model } from '../llm/types/model.js';
import { resolveEffectiveOutputTokens } from '../llm/llm-api-runtime.js';
import { generateTextViaAiSdk, streamViaAiSdk } from '../llm/bridge/ai-sdk-stream.js';
import { createGeminiCachingFetch, createGeminiContextCacheState, type GeminiContextCacheState } from '../llm/gemini-context-cache.js';
import { createProviderResourceKey } from '../provider/resources.js';
import { withResponseHeaderTimeout } from '../llm/response-header-timeout.js';
import { normalizeAnthropicBaseUrl, normalizeGoogleBaseUrl, normalizeOpenAiCompatibleBaseUrl, normalizeMiniMaxBaseUrl, withoutEndpointQuery } from '../llm/sdk-endpoints.js';
import { imageModel, languageModel } from './sdk-models.js';
import type { SdkFamily } from './sdk-family.js';
import { ProviderProtocolError } from './errors.js';
export { ProviderProtocolError } from './errors.js';
import { modelParameterShape, type StandardModelParameters, type StandardServiceOptions } from './schema.js';
import { ProviderResponseError } from '../llm/provider-error-facts.js';
import { classifyProviderError } from '../llm/provider-resilience.js';
import { ProviderStreamError } from '../llm/bridge/stream-error.js';


export function providerSessionId(input: ProviderCreateExecutionOptions<unknown, unknown>): string {
  if (!input.context.sessionKey) throw new ProviderProtocolError('missing-call-context');
  return createHash('sha256').update(JSON.stringify([
    input.context.rootId, input.context.ownerId,
    input.binding.service.id, input.binding.account.id, input.binding.account.incarnation,
    input.context.sessionKey, input.context.epoch ?? null,
  ])).digest('hex');
}

export interface SdkExecutionConfiguration {
  readonly family: SdkFamily;
  /** Internal protocol selection, not a Model/Profile capability or user option. */
  readonly toolCallReasoning?: Model['toolCallReasoning'];
  readonly api?: string;
  readonly bearer?: boolean;
  readonly noAuthentication?: boolean;
  readonly credentialTarget?: string;
  readonly sessionHeader?: string;
  readonly image?: boolean;
  readonly forceStreamingGeneration?: boolean;
  readonly promptCacheRouting?: 'driver';
  /** Native API-key drivers keep their existing proxy-root normalization. */
  readonly normalizeEndpoint?: boolean;
  readonly providerOptions?: Record<string, Record<string, JSONValue>>;
  readonly headers?: (grant: CredentialGrant) => Readonly<Record<string, string>>;
  readonly validateRequest?: (request: LanguageRequest) => void;
  readonly prepareRequest?: (input: Readonly<{
    request: Request;
    body: Record<string, unknown>;
    sessionId?: string;
    grant: CredentialGrant;
  }>) => Promise<Readonly<{ url: string; body: Record<string, unknown> }>> | Readonly<{ url: string; body: Record<string, unknown> }>;
  readonly prepareResponse?: (response: Response) => Response;
}

const STRUCTURED_CONTENT_TYPE = /json|event-stream|x-protobuf|octet-stream|^image\/|^audio\//u;
const SNIFF_LIMIT = 512;

/**
 * A 2xx answer to a model request that is not JSON / an event stream (for example a
 * site's HTML home page when the service address lacks `/v1`) fails clearly instead
 * of as an opaque SDK parse error (#1250 service-baseurl-immutable). Only untyped or
 * text answers are sniffed; JSON and streams pass untouched.
 */
export async function assertStructuredResponse(response: Response): Promise<void> {
  if (!response.ok || response.status === 204) return;
  const type = (response.headers.get('content-type') ?? '').toLowerCase().trim();
  if (type.includes('html')) throw nonJsonResponse(response);
  if (STRUCTURED_CONTENT_TYPE.test(type)) return;
  if (type && !type.startsWith('text/')) return;
  if (!response.body) return;
  let head = '';
  try {
    const reader = response.clone().body!.getReader();
    try {
      const decoder = new TextDecoder();
      while (head.length < SNIFF_LIMIT) {
        const chunk = await reader.read();
        if (chunk.done) break;
        head += decoder.decode(chunk.value, { stream: true });
        if (head.trimStart().length > 0) break;
      }
    } finally {
      // A tee branch's cancel settles only once both branches are done: never await it.
      void reader.cancel().catch(() => undefined);
    }
  } catch {
    return;
  }
  if (head.trimStart().startsWith('<')) throw nonJsonResponse(response);
}

function nonJsonResponse(response: Response): ProviderResponseError {
  return new ProviderResponseError({ kind: 'non_json_response', retryable: false, status: response.status });
}

const authenticationHeaders = ['authorization', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'api-key'];
const explicitGeminiCache = createProviderResourceKey<GeminiContextCacheState>('google.explicit-cache-directory');
function safeSdkError(error: unknown): unknown {
  return APICallError.isInstance(error) || RetryError.isInstance(error) || error instanceof ProviderStreamError
    ? new ProviderResponseError(classifyProviderError(error)) : error;
}

export function sdkExecution(
  input: ProviderCreateExecutionOptions<StandardServiceOptions, StandardModelParameters>,
  configuration: SdkExecutionConfiguration,
): ProviderExecution {
  const service = input.binding.service.options;
  const parameters = input.binding.profile.parameters;
  // Request objects own their followed signal linkage in Node. Keep transport
  // ownership through response consumption, then release with this execution.
  const callRequests = new Set<Request>();
  const plainBaseUrl = withoutEndpointQuery(service.baseUrl);
  const baseUrl = !configuration.normalizeEndpoint ? plainBaseUrl
    : configuration.family === 'openai' || configuration.family === 'openai-compatible'
      ? normalizeOpenAiCompatibleBaseUrl(plainBaseUrl, service.compat?.appendV1)
      : configuration.family === 'anthropic' ? normalizeAnthropicBaseUrl(plainBaseUrl)!
        : configuration.family === 'google' ? normalizeGoogleBaseUrl(plainBaseUrl)!
          : configuration.family === 'minimax' ? normalizeMiniMaxBaseUrl(plainBaseUrl)!
            : plainBaseUrl;

  function modelMetadata(): Model {
    return {
      id: input.binding.model.id,
      provider: input.binding.service.id,
      api: 'ai-sdk', sdk: configuration.family,
      ...(configuration.promptCacheRouting ? { promptCacheRouting: configuration.promptCacheRouting } : {}),
      input: [...(input.binding.model.input ?? ['text'])],
      reasoning: input.binding.model.thinking,
      toolCallReasoning: configuration.toolCallReasoning
        ?? (configuration.family === 'deepseek' || configuration.family === 'openai-compatible' ? 'openai-content' : 'provider-native'),
      contextWindow: input.binding.model.contextWindow ?? 0,
      maxTokens: resolveEffectiveOutputTokens({ configured: parameters.maxOutputTokens, declared: input.binding.model.maxOutputTokens }),
      ...(parameters.thinkingLevel ? { thinkingLevel: parameters.thinkingLevel } : {}),
      ...(service.compat ? { compat: service.compat } : {}),
      ...(configuration.providerOptions || parameters.safetySettings ? { providerOptions: {
        ...configuration.providerOptions,
        ...(parameters.safetySettings ? { google: { ...configuration.providerOptions?.google, safetySettings: [...parameters.safetySettings] } } : {}),
      } } : {}),
      ...(parameters.firstChunkTimeoutMs || parameters.chunkTimeoutMs ? { streamTimeout: {
        ...(parameters.firstChunkTimeoutMs ? { firstChunkMs: parameters.firstChunkTimeoutMs } : {}),
        ...(parameters.chunkTimeoutMs ? { chunkMs: parameters.chunkTimeoutMs } : {}),
      } } : {}),
    };
  }

  async function prepare(signal: AbortSignal, requestTimeoutMs = parameters.requestTimeoutMs, onResponseStart?: () => void) {
    modelParameterShape.shape.requestTimeoutMs.parse(requestTimeoutMs);
    const combined = AbortSignal.any([
      input.signal, signal,
      ...(requestTimeoutMs ? [AbortSignal.timeout(requestTimeoutMs)] : []),
    ]);
    combined.throwIfAborted();
    const sessionId = configuration.sessionHeader || configuration.prepareRequest ? providerSessionId(input) : undefined;
    const first = await input.credentials.authorize({ target: new URL(configuration.credentialTarget ?? plainBaseUrl), signal: combined });
    if (!configuration.noAuthentication && !first.token) throw new ProviderProtocolError('invalid-credential');
    const fetch: typeof globalThis.fetch = async (url, init) => {
      if (url instanceof Request) callRequests.add(url);
      const original = new Request(url, init);
      // The SDK already combines the call signal with its own cancellation and timers.
      // Reuse that source instead of introducing unowned intermediate followers.
      const requestSignal = init?.signal ?? (url instanceof Request ? url.signal : combined);
      requestSignal.throwIfAborted();
      let target = original.url;
      let body: BodyInit | undefined;
      if (configuration.prepareRequest && original.method === 'POST') {
        const value: unknown = await original.clone().json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderProtocolError('invalid-response');
        const prepared = await configuration.prepareRequest({ request: original, body: value as Record<string, unknown>, sessionId, grant: first });
        target = prepared.url;
        body = JSON.stringify(prepared.body);
      }
      const targetUrl = new URL(target);
      for (const [key, value] of new URL(service.baseUrl).searchParams) if (!targetUrl.searchParams.has(key)) targetUrl.searchParams.append(key, value);
      target = targetUrl.href;
      const grant = await input.credentials.authorize({ target: targetUrl, signal: requestSignal });
      const headers = new Headers(original.headers);
      for (const [name, value] of Object.entries(service.headers ?? {})) headers.set(name, value);
      for (const [name, value] of Object.entries(grant.headers)) headers.set(name, value);
      for (const name of authenticationHeaders) headers.delete(name);
      if (!configuration.noAuthentication) {
        if (!grant.token) throw new ProviderProtocolError('invalid-credential');
        const nativeHeader = configuration.bearer || service.authScheme !== undefined ? undefined
          : configuration.family === 'anthropic' ? 'x-api-key'
            : configuration.family === 'google' ? 'x-goog-api-key' : undefined;
        headers.set(nativeHeader ?? 'authorization', nativeHeader ? grant.token
          : service.authScheme !== undefined ? [service.authScheme, grant.token].filter(Boolean).join(' ') : `Bearer ${grant.token}`);
      }
      if (configuration.sessionHeader && sessionId) headers.set(configuration.sessionHeader, sessionId);
      for (const [name, value] of Object.entries(configuration.headers?.(grant) ?? {})) headers.set(name, value);
      const request = new Request(target, {
        method: original.method, headers, signal: requestSignal,
        ...(original.method === 'GET' || original.method === 'HEAD' ? {} : { body: body ?? await original.arrayBuffer() }),
      });
      const boundRequest = input.credentials.bindRequest({ grant, request });
      callRequests.add(request); callRequests.add(boundRequest);
      const response = await input.fetch(boundRequest);
      // First byte from the provider: the caller's first-response deadline is met.
      try { onResponseStart?.(); } catch { /* an observer cannot change the transport outcome */ }
      return configuration.prepareResponse?.(response) ?? response;
    };
    let transport = withResponseHeaderTimeout(fetch, parameters.firstChunkTimeoutMs) ?? fetch;
    if (service.contextCache?.mode === 'explicit') {
      if (configuration.family !== 'google') throw new ProviderProtocolError('unsupported-parameter');
      const state = input.resources.getOrCreate({ key: explicitGeminiCache, create: () => {
        const value = createGeminiContextCacheState();
        return { value, dispose() {
          value.entries.clear(); value.currentKeyByModel.clear(); value.unsupported.clear(); value.logged.clear();
        } };
      } });
      transport = createGeminiCachingFetch({ config: service.contextCache, fetch: transport, state });
    }
    // Checked at the outermost layer: auxiliary requests (context caches) handle their own answers.
    const inner = transport;
    const checked: typeof globalThis.fetch = async (url, init) => {
      const response = await inner(url, init);
      await assertStructuredResponse(response);
      return response;
    };
    return { combined, token: first.token, fetch: checked };
  }

  async function call(request: LanguageRequest, signal: AbortSignal) {
    configuration.validateRequest?.(request);
    if (parameters.imageGeneration !== undefined) throw new ProviderProtocolError('unsupported-parameter');
    if (parameters.safetySettings && configuration.family !== 'google') throw new ProviderProtocolError('unsupported-parameter');
    const { combined, token, fetch } = await prepare(signal, request.options?.requestTimeoutMs, request.options?.onResponseStart);
    const model = languageModel({
      family: configuration.family, api: configuration.api, model: input.binding.model.id,
      baseUrl, token, fetch, bearer: configuration.bearer, compat: service.compat,
    });
    const options = {
      ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
      ...(parameters.thinkingLevel ? { thinkingLevel: parameters.thinkingLevel } : {}),
      ...(parameters.maxRetries !== undefined ? { maxRetries: parameters.maxRetries } : {}),
      ...request.options, signal: combined,
    };
    return { model, metadata: modelMetadata(), options };
  }

  async function* stream(request: LanguageRequest, signal: AbortSignal) {
    try {
      const prepared = await call(request, signal);
      yield* streamViaAiSdk(prepared.model, prepared.metadata, request.context, prepared.options);
    } catch (error) { throw safeSdkError(error); }
  }

  return {
    dispose() { callRequests.clear(); },
    ...(input.binding.model.kinds.includes('language') ? { language: {
      async stream({ request, signal }) { return stream(request, signal); },
      async generate({ request, signal }) {
        try {
          if (!configuration.forceStreamingGeneration) {
            const prepared = await call(request, signal);
            return await generateTextViaAiSdk(prepared.model, prepared.metadata, request.context, prepared.options);
          }
          for await (const event of await stream(request, signal)) {
            if (event.type === 'text_delta' && event.text) request.options?.onTextDelta?.(event.text);
            if (event.type === 'done' && event.message) return event.message;
            if (event.type === 'error') throw event.error ?? new ProviderProtocolError('invalid-response');
          }
          throw new ProviderProtocolError('invalid-response');
        } catch (error) { throw safeSdkError(error); }
      },
    } } : {}),
    ...(configuration.image && input.binding.model.kinds.includes('image') ? { image: {
      async generate({ request, signal }) {
        const defaults = parameters.imageGeneration;
        if (parameters.temperature !== undefined || parameters.maxOutputTokens !== undefined || parameters.thinkingLevel !== undefined
          || parameters.chunkTimeoutMs !== undefined || parameters.safetySettings !== undefined) throw new ProviderProtocolError('unsupported-parameter');
        const quality = request.quality ?? defaults?.quality;
        const imageSize = request.imageSize ?? defaults?.imageSize;
        const watermark = request.watermarkEnabled ?? defaults?.watermarkEnabled;
        const size = request.size ?? defaults?.defaultSize;
        const ratio = request.aspectRatio ?? defaults?.aspectRatio;
        if (request.numSteps !== undefined || defaults?.numSteps !== undefined
          || quality !== undefined && configuration.family !== 'openai' && configuration.family !== 'openai-compatible'
          || imageSize !== undefined && configuration.family !== 'google'
          || watermark !== undefined && configuration.family !== 'openai-compatible'
          || defaults?.background !== undefined && configuration.family !== 'openai' && configuration.family !== 'openai-compatible'
          || ratio !== undefined && configuration.family !== 'google'
          || size !== undefined && configuration.family === 'google') throw new ProviderProtocolError('unsupported-parameter');
        if (size && !/^\d+x\d+$/.test(size)) throw new ProviderProtocolError('unsupported-parameter');
        if (ratio && !/^\d+:\d+$/.test(ratio)) throw new ProviderProtocolError('unsupported-parameter');
        const { combined, token, fetch } = await prepare(signal);
        const model = imageModel({ family: configuration.family, model: input.binding.model.id, baseUrl, token, fetch });
        if (!model) throw new ProviderProtocolError('unsupported-parameter');
        const providerOptions: NonNullable<Record<string, Record<string, JSONValue>>> = {};
        const namespace = configuration.family === 'openai-compatible' ? 'openaiCompatible' : configuration.family;
        providerOptions[namespace] = {
          ...providerOptions[namespace],
          ...(quality !== undefined ? { quality } : {}),
          ...(defaults?.background !== undefined ? { background: defaults.background } : {}),
          ...(watermark !== undefined ? { watermark_enabled: watermark } : {}),
          ...(configuration.family === 'google' && (imageSize || ratio) ? { imageConfig: {
            ...providerOptions.google?.imageConfig && typeof providerOptions.google.imageConfig === 'object' ? providerOptions.google.imageConfig : {},
            ...(imageSize ? { imageSize } : {}), ...(ratio ? { aspectRatio: ratio } : {}),
          } } : {}),
        };
        let result;
        try { result = await generateImage({
          model, prompt: defaults?.promptSuffix ? `${request.prompt}\n${defaults.promptSuffix}` : request.prompt,
          abortSignal: combined, providerOptions,
          ...(parameters.maxRetries !== undefined ? { maxRetries: parameters.maxRetries } : {}),
          ...(size ? { size: size as `${number}x${number}` } : {}),
          ...(ratio ? { aspectRatio: ratio as `${number}:${number}` } : {}),
        }); } catch (error) { throw safeSdkError(error); }
        return { mimeType: result.image.mediaType, base64: result.image.base64, model: input.binding.model.id };
      },
    } } : {}),
  };
}
