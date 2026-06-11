/**
 * ADR 0014 P1-1 — 模块级注册表 hot-reload / shutdown 清理
 */
import { Adapter } from '@zhin.js/core';

/** 保留指定的适配器名称，移除其余工厂（hot-reload 后重注册） */
export function pruneAdapterRegistry(keep: Iterable<string>): void {
  const keepSet = new Set(keep);
  for (const name of [...Adapter.Registry.keys()]) {
    if (!keepSet.has(name)) {
      Adapter.Registry.delete(name);
    }
  }
}

export function clearAdapterRegistry(): void {
  Adapter.Registry.clear();
}

export function adapterRegistrySize(): number {
  return Adapter.Registry.size;
}
