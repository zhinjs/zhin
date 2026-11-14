import { ProviderError, type InferenceClient } from '@zhin.js/ai/provider';
import { InferenceAuthenticationError } from '../../../src/plugin-runtime/inference/credentials.js';
import { probeLanguageProfile } from '../../../src/plugin-runtime/inference/probe.js';

function client(generate: InferenceClient['generate']): InferenceClient {
  return {
    list: async () => [{ reference: { id: 'chat' }, label: 'chat', model: 'm', accountId: 'a', serviceId: 's', definition: {} }] as never,
    generate, stream: vi.fn(), evaluate: vi.fn(), generateImage: vi.fn(), close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  } as unknown as InferenceClient;
}
const signal = () => new AbortController().signal;

it('sends one minimal request that carries a tool and reports success', async () => {
  const generate = vi.fn(async () => ({ role: 'assistant', content: [{ type: 'text', text: 'OK' }], stopReason: 'stop' }) as never);
  const result = await probeLanguageProfile({ client: client(generate), profileId: 'chat', signal: signal() });
  expect(result).toMatchObject({ status: 'ok', profileId: 'chat' });
  const input = generate.mock.calls[0]![0] as Parameters<InferenceClient['generate']>[0];
  expect(input.profile).toEqual({ id: 'chat' });
  expect(input.request.context.tools).toHaveLength(1);
  expect(input.request.options).toEqual({ maxRetries: 0 });
});

it('reports a never-answering provider as a timeout after the probe deadline (fake timers)', async () => {
  vi.useFakeTimers();
  try {
    const generate = vi.fn((input: Parameters<InferenceClient['generate']>[0]) => new Promise<never>((_, reject) => {
      input.signal?.addEventListener('abort', () => reject(input.signal!.reason));
    }));
    const pending = probeLanguageProfile({ client: client(generate), profileId: 'chat', signal: signal(), timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({ status: 'failed', kind: 'timeout', durationMs: 30_000 });
  } finally { vi.useRealTimers(); }
});

it.each([
  [Object.assign(new Error('HTTP 401 synthetic-secret-body'), { statusCode: 401 }), { kind: 'auth', httpStatus: 401 }],
  [Object.assign(new Error('HTTP 503'), { statusCode: 503 }), { kind: 'server', httpStatus: 503 }],
  [new InferenceAuthenticationError('not-authorized'), { kind: 'credential', code: 'not-authorized' }],
  [new ProviderError('forbidden'), { kind: 'unavailable', code: 'forbidden' }],
])('classifies failures without provider text (%s)', async (error, expected) => {
  const result = await probeLanguageProfile({ client: client(async () => { throw error; }), profileId: 'chat', signal: signal() });
  expect(result).toMatchObject({ status: 'failed', ...expected });
  expect(JSON.stringify(result)).not.toContain('synthetic-secret-body');
});

it('reports an unknown profile without sending a request', async () => {
  const generate = vi.fn();
  expect(await probeLanguageProfile({ client: client(generate), profileId: 'missing', signal: signal() }))
    .toMatchObject({ status: 'failed', kind: 'profile-not-found' });
  expect(generate).not.toHaveBeenCalled();
});
