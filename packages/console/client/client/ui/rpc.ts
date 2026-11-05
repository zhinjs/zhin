import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginRpc } from '../console-utils/remoteApi.js';
import { resolveSyncPluginId } from './plugin-id.js';

/**
 * loading: 还没有成功数据且请求在途；empty: 成功但内容为空；ready: 成功且有内容；
 * error: 失败且没有任何旧数据；stale: 失败但保留上次成功的数据（`lastSuccessAt` 标注时间）。
 */
export type RpcResourceState = 'loading' | 'empty' | 'ready' | 'error' | 'stale';

export interface RpcResource<T> {
  readonly state: RpcResourceState;
  /** 最近一次成功的数据；`stale` 时仍保留，切换 key 时清空。 */
  readonly data: T | undefined;
  readonly error: Error | undefined;
  readonly lastSuccessAt: number | undefined;
  /** 有请求在途（含轮询与手动刷新）。 */
  readonly refreshing: boolean;
  /** 立即重读；返回本次是否成功并被采纳。 */
  readonly refresh: () => Promise<boolean>;
  /** 用本地已确认的结果覆盖数据（例如写操作返回了新视图），并作废在途读取。 */
  readonly mutate: (next: T | ((previous: T | undefined) => T | undefined)) => void;
}

export interface RpcResourceOptions<T> {
  /** 轮询间隔（毫秒），在上一次请求结束后才计时；省略则不轮询。 */
  readonly pollMs?: number;
  /** 页面不可见时暂停轮询，回到前台立即重读。默认 true。 */
  readonly pauseWhenHidden?: boolean;
  /** 返回 false 时丢弃响应（例如 Host / 登录上下文已变化）。 */
  readonly isCurrent?: () => boolean;
  /** 判定“成功但为空”。默认：null / undefined / 空数组。 */
  readonly isEmpty?: (data: T) => boolean;
}

interface Snapshot<T> {
  readonly key: string | undefined;
  readonly data: T | undefined;
  readonly error: Error | undefined;
  readonly lastSuccessAt: number | undefined;
  readonly pending: boolean;
}

const defaultIsEmpty = (data: unknown): boolean => data == null || (Array.isArray(data) && data.length === 0);
const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const toError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value));
const initial = <T,>(key: string | undefined): Snapshot<T> => ({ key, data: undefined, error: undefined, lastSuccessAt: undefined, pending: key !== undefined });

/**
 * 通用“读一个远程资源”的 hook：四态、保留旧数据、请求竞态保护、可选轮询。
 * `key` 为 undefined 表示尚不能请求（例如 PluginId 还在解析），保持 loading。
 * `key` 变化时清空旧数据重新读取；`load` 每次渲染可以是新函数。
 */
export function useRpcResource<T>(
  key: string | undefined,
  load: () => Promise<T>,
  options: RpcResourceOptions<T> = {},
): RpcResource<T> {
  const { pollMs, pauseWhenHidden = true } = options;
  const loadRef = useRef(load);
  loadRef.current = load;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const keyRef = useRef(key);
  keyRef.current = key;
  const alive = useRef(true);
  const sequence = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => initial<T>(key));

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(async (): Promise<boolean> => {
    const requestKey = keyRef.current;
    if (requestKey === undefined) return false;
    const id = ++sequence.current;
    const admit = () => id === sequence.current && alive.current && optionsRef.current.isCurrent?.() !== false;
    setSnapshot((previous) => previous.key === requestKey ? (previous.pending ? previous : { ...previous, pending: true }) : initial<T>(requestKey));
    try {
      const data = await loadRef.current();
      if (!admit()) return false;
      setSnapshot({ key: requestKey, data, error: undefined, lastSuccessAt: Date.now(), pending: false });
      return true;
    } catch (error) {
      if (admit()) setSnapshot((previous) => previous.key === requestKey ? { ...previous, error: toError(error), pending: false } : previous);
      return false;
    }
  }, []);

  useEffect(() => {
    if (key === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      if (!(pauseWhenHidden && hidden())) await run();
      if (!cancelled && pollMs) timer = setTimeout(tick, pollMs);
    };
    void tick();
    const onVisible = () => { if (!hidden() && pollMs) void run(); };
    if (pollMs && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      sequence.current++; // 作废本 key 的在途读取
      if (timer) clearTimeout(timer);
      if (pollMs && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, pollMs, pauseWhenHidden, run]);

  const mutate = useCallback((next: T | ((previous: T | undefined) => T | undefined)) => {
    sequence.current++;
    setSnapshot((previous) => ({
      key: keyRef.current,
      data: typeof next === 'function' ? (next as (value: T | undefined) => T | undefined)(previous.data) : next,
      error: undefined, lastSuccessAt: Date.now(), pending: false,
    }));
  }, []);

  const view = snapshot.key === key ? snapshot : initial<T>(key);
  const isEmpty = options.isEmpty ?? defaultIsEmpty;
  const state: RpcResourceState = view.lastSuccessAt === undefined
    ? (view.error ? 'error' : 'loading')
    : view.error ? 'stale' : isEmpty(view.data as T) ? 'empty' : 'ready';
  return { state, data: view.data, error: view.error, lastSuccessAt: view.lastSuccessAt, refreshing: view.pending, refresh: run, mutate };
}

export interface UsePluginRpcOptions<T> extends RpcResourceOptions<T> {}

/**
 * 调用插件的 Console RPC（`plugin.<pluginId>.<method>`），返回四态资源。
 * `pluginId` 为 undefined 时保持 loading（例如 {@link resolvePluginId} 尚未返回）。
 */
export function usePluginRpc<T>(
  pluginId: string | undefined,
  method: string,
  params?: Readonly<Record<string, unknown>>,
  options?: UsePluginRpcOptions<T>,
): RpcResource<T> {
  const key = pluginId === undefined ? undefined : `${pluginId}\u0000${method}\u0000${params === undefined ? '' : JSON.stringify(params)}`;
  return useRpcResource<T>(key, () => pluginRpc<T>(pluginId as string, method, params), options);
}

export interface UsePluginDataOptions<T> extends UsePluginRpcOptions<T> {
  readonly pluginId?: string;
}

/**
 * 自动解析当前页面的 PluginId 并读取插件 Console RPC（默认读取 `status`）。
 */
export function usePluginData<T = Record<string, unknown>>(
  method = 'status',
  params?: Readonly<Record<string, unknown>>,
  options?: UsePluginDataOptions<T>,
): RpcResource<T> {
  const resolved = resolveSyncPluginId(options?.pluginId);
  const pluginId = resolved === 'unknown' ? undefined : resolved;
  return usePluginRpc<T>(pluginId, method, params, options);
}
