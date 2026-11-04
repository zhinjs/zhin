import { randomUUID } from 'node:crypto';
import { defineProvider, type ProviderSchema } from '../provider/driver.js';
import type { ModelDefinition, ProviderService } from '../provider/types.js';
import { declaredModels, modelContracts } from './api-key.js';
import { antigravityOAuth } from './oauth.js';
import { sdkProfileSchema, fixedServiceSchema, type FixedServiceOptions, type StandardModelParameters } from './schema.js';
import { ProviderProtocolError, sdkExecution } from './sdk-execution.js';
import { executionTraits, serviceIdentity } from './traits.js';
import { EXPERIMENTAL_SUBSCRIPTION_NOTICE } from './support.js';

const baseUrl = 'https://daily-cloudcode-pa.googleapis.com';
const protocols = [{ name: 'antigravity-generate-content', kind: 'language' }, { name: 'antigravity-images', kind: 'image' }] as const;
function profileSchema({ model }: Readonly<{ service: ProviderService<FixedServiceOptions>; model: ModelDefinition }>): ProviderSchema<StandardModelParameters> {
  if (!protocols.some(protocol => protocol.name === model.protocol && model.kinds.every(kind => kind === protocol.kind))) throw new Error('Invalid Profile protocol');
  return sdkProfileSchema({ family: 'google', model });
}

/** The gateway wraps native Google replies. Never invent signatures or rewrite personas. */
function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('response' in value)) throw new ProviderProtocolError('invalid-response');
  return value.response;
}

function unwrapResponse(response: Response): Response {
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  if (!headers.get('content-type')?.includes('text/event-stream')) {
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      try { controller.enqueue(new TextEncoder().encode(JSON.stringify(unwrap(await response.json())))); controller.close(); }
      catch (error) { controller.error(error); }
    }, cancel(reason) { return response.body?.cancel(reason); } });
    return new Response(body, { status: response.status, headers });
  }
  if (!response.body) throw new ProviderProtocolError('invalid-response');
  let pending = '';
  let previousCarriageReturn = false;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  function event(value: string): string {
    const lines = value.split('\n');
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return `${value}\n\n`;
    return `data: ${JSON.stringify(unwrap(JSON.parse(data)))}\n\n`;
  }
  return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // SSE permits CR, LF and CRLF; a transport chunk may split CRLF or UTF-8.
      for (const character of decoder.decode(chunk, { stream: true })) {
        if (previousCarriageReturn) {
          previousCarriageReturn = false;
          if (character === '\n') continue;
        }
        if (character === '\r') { pending += '\n'; previousCarriageReturn = true; }
        else pending += character;
      }
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        controller.enqueue(encoder.encode(event(pending.slice(0, boundary))));
        pending = pending.slice(boundary + 2);
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending.trim()) controller.enqueue(encoder.encode(event(pending)));
    },
  })), { status: response.status, headers });
}

export const antigravityProvider = defineProvider({
  id: 'antigravity', label: 'Antigravity', contractVersion: '1',
  support: { status: 'experimental', notice: EXPERIMENTAL_SUBSCRIPTION_NOTICE },
  identity: service => serviceIdentity({ product: 'antigravity', service: service.options }),
  modelContracts: modelContracts(protocols),
  describeModel: ({ service, model, profile }) => executionTraits({ family: 'google', service: service.options, parameters: profile.parameters, model }),
  serviceSchema: fixedServiceSchema(baseUrl), profileSchema,
  authentication: { methods: ['oauth'], oauth: antigravityOAuth },
  targets: () => ({ authentication: ['https://oauth2.googleapis.com/token'], inference: [
    `${baseUrl}/v1internal:generateContent`, `${baseUrl}/v1internal:streamGenerateContent`,
  ], identity: ['https://www.googleapis.com/oauth2/v1/userinfo'], discovery: ['https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'] }),
  models: service => declaredModels(service, protocols),
  createExecution(input) {
    return sdkExecution(input, {
      family: 'google', bearer: true, image: input.binding.model.kinds.includes('image'),
      credentialTarget: `${baseUrl}/v1internal:generateContent`,
      prepareRequest({ request, body, sessionId, grant }) {
        const projectId = grant.metadata?.projectId;
        if (typeof projectId !== 'string' || !projectId) throw new ProviderProtocolError('invalid-credential');
        const action = new URL(request.url).pathname.endsWith(':streamGenerateContent') ? 'streamGenerateContent?alt=sse' : 'generateContent';
        return { url: `${baseUrl}/v1internal:${action}`, body: {
          project: projectId, model: input.binding.model.id,
          requestId: randomUUID(), userAgent: 'zhin', request: { ...body, sessionId },
        } };
      },
      prepareResponse: unwrapResponse,
    });
  },
});

declare module '@zhin.js/ai/provider' {
  interface AIProviderRegistry { antigravity: typeof antigravityProvider }
}
