/**
 * NotificationRouter — 按 JobNotify.channel 分发任务结果（M3）
 */
import type { SendOptions } from '@zhin.js/core';
import { Logger, sceneRefToSendOptions } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import type { JobNotify } from './types.js';

const logger = new Logger(null, 'notification-router');

export type ImJobNotify = Extract<JobNotify, { channel: 'im' }>;

export interface NotificationRouterDeps {
  resolveAdapter: (platform: string) => { sendMessage: (opts: SendOptions) => Promise<string> } | undefined;
  /** M4 注入 HA REST；M3 未配置时仅记日志 */
  callHaService?: (service: string, target?: string, data?: unknown) => Promise<void>;
}

export interface DeliverParams {
  notify: JobNotify;
  content: string;
  jobId?: string;
  label?: string;
}

export interface DeliverResult {
  delivered: boolean;
  channel: JobNotify['channel'];
}

function assertImJobNotify(notify: ImJobNotify): void {
  const target = notify.target;
  if (!target || target.channel !== 'im') {
    throw new Error('IM notify requires target (IMDeliveryTarget)');
  }
  const scene = target.scene;
  if (!scene?.platform || !scene.endpointId || !scene.sceneId || !scene.kind) {
    throw new Error('IM notify target.scene requires platform, endpointId, sceneId, kind');
  }
}

/** 解析并校验持久化 notify（破坏性：不接受 flat platform/endpointId/sceneId/scope） */
export function parseJobNotify(notify: unknown): JobNotify {
  if (!notify || typeof notify !== 'object' || !('channel' in notify)) {
    throw new Error('Invalid notify: missing channel');
  }
  const parsed = notify as JobNotify;
  if (parsed.channel === 'im') {
    assertImJobNotify(parsed);
  }
  return parsed;
}

function mergeImTargets(primary: ImJobNotify, fallback: ImJobNotify): ImJobNotify {
  const p = primary.target;
  const f = fallback.target;
  return {
    channel: 'im',
    target: {
      channel: 'im',
      scene: {
        platform: p.scene.platform || f.scene.platform,
        endpointId: p.scene.endpointId || f.scene.endpointId,
        sceneId: p.scene.sceneId || f.scene.sceneId,
        kind: p.scene.kind || f.scene.kind,
        ...(p.scene.senderId ?? f.scene.senderId
          ? { senderId: p.scene.senderId ?? f.scene.senderId }
          : {}),
        ...(p.scene.parent ?? f.scene.parent
          ? { parent: p.scene.parent ?? f.scene.parent }
          : {}),
      },
      ...(p.threadId ?? f.threadId ? { threadId: p.threadId ?? f.threadId } : {}),
      ...(p.quoteId ?? f.quoteId ? { quoteId: p.quoteId ?? f.quoteId } : {}),
    },
  };
}

export function resolveEffectiveNotify(
  notify: JobNotify | undefined,
  defaults: JobNotify | undefined,
): JobNotify {
  if (notify) {
    if (notify.channel === 'im' && defaults?.channel === 'im') {
      return mergeImTargets(notify, defaults);
    }
    return notify;
  }
  if (defaults) return defaults;
  return { channel: 'silent' };
}

export function imNotifyToSendOptions(notify: ImJobNotify, content: string): SendOptions {
  return sceneRefToSendOptions(notify.target, content);
}

export function createNotificationRouter(deps: NotificationRouterDeps) {
  async function deliverIm(notify: ImJobNotify, content: string): Promise<DeliverResult> {
    const scene = notify.target.scene;
    if (!scene.platform || !scene.endpointId || !scene.sceneId) {
      logger.warn(formatCompact({
        op: 'notify_im_skip',
        reason: 'missing_routing',
        platform: scene.platform,
        endpointId: scene.endpointId,
        sceneId: scene.sceneId,
      }));
      return { delivered: false, channel: 'im' };
    }
    const adapter = deps.resolveAdapter(scene.platform);
    if (!adapter) {
      logger.warn(formatCompact({ op: 'notify_im_skip', reason: 'adapter_not_found', platform: scene.platform }));
      return { delivered: false, channel: 'im' };
    }
    await adapter.sendMessage(imNotifyToSendOptions(notify, content));
    return { delivered: true, channel: 'im' };
  }

  async function deliver(params: DeliverParams): Promise<DeliverResult> {
    const { notify, content, jobId, label } = params;
    switch (notify.channel) {
      case 'silent':
        return { delivered: false, channel: 'silent' };
      case 'log':
        logger.info(formatCompact({
          op: 'job_notify_log',
          jobId,
          label,
          chars: content.length,
          preview: content.slice(0, 120),
        }));
        return { delivered: false, channel: 'log' };
      case 'ha': {
        if (deps.callHaService) {
          await deps.callHaService(notify.service, notify.target, notify.data);
        } else {
          logger.info(formatCompact({
            op: 'job_notify_ha_stub',
            jobId,
            service: notify.service,
            target: notify.target,
          }));
        }
        return { delivered: true, channel: 'ha' };
      }
      case 'im':
        return deliverIm(notify, content);
    }
  }

  return { deliver, resolveEffectiveNotify };
}

export type NotificationRouter = ReturnType<typeof createNotificationRouter>;
