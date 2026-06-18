/**
 * 最小 host 插件 stub — 不依赖真实 Plugin 类，避免 vi.mock('@zhin.js/core') 跨文件泄漏。
 */
import type { Plugin } from '@zhin.js/core';
import { setHostRootPlugin } from '../../../core/src/host-plugin-registry.js';

type Listener = (payload: unknown) => void;

/** 实现 dispatch / on，满足 emitAIHookBusEvent 与事件订阅测试 */
export function createMockHostPlugin(): Plugin {
  const listeners = new Map<string, Set<Listener>>();
  const plugin = {
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return plugin;
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return plugin;
    },
    dispatch(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
      return true;
    },
    root: null as unknown as Plugin,
  };
  plugin.root = plugin as unknown as Plugin;
  return plugin as unknown as Plugin;
}

export async function withMockHostRoot<T>(fn: (host: Plugin) => Promise<T> | T): Promise<T> {
  const host = createMockHostPlugin();
  setHostRootPlugin(host);
  try {
    return await fn(host);
  } finally {
    setHostRootPlugin(null);
  }
}
