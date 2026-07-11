import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySlackSignature } from '../src/signing.js';

const SIGNING_SECRET = 'test-signing-secret-abc123';

function makeValidSignature(rawBody: string, timestamp?: string): { timestamp: string; signature: string } {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const baseString = `v0:${ts}:${rawBody}`;
  const hmac = createHmac('sha256', SIGNING_SECRET).update(baseString).digest('hex');
  return { timestamp: ts, signature: `v0=${hmac}` };
}

describe('verifySlackSignature', () => {
  it('should accept a valid signature', () => {
    const body = '{"type":"event_callback","event":{"type":"message"}}';
    const { timestamp, signature } = makeValidSignature(body);
    expect(verifySlackSignature(SIGNING_SECRET, body, timestamp, signature)).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const body = '{"type":"event_callback"}';
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SIGNING_SECRET, body, ts, 'v0=invalid')).toBe(false);
  });

  it('should reject a stale timestamp (>5 min drift)', () => {
    const body = '{"type":"event_callback"}';
    const staleTs = String(Math.floor(Date.now() / 1000) - 400);
    const { signature } = makeValidSignature(body, staleTs);
    expect(verifySlackSignature(SIGNING_SECRET, body, staleTs, signature)).toBe(false);
  });

  it('should reject non-numeric timestamp', () => {
    const body = '{}';
    expect(verifySlackSignature(SIGNING_SECRET, body, 'not-a-number', 'v0=abc')).toBe(false);
  });

  it('should reject empty signature', () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SIGNING_SECRET, body, ts, '')).toBe(false);
  });

  it('should reject tampered body', () => {
    const original = '{"type":"event_callback","event":{"type":"message"}}';
    const { timestamp, signature } = makeValidSignature(original);
    const tampered = '{"type":"event_callback","event":{"type":"HACKED"}}';
    expect(verifySlackSignature(SIGNING_SECRET, tampered, timestamp, signature)).toBe(false);
  });
});
