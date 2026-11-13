import { describe, expect, it } from 'vitest';
import {
  buildCaptchaHelperUrl,
  captchaHelperOrigin,
  DEFAULT_CAPTCHA_HELPER_URL,
  LOGIN_CAPTCHA_MESSAGE_TYPE,
  parseCaptchaHelperMessage,
  parseCaptchaHelperPayload,
} from '../src/built/login-captcha.js';
import { LoginAssist } from '../src/built/login-assist.js';

const QUERY = 'uin=10001&sid=abc&cap_cd=x%2By&aid=2081081773';

describe('captcha helper URL', () => {
  it('puts a base64url JSON payload in the fragment of the default helper', () => {
    const url = new URL(buildCaptchaHelperUrl({ query: `?${QUERY}`, nonce: 'nonce-12345', origin: 'https://console.example' }));
    expect(`${url.origin}${url.pathname}`).toBe(DEFAULT_CAPTCHA_HELPER_URL);
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#[A-Za-z0-9_-]+$/u);
    expect(parseCaptchaHelperPayload(url.hash)).toEqual({ q: QUERY, n: 'nonce-12345', o: 'https://console.example' });
  });

  it('accepts a configured helper and rejects unsafe input', () => {
    expect(buildCaptchaHelperUrl({ helperUrl: 'http://localhost:5173/tcaptcha.html', query: QUERY, nonce: 'nonce-12345', origin: 'http://127.0.0.1:8086' }))
      .toMatch(/^http:\/\/localhost:5173\/tcaptcha\.html#/u);
    expect(() => buildCaptchaHelperUrl({ helperUrl: 'http://evil.example/x', query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example' })).toThrow(/https/u);
    expect(() => buildCaptchaHelperUrl({ helperUrl: 'javascript:alert(1)', query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example' })).toThrow();
    expect(() => buildCaptchaHelperUrl({ query: QUERY, nonce: 'short', origin: 'https://c.example' })).toThrow(/nonce/u);
    expect(() => buildCaptchaHelperUrl({ query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example/path' })).toThrow(/origin/u);
    expect(() => buildCaptchaHelperUrl({ query: '', nonce: 'nonce-12345', origin: 'https://c.example' })).toThrow(/query/u);
    expect(parseCaptchaHelperPayload('#not-base64!')).toBeNull();
  });
});

describe('captcha helper message', () => {
  const helperOrigin = captchaHelperOrigin()!;
  const message = (data: unknown, origin = helperOrigin) => ({ origin, data });

  it('accepts only the helper origin with the opener nonce', () => {
    const data = { type: LOGIN_CAPTCHA_MESSAGE_TYPE, nonce: 'nonce-12345', ticket: 't03abc', randstr: '@xyz' };
    expect(parseCaptchaHelperMessage(message(data), { helperOrigin, nonce: 'nonce-12345' })).toEqual({ ticket: 't03abc', randstr: '@xyz' });
    expect(parseCaptchaHelperMessage(message(data, 'https://evil.example'), { helperOrigin, nonce: 'nonce-12345' })).toBeNull();
    expect(parseCaptchaHelperMessage(message(data), { helperOrigin, nonce: 'other-nonce' })).toBeNull();
    expect(parseCaptchaHelperMessage(message({ ...data, type: 'other' }), { helperOrigin, nonce: 'nonce-12345' })).toBeNull();
    expect(parseCaptchaHelperMessage(message({ ...data, ticket: 'a,b' }), { helperOrigin, nonce: 'nonce-12345' })).toBeNull();
    expect(parseCaptchaHelperMessage(message('string'), { helperOrigin, nonce: 'nonce-12345' })).toBeNull();
  });

  it('feeds a slider challenge through the same submit shape the Console sends', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, captchaHelperUrl: 'https://helper.example/tcaptcha.html' });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot', owner: {} });
    const answer = flow.challenge({
      kind: 'slider', title: '滑块验证',
      media: { captcha: { provider: 'tencent', query: `?${QUERY}` } },
      input: { kind: 'ticket', label: 'ticket', extract: 'ticket-json-or-url' },
    });
    const media = assist.getFlow('demo', 'bot')!.steps[0]!.challenge!.media!;
    expect(media.captcha).toEqual({ provider: 'tencent', query: QUERY, helperUrl: 'https://helper.example/tcaptcha.html' });
    const reply = parseCaptchaHelperMessage(
      { origin: 'https://helper.example', data: { type: LOGIN_CAPTCHA_MESSAGE_TYPE, nonce: 'nonce-12345', ticket: 't03abc', randstr: '@xyz' } },
      { helperOrigin: captchaHelperOrigin(media.captcha!.helperUrl)!, nonce: 'nonce-12345' },
    )!;
    assist.submit(assist.listPending()[0]!.id, { action: 'submit', values: { ticket: `${reply.ticket},${reply.randstr}` } });
    await expect(answer).resolves.toMatchObject({ actionId: 'submit', values: { input: 't03abc', randstr: '@xyz' } });
  });

  it('drops a non-tencent provider, a malformed query and an unsafe helper URL', () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, captchaHelperUrl: 'http://evil.example/x' });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot', owner: {} });
    void flow.challenge({ kind: 'slider', title: 's', media: { captcha: { provider: 'other' as 'tencent', query: QUERY } } }).catch(() => undefined);
    expect(assist.getFlow('demo', 'bot')!.steps.at(-1)!.challenge!.media?.captcha).toBeUndefined();
    void flow.challenge({ kind: 'slider', title: 's', media: { captcha: { provider: 'tencent', query: 'a b#c' } } }).catch(() => undefined);
    expect(assist.getFlow('demo', 'bot')!.steps.at(-1)!.challenge!.media?.captcha).toBeUndefined();
    void flow.challenge({ kind: 'slider', title: 's', media: { captcha: { provider: 'tencent', query: QUERY, helperUrl: 'ftp://x/y' } } }).catch(() => undefined);
    expect(assist.getFlow('demo', 'bot')!.steps.at(-1)!.challenge!.media?.captcha).toEqual({ provider: 'tencent', query: QUERY });
    assist.dispose();
  });
});
