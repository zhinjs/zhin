/**
 * ImResultSink — 子代理结果经 proactive 出站链投递（ADR 0004）。
 */
import { sceneRefFromMessage, type Message, type SendOptions } from '@zhin.js/core';
import { deliverSubagentResult } from '../media/deliver-subagent-result.js';
import { buildSubagentUserDelivery } from '../media/subagent-user-delivery.js';
import type { SubagentOrigin, SubagentResultDelivery, SubagentResultSender } from '../subagent/index.js';
import type { ProactiveOutboundService } from '../outbound/send-proactive.js';
import type { ResultSink, SubagentResult } from './contracts.js';

export interface ImResultSinkDeps {
  proactiveOutbound: ProactiveOutboundService;
}

export class ImResultSink implements ResultSink {
  constructor(private readonly deps: ImResultSinkDeps) {}

  asResultSender(): SubagentResultSender {
    return (origin, delivery) => this.deliverToIm(origin, delivery);
  }

  async deliver(result: SubagentResult): Promise<void> {
    const origin = (result as SubagentResult & { origin?: SubagentOrigin }).origin;
    if (!origin) return;
    const status = result.status === 'completed' ? 'ok' : 'error';
    const delivery = buildSubagentUserDelivery({
      label: result.taskId,
      status,
      result: result.result,
      toolCalls: [],
    });
    await this.deliverToIm(origin, delivery);
  }

  private async deliverToIm(
    origin: SubagentOrigin,
    delivery: SubagentResultDelivery,
  ): Promise<void> {
    const scene = sceneRefFromMessage(origin.message);
    if (!scene) return;

    await deliverSubagentResult({
      origin,
      delivery,
      send: (opts: SendOptions) => this.deps.proactiveOutbound.send({
        scene,
        source: 'subagent',
        originMessage: origin.message,
        quoteMessageId: opts.quoteId,
      }, opts.content),
    });
  }
}

export function createImResultSender(deps: ImResultSinkDeps): SubagentResultSender {
  return new ImResultSink(deps).asResultSender();
}
