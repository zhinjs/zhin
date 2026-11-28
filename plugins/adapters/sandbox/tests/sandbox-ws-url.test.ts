import { afterEach, describe, expect, it } from 'vitest';
import { buildSandboxWebSocketUrl, isSandboxWsPath } from '../pages/index/sandboxTransport.js';

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

function mockStorage(map: Record<string, string>) {
  return {
    getItem: (key: string) => map[key] ?? null,
    setItem: (key: string, value: string) => { map[key] = value; },
    removeItem: (key: string) => { delete map[key]; },
    clear: () => { for (const key of Object.keys(map)) delete map[key]; },
    key: () => null,
    length: 0,
  } as Storage;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true });
});

describe('buildSandboxWebSocketUrl', () => {
  it('uses stored API base + token query', () => {
    const store: Record<string, string> = {
      zhin_api_base: 'http://127.0.0.1:8086',
      zhin_api_token: 'secret',
    };
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage(store), configurable: true });
    Object.defineProperty(globalThis, 'window', {
      value: { location: { origin: 'https://console.zhin.dev' } },
      configurable: true,
    });
    expect(buildSandboxWebSocketUrl()).toBe('ws://127.0.0.1:8086/sandbox?token=secret');
  });

  it('connects to one account path and never to anything but a Sandbox path', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage({}), configurable: true });
    Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://localhost:8086' } }, configurable: true });
    expect(buildSandboxWebSocketUrl(undefined, '/sandbox/sandbox-bot2')).toBe('ws://localhost:8086/sandbox/sandbox-bot2');
    expect(buildSandboxWebSocketUrl(undefined, '//evil.example/x')).toBe('ws://localhost:8086/sandbox');
    expect(buildSandboxWebSocketUrl(undefined, '/api/other')).toBe('ws://localhost:8086/sandbox');
  });

  it('rejects dot segments, encoded dots and backslashes in an account path (#1250 b116 M2)', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage({}), configurable: true });
    Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://localhost:8086' } }, configurable: true });
    for (const path of ['/sandbox/..', '/sandbox/.', '/sandbox/..\\terminal', '/sandbox/a\\b', '/sandbox/%2e%2e', '/sandbox/%2E%2E',
      '/sandbox/%2e', '/sandbox/.%2E', '/sandbox/%zz', '/sandbox/a/b', '/sandbox/', '/sandbox/a b', '/sandbox/a?x', '/sandbox/a#x']) {
      expect(isSandboxWsPath(path), path).toBe(false);
      expect(buildSandboxWebSocketUrl(undefined, path), path).toBe('ws://localhost:8086/sandbox');
    }
    for (const path of ['/sandbox', '/sandbox/sandbox-bot', '/sandbox/bot.v2', '/sandbox/a~b_c', '/sandbox/%E6%B2%99', '/sandbox/a-2']) {
      expect(isSandboxWsPath(path), path).toBe(true);
      expect(new URL(buildSandboxWebSocketUrl(undefined, path)).pathname, path).toBe(path);
    }
  });

  it('falls back to window origin without token', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage({}), configurable: true });
    Object.defineProperty(globalThis, 'window', {
      value: { location: { origin: 'http://localhost:5173' } },
      configurable: true,
    });
    expect(buildSandboxWebSocketUrl()).toBe('ws://localhost:5173/sandbox');
  });
});
