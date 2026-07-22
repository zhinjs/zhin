import { afterEach, describe, expect, it } from 'vitest';
import { buildSandboxWebSocketUrl } from '../pages/sandboxTransport.js';

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

  it('falls back to window origin without token', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage({}), configurable: true });
    Object.defineProperty(globalThis, 'window', {
      value: { location: { origin: 'http://localhost:5173' } },
      configurable: true,
    });
    expect(buildSandboxWebSocketUrl()).toBe('ws://localhost:5173/sandbox');
  });
});
