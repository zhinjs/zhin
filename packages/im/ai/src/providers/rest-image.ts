import type { ProviderCreateExecutionOptions, ProviderExecution } from '../provider/driver.js';
import type { StandardModelParameters, StandardServiceOptions } from './schema.js';
import { withResponseHeaderTimeout } from '../llm/response-header-timeout.js';
import { ProviderResponseError } from '../llm/provider-error-facts.js';
import { classifyProviderError } from '../llm/provider-resilience.js';
import { ProviderProtocolError } from './sdk-execution.js';

/** Existing image-only REST protocols. Paid requests are not automatically replayed. */
export function restImageExecution(input: ProviderCreateExecutionOptions<StandardServiceOptions, StandardModelParameters>,
  configuration: { readonly protocol: 'minimax' | 'cloudflare'; readonly endpoint: string }): ProviderExecution {
  const callRequests = new Set<Request>();
  return { dispose() { callRequests.clear(); }, image: { async generate({ request, signal }) {
    if (configuration.protocol === 'minimax' && !request.prompt.trim()) throw new Error('MiniMax image generation requires prompt');
    const parameters = input.binding.profile.parameters, defaults = parameters.imageGeneration;
    if (parameters.temperature !== undefined || parameters.maxOutputTokens !== undefined || parameters.thinkingLevel !== undefined
      || parameters.chunkTimeoutMs !== undefined || parameters.safetySettings !== undefined
      || parameters.maxRetries !== undefined && parameters.maxRetries !== 0
      || defaults?.background !== undefined
      || request.quality !== undefined || defaults?.quality !== undefined
      || request.imageSize !== undefined || defaults?.imageSize !== undefined
      || request.watermarkEnabled !== undefined || defaults?.watermarkEnabled !== undefined) throw new ProviderProtocolError('unsupported-parameter');
    const combined = AbortSignal.any([input.signal, signal,
      ...(parameters.requestTimeoutMs ? [AbortSignal.timeout(parameters.requestTimeoutMs)] : [])]);
    combined.throwIfAborted();
    const prompt = defaults?.promptSuffix ? `${request.prompt}\n${defaults.promptSuffix}` : request.prompt;
    const body: Record<string, unknown> = { prompt };
    if (configuration.protocol === 'minimax') {
      if (request.numSteps !== undefined || defaults?.numSteps !== undefined) throw new ProviderProtocolError('unsupported-parameter');
      body.model = input.binding.model.id; body.response_format = 'base64'; body.prompt = prompt.slice(0, 1500);
      const ratio = request.aspectRatio ?? defaults?.aspectRatio;
      if (ratio) body.aspect_ratio = ratio;
      const size = request.size ?? defaults?.defaultSize;
      if (size) {
        const match = /^(\d+)x(\d+)$/.exec(size);
        if (!match || input.binding.model.id !== 'image-01') throw new ProviderProtocolError('unsupported-parameter');
        body.width = Number(match[1]); body.height = Number(match[2]);
      }
    } else {
      if (request.size !== undefined || defaults?.defaultSize !== undefined || request.aspectRatio !== undefined || defaults?.aspectRatio !== undefined) throw new ProviderProtocolError('unsupported-parameter');
      body.num_steps = request.numSteps ?? defaults?.numSteps ?? 4;
    }
    const grant = await input.credentials.authorize({ target: new URL(configuration.endpoint), signal: combined });
    if (!grant.token) throw new ProviderProtocolError('invalid-credential');
    const fetch = withResponseHeaderTimeout(input.fetch, parameters.firstChunkTimeoutMs) ?? input.fetch;
    const transportRequest = new Request(configuration.endpoint, { method: 'POST', signal: combined,
      headers: { ...input.binding.service.options.headers, ...grant.headers,
        authorization: input.binding.service.options.authScheme === undefined ? `Bearer ${grant.token}`
          : [input.binding.service.options.authScheme, grant.token].filter(Boolean).join(' '), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const boundRequest = input.credentials.bindRequest({ grant, request: transportRequest });
    callRequests.add(transportRequest); callRequests.add(boundRequest);
    const response = await fetch(boundRequest);
    if (!response.ok) throw new ProviderResponseError(classifyProviderError({ statusCode: response.status, responseHeaders: Object.fromEntries(response.headers) }));
    let value: unknown;
    try { value = await response.json(); } catch (error) {
      if (error instanceof SyntaxError) throw new ProviderProtocolError('invalid-response');
      throw error;
    }
    if (!value || typeof value !== 'object') throw new ProviderProtocolError('invalid-response');
    let base64: unknown;
    if (configuration.protocol === 'minimax') {
      const record = value as { base_resp?: { status_code?: number }; data?: { image_base64?: unknown[] } };
      if (record.base_resp?.status_code) throw new ProviderProtocolError('invalid-response');
      base64 = record.data?.image_base64?.[0];
    } else {
      const record = value as { success?: boolean; result?: { image?: unknown } };
      if (record.success === false) throw new ProviderProtocolError('invalid-response');
      base64 = record.result?.image;
    }
    if (typeof base64 !== 'string' || !base64) throw new ProviderProtocolError('invalid-response');
    return { mimeType: 'image/png', base64, model: input.binding.model.id };
  } } };
}
