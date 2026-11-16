/**
 * zhinjs/zhin#1250 (`unaddressed-message-no-record`): the Sandbox page reads why a message it sent
 * got no reply (`readMessageOutcome`) and turns it into a notice (`quietOutcomeNotice`).
 */
import { quietOutcomeNotice, readMessageOutcome, type ConversationOutcome } from '../pages/index/conversationRecovery.js';

const context = Object.freeze({ apiBase: 'https://host-a.invalid', headers: Object.freeze({ authorization: 'Bearer synthetic-a' }) });
const outcome = (overrides: Partial<ConversationOutcome> = {}): ConversationOutcome => ({
  id: 'o-1', messageId: 'm-1', settledAt: 1, outcome: 'not_addressed', reason: 'no_command_not_ambient', stage: 'ambient',
  addressed: false, reply: 'no', text: '这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。', ...overrides,
});

function stubFetch(status: number, body: unknown) {
  const calls: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('readMessageOutcome', () => {
  it('asks the bound Host for this message with the captured credentials and returns the newest outcome', async () => {
    const calls = stubFetch(200, { success: true, data: { sessionKey: 'k', persistent: false, outcomes: [outcome()] } });
    await expect(readMessageOutcome('live', 'sandbox:bot:group:测试群', 'm-1', 'en', undefined, context)).resolves.toEqual(outcome());
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url.origin).toBe('https://host-a.invalid');
    expect(url.pathname).toBe('/api/conversations/outcomes');
    expect(Object.fromEntries(url.searchParams)).toEqual({ connectionId: 'live', sessionKey: 'sandbox:bot:group:测试群', messageId: 'm-1', locale: 'en' });
    expect(init.headers).toEqual({ authorization: 'Bearer synthetic-a' });
    expect(init.cache).toBe('no-store');
  });

  it('answers undefined while the message is not settled yet', async () => {
    stubFetch(200, { success: true, data: { sessionKey: 'k', persistent: false, outcomes: [] } });
    await expect(readMessageOutcome('live', 'k', 'm-1', 'zh-CN', undefined, context)).resolves.toBeUndefined();
  });

  it('answers null on a Host without the route', async () => {
    stubFetch(404, { success: false });
    await expect(readMessageOutcome('live', 'k', 'm-1', 'zh-CN', undefined, context)).resolves.toBeNull();
    stubFetch(405, { success: false });
    await expect(readMessageOutcome('live', 'k', 'm-1', 'zh-CN', undefined, context)).resolves.toBeNull();
  });

  it('throws the Host error on a refused or failed read', async () => {
    stubFetch(403, { success: false, error: '会话不属于当前 Sandbox 账号' });
    await expect(readMessageOutcome('live', 'k', 'm-1', 'zh-CN', undefined, context)).rejects.toThrow('会话不属于当前 Sandbox 账号');
    stubFetch(503, { success: false });
    await expect(readMessageOutcome('live', 'k', 'm-1', 'zh-CN', undefined, context)).rejects.toThrow('Outcome read failed (503)');
  });
});

describe('quietOutcomeNotice', () => {
  it('explains a message that got no reply by design, with its code and reason', () => {
    expect(quietOutcomeNotice(outcome())).toBe('这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。（not_addressed · no_command_not_ambient）');
    expect(quietOutcomeNotice(outcome({ text: 'You did not mention me.' }), 'en'))
      .toBe('You did not mention me. (not_addressed · no_command_not_ambient)');
    expect(quietOutcomeNotice(outcome({ outcome: 'feature_disabled', reason: undefined }))).toBe(`${outcome().text}（feature_disabled）`);
  });

  it('says nothing when the bot replied, was throttled, or nothing is known', () => {
    expect(quietOutcomeNotice(outcome({ reply: 'yes', outcome: 'refused', reason: 'simulated-sender' }))).toBeNull();
    expect(quietOutcomeNotice(outcome({ reply: 'throttled' }))).toBeNull();
    expect(quietOutcomeNotice(undefined)).toBeNull();
    expect(quietOutcomeNotice(null)).toBeNull();
  });
});
