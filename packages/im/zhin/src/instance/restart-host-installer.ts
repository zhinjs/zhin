import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { adapterFeatureId, isAdapterIndex, type AdapterIndex } from '@zhin.js/adapter';
import type { ChatRoleService } from '@zhin.js/core';
import { commandFeatureId, defineCommand, type CommandContext } from '@zhin.js/command';
import { readOperationSession, type OperationSession } from '@zhin.js/feature-kit';
import {
  createMessages,
  normalizeDeliveryTarget,
  type DeliveryTarget,
  type Locale,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { senderIsGlobalOwner, type ImRuntime } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';

const RESTART_RECEIPT_RELATIVE_PATH = join('.zhin', 'restart-receipt.json');
/** Stale restart receipts older than 5 minutes are discarded without sending. */
export const MAX_RESTART_RECEIPT_AGE_MS = 5 * 60_000;
/** Maximum time to wait for the target IM endpoint to reach `online` after startup. */
export const DEFAULT_ENDPOINT_ONLINE_WAIT_MS = 15_000;
const ENDPOINT_POLL_INTERVAL_MS = 200;

const messages = createMessages({
  description: {
    'zh-CN': '安全重启 Bot 进程，并在重启完成后于当前会话回报结果（仅限 Bot 主人）',
    en: 'Safely restart the Bot process and report the outcome in this conversation (Bot owner only)',
  },
  denied: {
    'zh-CN': '仅允许全局层 Bot 主人（owner）执行重启指令。',
    en: 'Only a global Bot owner (chat role owner at the global level) is allowed to restart the bot.',
  },
  unsupported: {
    'zh-CN': '当前进程未受 Supervisor 守护（如使用了 --once 或裸 node 启动），无法在聊天中自动重启；请在宿主机重启服务。',
    en: 'This process is not supervised (e.g. started with --once or bare node) and cannot self-restart from chat.',
  },
  restarting: {
    'zh-CN': '🔄 正在重启 Bot，重启完成后将在当前会话通知你…',
    en: '🔄 Restarting Bot. Will report back in this conversation once online...',
  },
  persistFailed: {
    'zh-CN': '无法写入重启回执，已取消重启。',
    en: 'Failed to persist restart receipt; restart aborted.',
  },
});

export interface PendingRestartReceipt {
  readonly version: 1;
  readonly requestedAt: number;
  readonly previousPid: number;
  readonly target: DeliveryTarget;
  readonly senderId: string;
  readonly locale: Locale;
}

export type RestartChatAuthorizer = (session: OperationSession<string>, adapters: AdapterIndex) => boolean;

/**
 * Authorizes a chat-initiated restart in private, group, or channel conversations when the sender
 * is a **global** chat-role `owner` (ADR 0056 §2): restarting the instance is host-wide, so owners
 * of a conversation, account or adapter do not qualify.
 */
export function createRestartChatAuthorizer(
  roles: () => ChatRoleService | undefined,
  snapshot: () => Pick<RuntimeSnapshot, 'tree'> | undefined = () => undefined,
): RestartChatAuthorizer {
  return (session, adapters) => {
    if (!session.sender?.id || !isAdapterIndex(adapters) || session.signal.aborted) return false;
    return senderIsGlobalOwner(session, adapters, roles(), snapshot());
  };
}

export function resolveRestartReceiptFile(projectRoot: string): string {
  return join(projectRoot, RESTART_RECEIPT_RELATIVE_PATH);
}

export async function writePendingRestartReceipt(
  projectRoot: string,
  receipt: PendingRestartReceipt,
): Promise<void> {
  const filePath = resolveRestartReceiptFile(projectRoot);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

export async function consumePendingRestartReceipt(
  projectRoot: string,
): Promise<PendingRestartReceipt | null> {
  const filePath = resolveRestartReceiptFile(projectRoot);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  await rm(filePath, { force: true }).catch(() => undefined);
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRestartReceipt>;
    if (
      parsed?.version !== 1 ||
      typeof parsed.requestedAt !== 'number' ||
      !Number.isFinite(parsed.requestedAt) ||
      typeof parsed.previousPid !== 'number' ||
      typeof parsed.senderId !== 'string' ||
      !parsed.target
    ) {
      return null;
    }
    const target = normalizeDeliveryTarget(parsed.target);
    const locale: Locale = parsed.locale === 'en' ? 'en' : 'zh-CN';
    return Object.freeze({
      version: 1,
      requestedAt: parsed.requestedAt,
      previousPid: parsed.previousPid,
      target,
      senderId: parsed.senderId,
      locale,
    });
  } catch {
    return null;
  }
}

export function formatRestartCompletedMessage(input: {
  readonly locale: Locale;
  readonly elapsedMs: number;
  readonly pid: number;
  readonly generation: number;
  readonly plugins: number;
}): string {
  const elapsedSec = Math.max(0.1, input.elapsedMs / 1000).toFixed(1);
  if (input.locale === 'en') {
    return `✅ Bot restarted successfully (${elapsedSec}s · PID ${input.pid} · Generation #${input.generation} · ${input.plugins} plugins loaded)`;
  }
  return `✅ Bot 重启完成（耗时 ${elapsedSec}s · PID ${input.pid} · Generation #${input.generation} · 已加载 ${input.plugins} 个插件）`;
}

export interface InstallRestartHostOptions {
  readonly projectRoot: string;
  readonly authorize: RestartChatAuthorizer;
  readonly restartSupported: () => boolean;
  readonly requestRestart: () => void | Promise<void>;
  /** Delay before invoking `requestRestart` so the pre-restart reply finishes sending. Default 120ms. */
  readonly restartDelayMs?: number;
}

export function installRestartHost(options: InstallRestartHostOptions): RootResourceInstaller {
  const delayMs = options.restartDelayMs ?? 120;
  return (context) => {
    if (!context.hasFeature?.(commandFeatureId)) return;
    context.addFeature(
      commandFeatureId,
      'restart',
      defineCommand({
        description: messages('zh-CN', 'description'),
        descriptionI18n: { en: messages('en', 'description') },
        alias: ['重启', 'reboot'],
        params: {},
        options: {},
        execute: async (command: CommandContext) => {
          const session = readOperationSession(command.input);
          const adapters = command.project<AdapterIndex>(adapterFeatureId);
          let allowed = false;
          try {
            allowed = Boolean(session && isAdapterIndex(adapters) && options.authorize(session, adapters));
          } catch {
            allowed = false;
          }
          if (!allowed || !session) {
            return messages(command.locale, 'denied');
          }
          if (!options.restartSupported()) {
            return messages(command.locale, 'unsupported');
          }
          try {
            const target = normalizeDeliveryTarget(session.scene);
            await writePendingRestartReceipt(options.projectRoot, {
              version: 1,
              requestedAt: Date.now(),
              previousPid: process.pid,
              target,
              senderId: session.sender?.id ?? '',
              locale: command.locale,
            });
          } catch {
            return messages(command.locale, 'persistFailed');
          }
          const timer = setTimeout(() => {
            void options.requestRestart();
          }, delayMs);
          timer.unref?.();
          return messages(command.locale, 'restarting');
        },
      }),
    );
  };
}

export interface DeliverPendingRestartReceiptOptions {
  readonly projectRoot: string;
  readonly im: Pick<ImRuntime, 'endpoints'>;
  readonly snapshot: Readonly<{ generation: number; plugins: number }>;
  readonly maxWaitMs?: number;
  readonly now?: () => number;
}

/**
 * Checks for `.zhin/restart-receipt.json` on process startup, waits for the
 * originating IM endpoint to become `online`, and delivers the restart
 * completion reply back to the exact conversation that requested the restart.
 */
export async function deliverPendingRestartReceipt(
  options: DeliverPendingRestartReceiptOptions,
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const receipt = await consumePendingRestartReceipt(options.projectRoot);
  if (!receipt) return false;

  const elapsedAtStart = now() - receipt.requestedAt;
  if (elapsedAtStart < 0 || elapsedAtStart > MAX_RESTART_RECEIPT_AGE_MS) {
    getLogger('runtime').warn(
      formatCompact({
        op: 'restart_receipt_expired',
        age_ms: elapsedAtStart,
        endpoint: receipt.target.endpoint.id,
      }),
    );
    return false;
  }

  const maxWaitMs = options.maxWaitMs ?? DEFAULT_ENDPOINT_ONLINE_WAIT_MS;
  const deadline = now() + maxWaitMs;
  while (now() < deadline) {
    const endpoints = options.im.endpoints.list();
    const match = endpoints.find((ep) => ep.id === receipt.target.endpoint.id);
    if (match && (match.status === 'online' || (match.admitted && match.transportState !== 'connecting'))) {
      break;
    }
    await new Promise((resolve) => {
      const t = setTimeout(resolve, ENDPOINT_POLL_INTERVAL_MS);
      t.unref?.();
    });
  }

  const message = formatRestartCompletedMessage({
    locale: receipt.locale,
    elapsedMs: Math.max(100, now() - receipt.requestedAt),
    pid: process.pid,
    generation: options.snapshot.generation,
    plugins: options.snapshot.plugins,
  });

  try {
    await options.im.endpoints.sendTarget(receipt.target, message, undefined, {
      locale: receipt.locale,
    });
    getLogger('runtime').info(
      formatCompact({
        op: 'restart_receipt_delivered',
        adapter: receipt.target.endpoint.adapter,
        endpoint: receipt.target.endpoint.id,
        conversation: `${receipt.target.kind}:${receipt.target.id}`,
      }),
    );
    return true;
  } catch (error) {
    getLogger('runtime').warn(
      formatCompact({
        op: 'restart_receipt_delivery_failed',
        adapter: receipt.target.endpoint.adapter,
        endpoint: receipt.target.endpoint.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
}
