/**
 * 60s apiBase 运行时注入 — plugin setup 注册 getter，fetchApi 每次调用时求值。
 * 参考 lottery 的 registerLotteryAgentDeps：registration 模式，卸载时反注册，无 process.env 残留。
 */

export const DEFAULT_API_BASE = 'https://60s.viki.moe';

export type SixtySApiBaseGetter = () => string;

const registrations: Array<{ readonly value: SixtySApiBaseGetter }> = [];

/** Generation-owned apiBase binding used by Plugin Runtime setup(). Returns unregister. */
export function registerSixtySApiBase(getter: SixtySApiBaseGetter): () => void {
  const registration = Object.freeze({ value: getter });
  registrations.push(registration);
  return () => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

/** Resolve the apiBase at call time so config patches take effect without reload. */
export function resolveApiBase(): string {
  const getter = registrations[registrations.length - 1]?.value;
  return getter?.() || DEFAULT_API_BASE;
}
