/**
 * QQ Bot 扫码绑定流程（内联，等价 qqbot-connector startQrConnect）
 */
import {
  BindStatus,
  buildConnectUrl,
  createBindTask,
  decryptSecret,
  pollBindResult,
} from './qq-bind-api.js';

const POLL_INTERVAL_MS = 2000;

export interface QqBindCredentials {
  appId: string;
  appSecret: string;
}

export interface QqBindCallbacks {
  onSuccess: (credentials: QqBindCredentials[]) => void;
  onFailure: (error: Error) => void;
  onQrDisplayed?: (url: string) => void | Promise<void>;
  onQrExpired?: () => void | Promise<void>;
}

export interface QqBindFlowOptions {
  signal?: AbortSignal;
  source?: string;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function pollUntilResult(
  taskId: string,
  key: string,
  signal?: AbortSignal,
): Promise<{ outcome: 'scanned'; appId: string; appSecret: string } | { outcome: 'expired' }> {
  while (!signal?.aborted) {
    let result;
    try {
      result = await pollBindResult(taskId);
    } catch {
      await sleep(POLL_INTERVAL_MS, signal);
      continue;
    }
    if (result.status === BindStatus.COMPLETED) {
      const appSecret = decryptSecret(result.botEncryptSecret, key);
      return { outcome: 'scanned', appId: result.botAppId, appSecret };
    }
    if (result.status === BindStatus.EXPIRED) {
      return { outcome: 'expired' };
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
  throw new DOMException('Aborted', 'AbortError');
}

/**
 * 轮询等待扫码结果（回调风格）。返回 stop 函数可中止流程。
 */
export function startQqBindFlow(
  callbacks: QqBindCallbacks,
  options: QqBindFlowOptions = {},
): () => void {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;

  void (async () => {
    for (;;) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      let task;
      try {
        task = await createBindTask();
      } catch (err) {
        throw new Error(
          `获取绑定任务失败: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      const connectUrl = buildConnectUrl(task.taskId, options.source ?? 'zhin');
      await callbacks.onQrDisplayed?.(connectUrl);
      const pollResult = await pollUntilResult(task.taskId, task.key, signal);
      if (pollResult.outcome === 'scanned') {
        callbacks.onSuccess([{ appId: pollResult.appId, appSecret: pollResult.appSecret }]);
        return;
      }
      await callbacks.onQrExpired?.();
    }
  })().catch((err) => {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    callbacks.onFailure(err instanceof Error ? err : new Error(String(err)));
  });

  return () => controller.abort();
}
