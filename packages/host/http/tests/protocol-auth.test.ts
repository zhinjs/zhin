import { isLoopbackAddress, verifyProtocolAccessToken } from '../src/protocol-auth.js';

const request = (input: { authorization?: string; url?: string; ip?: string }) => ({
  headers: new Headers(input.authorization ? { authorization: input.authorization } : {}),
  url: new URL(input.url ?? '/', 'http://localhost'),
  remoteAddress: input.ip ?? '203.0.113.7',
});

describe('protocol socket access', () => {
  it('recognises loopback peers only', () => {
    expect(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'].every(isLoopbackAddress)).toBe(true);
    expect(['10.0.0.1', '::ffff:10.0.0.1', '1270.0.0.1', '', undefined].some(isLoopbackAddress)).toBe(false);
  });

  it('requires the access token as bearer or query when one is configured', () => {
    expect(verifyProtocolAccessToken('secret', request({ authorization: 'Bearer secret' }))).toBe(true);
    expect(verifyProtocolAccessToken('secret', request({ url: '/onebot?access_token=secret' }))).toBe(true);
    expect(verifyProtocolAccessToken('secret', request({ authorization: 'Bearer wrong' }))).toBe(false);
    expect(verifyProtocolAccessToken('secret', request({ url: '/onebot?access_token=secre' }))).toBe(false);
    // A configured token is required even from loopback.
    expect(verifyProtocolAccessToken('secret', request({ ip: '127.0.0.1' }))).toBe(false);
  });

  it('admits only loopback peers when no access token is configured', () => {
    expect(verifyProtocolAccessToken(undefined, request({ ip: '127.0.0.1' }))).toBe(true);
    expect(verifyProtocolAccessToken(undefined, request({ ip: '::1' }))).toBe(true);
    expect(verifyProtocolAccessToken(undefined, request({ ip: '192.168.1.5', authorization: 'Bearer anything' }))).toBe(false);
    expect(verifyProtocolAccessToken('', request({}))).toBe(false);
  });

  it('accepts a string URL (relative to the request target)', () => {
    expect(verifyProtocolAccessToken('secret', {
      headers: new Headers(), url: '/ws?access_token=secret',
    })).toBe(true);
  });
});
