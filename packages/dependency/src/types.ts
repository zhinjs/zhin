export type Constructor<T> ={
    new (...args: any[]): T;
};

/**
 * 副作用清理函数类型
 */
export type EffectCleanup = () => void;

/**
 * 定时器 ID 类型
 */
export type TimerId = ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;

/**
 * Immediate ID 类型 (Node.js)
 */
export type ImmediateId = ReturnType<typeof setImmediate>;

/**
 * 包装后的副作用函数类型
 */
export interface WrappedEffects {
  setInterval: typeof globalThis.setInterval;
  setTimeout: typeof globalThis.setTimeout;
  setImmediate: typeof globalThis.setImmediate;
}