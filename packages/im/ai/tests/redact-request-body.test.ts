import { formatRedactedJson, redactValueForLog } from '../src/llm/redact-request-body.js';

describe('redact-request-body', () => {
  it('shrinks data URI base64', () => {
    const input = { url: 'data:image/png;base64,' + 'A'.repeat(1000) };
    const out = redactValueForLog(input) as { url: string };
    expect(out.url).toBe('data:image/png;base64,<1000 chars>');
  });

  it('truncates long plain strings', () => {
    const out = redactValueForLog('x'.repeat(1000)) as string;
    expect(out).toContain('…<1000 total>');
    expect(out.length).toBeLessThan(900);
  });

  it('formatRedactedJson produces valid JSON', () => {
    const json = formatRedactedJson({ messages: [{ role: 'user', content: 'hi' }] });
    expect(JSON.parse(json)).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });
});
