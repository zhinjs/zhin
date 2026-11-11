import { describe, it, expect } from 'vitest';
import {
  extractBearerToken,
  isLocalhost,
  timingSafeEqualString,
  verifyA2aBearer,
  type A2aAuthRequest,
} from '../src/auth.js';

function mockReq(authorization?: string): A2aAuthRequest {
  return { headers: new Headers(authorization ? { authorization } : {}) };
}

describe('A2A auth', () => {
  it('extracts Bearer token from Authorization header', () => {
    expect(extractBearerToken(mockReq('Bearer secret-token'))).toBe('secret-token');
    expect(extractBearerToken(mockReq('Basic abc'))).toBe('');
    expect(extractBearerToken(mockReq())).toBe('');
  });

  it('compares tokens with timing-safe equality', () => {
    expect(timingSafeEqualString('same', 'same')).toBe(true);
    expect(timingSafeEqualString('a', 'b')).toBe(false);
    expect(timingSafeEqualString('', 'x')).toBe(false);
  });

  it('verifies Bearer token when expected token is configured', () => {
    const token = 'mesh-token';
    expect(verifyA2aBearer(mockReq(`Bearer ${token}`), token)).toBe(true);
    expect(verifyA2aBearer(mockReq('Bearer wrong'), token)).toBe(false);
    expect(verifyA2aBearer(mockReq(), token)).toBe(false);
    expect(verifyA2aBearer(mockReq(`Bearer ${token}`), '')).toBe(false);
  });
});

describe('A2A localhost behind a proxy', () => {
  it('never treats proxied requests as localhost', () => {
    expect(isLocalhost({ headers: new Headers(), remoteAddress: '127.0.0.1' })).toBe(true);
    expect(isLocalhost({ headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }), remoteAddress: '127.0.0.1' })).toBe(false);
    expect(isLocalhost({ headers: new Headers({ forwarded: 'for=203.0.113.9' }), remoteAddress: '::1' })).toBe(false);
  });
});
