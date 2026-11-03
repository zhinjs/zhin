import { createLazyInferenceClient } from '@zhin.js/ai-provider';
import type { AssistantMessage } from '@zhin.js/ai';
import type { InferenceClient } from '@zhin.js/ai/provider';
import { beginQuotaUsage, createInferenceUsageAccounting } from '../../src/security/usage-accounting.js';
import { InMemoryUsageQuotaStore, UsageQuota } from '../../src/security/usage-quota.js';

const subject = { userId: 'member', groupId: 'group', owner: false };
it('rechecks token admission after async open before transport, without counting group rate twice', async () => {
  const store = new InMemoryUsageQuotaStore(), quota = new UsageQuota({ perUserTokens: 5, perGroupRequestsPerMinute: 10 }, store);
  const accounting = createInferenceUsageAccounting({ quota, subject });
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  let opened = 0, requests = 0;
  const generate = async (): Promise<AssistantMessage> => {
    accounting.submitted(); requests++;
    throw new Error('submitted outcome unknown');
  };
  const close = async () => {};
  const port: InferenceClient = { list: async () => [], generate, evaluate: async () => { throw new Error('unused'); },
    stream: async () => { throw new Error('unused'); }, generateImage: async () => { throw new Error('unused'); }, close, [Symbol.asyncDispose]: close };
  const client = createLazyInferenceClient({ signal: new AbortController().signal, accounting,
    open: async () => { opened++; await gate; return port; } });
  const request = { context: { systemPrompt: 'x'.repeat(100), messages: [] } };
  const first = client.generate({ request }), second = client.generate({ request });
  const results = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(opened).toBe(1)); expect(requests).toBe(0); release();
  const outcomes = await results;
  expect(requests).toBe(1); expect(outcomes.map(item => item.status)).toEqual(['rejected', 'rejected']);
  expect(String((outcomes[0] as PromiseRejectedResult).reason)).toContain('unknown');
  expect((outcomes[1] as PromiseRejectedResult).reason).toMatchObject({ name: 'AiCompletionQuotaError' });
  expect(store.get('tokens:user:member')!.used).toBeGreaterThan(5);
  expect(store.get('rate:group:group')!.used).toBe(2); await client.close();
});

it('never records a local result without actual submission and retains a submitted unknown reservation', () => {
  const record = vi.fn(), quota = { check: () => ({ allowed: true as const }), checkTokens: () => ({ allowed: true as const }), record };
  const local = beginQuotaUsage({ quota, shares: [{ subject, weight: 1 }], promptTokens: 10 });
  local.finish({ totalTokens: 50 }); local.close(); expect(record).not.toHaveBeenCalled();
  const submitted = beginQuotaUsage({ quota, shares: [{ subject, weight: 1 }], promptTokens: 10 });
  submitted.submitted(); submitted.close(); expect(record).toHaveBeenCalledExactlyOnceWith(subject, 10);
});

it('pre-submit quota storage failure prevents transport while post-submit settlement failure preserves success', async () => {
  const fail = new Error('quota storage unavailable'), record = vi.fn().mockImplementation(() => { throw fail; });
  const quota = { check: () => ({ allowed: true as const }), checkTokens: () => ({ allowed: true as const }), record };
  const ticket = beginQuotaUsage({ quota, shares: [{ subject, weight: 1 }], promptTokens: 10 });
  expect(() => ticket.submitted()).toThrow(fail);
  const report = vi.fn(); record.mockImplementationOnce(() => {});
  const completed = beginQuotaUsage({ quota, shares: [{ subject, weight: 1 }], promptTokens: 10, onSettlementError: report });
  completed.submitted(); expect(() => completed.finish({ totalTokens: 20 })).not.toThrow();
  expect(report).toHaveBeenCalledExactlyOnceWith(fail);
});
