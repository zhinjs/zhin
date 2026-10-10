import { vi } from 'vitest';
import { TypeSafeDecisionProvider } from '../src/decision-provider.js';
import { TypeSafeDecisionError } from '../src/response-validator.js';

const questions = {
  route: { type: 'choice', instructions: 'Choose a route', criteria: { billing: null, other: null } },
  relevant: { type: 'score', criteria: ['irrelevant', 'relevant'] },
  allowed: { type: 'noul', instructions: 'Is this allowed?' },
} as const;
function response() {
  return {
    model: 'jev-pinned-2026', usage: { input_tokens: 30, output_tokens: 10 },
    answers: {
      route: { type: 'choice', choice: 'billing', confidence: 0.91, probabilities: { billing: 0.8, other: 0.2 } },
      relevant: { type: 'score', score: 0.8, confidence: 0.87, legend: { '0': 'irrelevant', '1': 'relevant' }, probabilities: { '0': 0.2, '1': 0.8 } },
      allowed: { type: 'noul', noul: 0.7 },
    },
  };
}
const request = { state: { intent: 'help' }, questions };
const options = () => ({ signal: new AbortController().signal });

it('uses the official SDK transport and retains typed decisions, actual model and usage', async () => {
  const fetch = vi.fn(async () => Response.json(response()));
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key', model: 'jev-test', maxRetries: 0 }, { fetch });
  const result = await provider.evaluate(request, options());
  expect(result.model).toBe('jev-pinned-2026');
  expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 10 });
  expect(result.answers.route.choice).toBe('billing');
  expect(result.answers.relevant.score).toBe(0.8);
  expect(result.answers.allowed).toEqual({ type: 'noul', noul: 0.7 });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.typesafe.ai/v1/systemone');
  expect(JSON.parse(init.body as string)).toEqual({ ...request, model: 'jev-test' });
  expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
  provider.dispose();
});

it.each([
  ['missing answer', (raw: ReturnType<typeof response>) => { delete (raw.answers as Partial<typeof raw.answers>).allowed; }],
  ['unknown choice', (raw: ReturnType<typeof response>) => { raw.answers.route.choice = 'unknown'; }],
  ['wrong type', (raw: ReturnType<typeof response>) => { raw.answers.route.type = 'noul'; }],
  ['missing confidence', (raw: ReturnType<typeof response>) => { delete (raw.answers.route as Partial<typeof raw.answers.route>).confidence; }],
  ['invalid probability', (raw: ReturnType<typeof response>) => { raw.answers.route.probabilities.billing = 2; }],
  ['incomplete distribution', (raw: ReturnType<typeof response>) => { delete (raw.answers.route.probabilities as Partial<typeof raw.answers.route.probabilities>).other; }],
  ['unnormalized distribution', (raw: ReturnType<typeof response>) => { raw.answers.route.probabilities.billing = 0.1; }],
  ['out of range score', (raw: ReturnType<typeof response>) => { raw.answers.relevant.score = 2; }],
  ['changed rubric', (raw: ReturnType<typeof response>) => { raw.answers.relevant.legend['0'] = 'different'; }],
  ['invalid usage', (raw: ReturnType<typeof response>) => { raw.usage.output_tokens = -1; }],
])('rejects %s without disclosing remote contents', async (_, mutate) => {
  const raw = response();
  mutate(raw);
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key' }, { fetch: async () => Response.json(raw) });
  await expect(provider.evaluate(request, options())).rejects.toMatchObject({ code: 'invalid-response' });
  provider.dispose();
});

it('bounds SDK retries by one total timeout', async () => {
  const fetch = vi.fn(async () => Response.json({ error: 'private-body' }, { status: 429, headers: { 'Retry-After': '10' } }));
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key', timeoutMs: 30, maxRetries: 2 }, { fetch });
  await expect(provider.evaluate(request, options())).rejects.toMatchObject({ code: 'timeout' });
  expect(fetch).toHaveBeenCalledTimes(1);
  provider.dispose();
});

it('cancels in-flight transport on dispose and rejects later calls', async () => {
  let transportSignal: AbortSignal | undefined;
  const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    transportSignal = init?.signal ?? undefined;
    transportSignal?.addEventListener('abort', () => reject(new Error('private-transport-error')), { once: true });
  }));
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key' }, { fetch });
  const pending = provider.evaluate(request, options());
  provider.dispose();
  await expect(pending).rejects.toMatchObject({ code: 'disposed' });
  expect(transportSignal?.aborted).toBe(true);
  await expect(provider.evaluate(request, options())).rejects.toMatchObject({ code: 'disposed' });
});

it('cancels retry waiting immediately when the caller aborts', async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => Response.json({ error: 'private' }, { status: 503 }));
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key', maxRetries: 2 }, { fetch });
  const pending = provider.evaluate(request, { signal: controller.signal });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  controller.abort(new Error('sensitive caller reason'));
  await expect(pending).rejects.toMatchObject({ code: 'cancelled', message: 'TypeSafe decision cancelled' });
  provider.dispose();
});

it('redacts SDK error bodies and does not emit SDK logs', async () => {
  const logs = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key', maxRetries: 0 }, { fetch: async () => Response.json({ message: 'secret-key private-prompt' }, { status: 401 }) });
  try {
    await provider.evaluate(request, options());
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(TypeSafeDecisionError);
    expect(error).toMatchObject({ code: 'request-failed', status: 401 });
    expect(JSON.stringify(error)).not.toMatch(/secret-key|private-prompt/);
    expect((error as Error).cause).toBeUndefined();
  }
  expect(logs).not.toHaveBeenCalled();
  logs.mockRestore();
  provider.dispose();
});

it('validates unsupported JSON entries and empty questions before dispatch', async () => {
  const fetch = vi.fn(async () => Response.json(response()));
  const provider = new TypeSafeDecisionProvider({ apiKey: 'test-key' }, { fetch });
  await expect(provider.evaluate({ state: true, questions }, options())).rejects.toMatchObject({ code: 'invalid-request' });
  await expect(provider.evaluate({ state: null, questions: {} }, options())).rejects.toMatchObject({ code: 'invalid-request' });
  expect(fetch).not.toHaveBeenCalled();
  provider.dispose();
});

it.each([{ apiKey: '' }, { apiKey: '${TYPESAFE_API_KEY}' }, { apiKey: 'test', timeoutMs: 0 }, { apiKey: 'test', maxRetries: -1 }, { apiKey: 'test', baseUrl: 'https://secret:password@example.com' }])('rejects invalid config safely', config => {
  expect(() => new TypeSafeDecisionProvider(config)).toThrow('TypeSafe decision invalid-config');
});
