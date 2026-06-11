/**
 * NotificationRouter — 按 JobNotify.channel 分发任务结果（M3）
 */
import type { MessageType, SendOptions } from '@zhin.js/core';
import { Logger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import { toSendOptions, type NormalizedQueueOutboundDetail } from '@zhin.js/core/queue-im-field-contract';
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

export function mergeImNotify(notify: ImJobNotify, defaults?: JobNotify): ImJobNotify {
  const def = defaults?.channel === 'im' ? defaults : undefined;
  return {
    channel: 'im',
    platform: notify.platform ?? def?.platform,
    endpointId: notify.endpointId ?? def?.endpointId,
    senderId: notify.senderId ?? def?.senderId,
    sceneId: notify.sceneId ?? def?.sceneId,
    scope: notify.scope ?? def?.scope,
  };
}

export function resolveEffectiveNotify(
  notify: JobNotify | undefined,
  defaults: JobNotify | undefined,
): JobNotify {
  if (notify) {
    if (notify.channel === 'im') {
      return mergeImNotify(notify, defaults);
    }
    return notify;
  }
  if (defaults) return defaults;
  return { channel: 'silent' };
}

export function notifyToSendOptions(notify: ImJobNotify, content: string): SendOptions {
  if (!notify.endpointId) throw new Error('Missing notify field: endpointId');
  const sceneType = (notify.scope || 'private') as MessageType;
  const outboundDetail: NormalizedQueueOutboundDetail = {
    context: notify.platform || 'cron',
    endpoint: notify.endpointId,
    channelId: notify.sceneId || 'cron',
    channelType: sceneType,
    content,
  };
  if (notify.senderId) outboundDetail.senderId = notify.senderId;
  return toSendOptions(outboundDetail);
}

export function createNotificationRouter(deps: NotificationRouterDeps) {
  async function deliverIm(notify: ImJobNotify, content: string): Promise<DeliverResult> {
    if (!notify.platform || !notify.endpointId || !notify.sceneId) {
      logger.warn(formatCompact({
        op: 'notify_im_skip',
        reason: 'missing_routing',
        platform: notify.platform,
        endpointId: notify.endpointId,
        sceneId: notify.sceneId,
      }));
      return { delivered: false, channel: 'im' };
    }
    const adapter = deps.resolveAdapter(notify.platform);
    if (!adapter) {
      logger.warn(formatCompact({ op: 'notify_im_skip', reason: 'adapter_not_found', platform: notify.platform }));
      return { delivered: false, channel: 'im' };
    }
    await adapter.sendMessage(notifyToSendOptions(notify, content));
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
