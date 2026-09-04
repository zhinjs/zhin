import {
  daemon,
  releaseMemory,
  screenshot,
  start,
  status,
} from '@shotkit/shotium';

import type {
  DaemonClient,
  ScreenshotOptions,
  ScreenshotResult,
  StartOptions,
} from '@shotkit/shotium';
import type { ShotiumConfig } from './config.js';
import type { HtmlRendererLogger } from './types.js';

interface Engine {
  screenshot(options: ScreenshotOptions): Promise<ScreenshotResult>;
  release(): void;
  describe(): string;
  close(): Promise<void>;
}

function toStartOptions(config: ShotiumConfig): StartOptions {
  const options: StartOptions = { cacheMaxBytes: config.cacheMaxBytes };
  const cacheDir = config.cacheDir.trim();
  if (cacheDir === 'off') options.cacheDir = null;
  else if (cacheDir) options.cacheDir = cacheDir;
  if (config.userAgent) options.userAgent = config.userAgent;
  return options;
}

function createInprocessEngine(config: ShotiumConfig, logger?: HtmlRendererLogger): Engine {
  const options = toStartOptions(config);
  let started = false;
  let mismatchWarned = false;

  const ensureStarted = (): void => {
    if (started && status().running) return;
    try {
      const result = start(options);
      logger?.debug?.(
        `[shotium] in-process engine ready cache=${result.cacheActive ? result.cacheDir : 'off'}`,
      );
    } catch (error) {
      if (!status().running) throw error;
      if (!mismatchWarned) {
        mismatchWarned = true;
        logger?.warn?.(
          '[shotium] engine already started with different cacheDir/userAgent; reusing current process engine',
          error,
        );
      }
    }
    started = true;
  };

  return {
    async screenshot(shot) {
      ensureStarted();
      return screenshot(shot);
    },
    release() {
      if (status().running) releaseMemory();
    },
    describe: () => 'inprocess',
    async close() {
      if (status().running) releaseMemory({ releaseWorkingSet: true });
    },
  };
}

function createDaemonEngine(config: ShotiumConfig, logger?: HtmlRendererLogger): Engine {
  const options = { ...toStartOptions(config), idleTimeoutMs: config.idleTimeoutMs };
  let client: DaemonClient | null = null;
  let pending: Promise<DaemonClient> | null = null;

  const connect = async (): Promise<DaemonClient> => {
    if (client) return client;
    if (!pending) {
      pending = daemon.connect(options)
        .then((connected) => {
          client = connected;
          connected.once('close', () => {
            client = null;
            logger?.warn?.('[shotium] daemon connection closed; reconnecting on next render');
          });
          logger?.debug?.('[shotium] daemon engine connected');
          return connected;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };

  return {
    async screenshot(shot) {
      try {
        return await (await connect()).screenshot(shot);
      } catch {
        client = null;
        return (await connect()).screenshot(shot);
      }
    },
    release() {},
    describe: () => 'daemon',
    async close() {
      client?.close();
      client = null;
    },
  };
}

export function createEngine(config: ShotiumConfig, logger?: HtmlRendererLogger): Engine {
  return config.mode === 'daemon'
    ? createDaemonEngine(config, logger)
    : createInprocessEngine(config, logger);
}
