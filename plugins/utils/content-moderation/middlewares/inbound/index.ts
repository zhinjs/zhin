import { defineMiddleware, type MiddlewareContext } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { aiCompletionToken, createDeliveryTarget, databaseHostToken, getLogger, hasResource,
  outboundHostToken, usageSubjectFromMessage } from 'zhin.js';
import { adapterFeatureId, type AdapterIndex } from 'zhin.js/adapter';
import { groupRuleViolationToken, type GroupRuleViolationSink } from '@zhin.js/core/runtime';
import { generationAdmissionSource, type CapabilityId } from 'zhin.js/plugin-runtime';
import { resolveLocale } from 'zhin.js/i18n';
import {
  buildScanContext,
  extractFromTextAndSegments,
  resolveModerationConfig,
  shouldBypassInbound,
  type ModerationConfig,
} from '../../src/index.js';
import { moderationEngineToken } from '../../src/runtime.js';

/**
 * Inbound content moderation.
 * - order -100: run early before commands / other middleware
 * - inbound redact：无法改写只读 Message，仍 next() 放行
 */
export default defineMiddleware<Message, ModerationConfig>({
  target: 'inbound',
  phase: 'before-dispatch',
  order: -100,
  async handle(context, next) {
    const config = resolveModerationConfig(context.config);
    if (!config.enabled || !config.inbound.enabled) {
      await next();
      return;
    }

    const message = context.input;
    const locale = resolveLocale(message.locale);
    const sender = message.sender?.id;
    const conversationId = message.conversation.id;
    const endpointMasters = resolveEndpointMasters(message, config);

    const bypass = shouldBypassInbound(config, {
      sender,
      conversationId,
      endpointMasters,
    });
    const review = await enqueueGroupModeration(context, config, bypass);
    if (bypass) {
      await next();
      return;
    }

    // 引擎由 plugin setup 按 generation 配置一次（configure 含 provider 重建与
    // 词库 readFileSync，不能留在每条消息的热路径）；这里只做判定。
    const engine = context.use(moderationEngineToken);

    const extracted = extractFromTextAndSegments(message.content, message.segments);
    if (!extracted.text && extracted.images.length === 0) {
      await next();
      return;
    }

    const scanInput = {
      text: extracted.text,
      images: extracted.images,
      direction: 'inbound' as const,
      context: buildScanContext({
        adapter: message.conversation.endpoint.adapter,
        endpoint: message.conversation.endpoint.id,
        conversationKind: message.conversation.kind,
        conversationId,
        sender,
      }),
    };

    const result = await engine.apply({
      direction: 'inbound',
      locale,
      recallManaged: review?.done,
      extracted,
      scanInput,
      hooks: {
        reply: async (content) => {
          await message.$reply(content);
        },
        recall: async () => {
          const messageId = message.id;
          if (!messageId) return false;
          try {
            const host = context.use(outboundHostToken);
            if (!host.recall) return false;
            const conv = message.conversation;
            await host.recall({
              adapter: conv.endpoint.adapter,
              endpointKey: conv.endpoint.id,
              message: {
                conversation: {
                  kind: conv.kind,
                  id: conv.id,
                  endpoint: conv.endpoint,
                },
                id: messageId,
              },
            });
            return true;
          } catch {
            return false;
          }
        },
      },
    });

    if (result.continue) {
      await next();
    }
  },
});

async function enqueueGroupModeration(
  context: MiddlewareContext<Message, ModerationConfig, string | undefined>,
  config: ModerationConfig, bypass: boolean,
): Promise<{ done: Promise<boolean> } | undefined> {
  const message = context.input;
  const locale = resolveLocale(message.locale);
  const conversation = structuredClone(message.conversation);
  const target = config.groupModeration.find((item) => conversation.kind === 'group'
    && item.adapter === conversation.endpoint.adapter
    && item.endpoint === message.endpointId && item.group === conversation.id);
  if (!target) return;
  const logger = getLogger('content-moderation');
  try {
    const adapters = context.project<AdapterIndex>(adapterFeatureId);
    const endpoint = adapters.connection(conversation.endpoint.adapter, conversation.endpoint.id);
    // Reject alias fallback and account switches, even when a local instance name is reused.
    if (!endpoint || endpoint.identity.id !== conversation.endpoint.id
      || endpoint.identity.adapter !== target.adapter || endpoint.selfUserId !== target.account) return;
    const engine = context.use(moderationEngineToken);
    const { text } = extractFromTextAndSegments(message.content, message.segments);
    const destination = createDeliveryTarget({ conversation });
    const scope = JSON.stringify(destination);
    const remembered = engine.groupModerator.remember(scope, message.sender?.id ?? '', text);
    // ADR 0039 §5: punishment is the group rule's job. A configured group gets default pending rules once,
    // and stays reminder / warning only until an owner or admin confirms them.
    const rules: GroupRuleViolationSink | undefined = hasResource(context, groupRuleViolationToken)
      ? context.use(groupRuleViolationToken) : undefined;
    if (rules) {
      engine.groupModerator.ensureRules(scope, async () => {
        for (const trigger of ['advertising', 'abuse'] as const) {
          const outcome = await rules.ensureDefaultRule({ conversation, trigger });
          if (outcome === 'unavailable') throw new Error('Group rule storage unavailable');
          if (outcome === 'created') logger.info({ event: 'group_rule_migrated', trigger, endpoint: conversation.endpoint.id, group: conversation.id });
        }
      });
    }
    if (!bypass && message.sender?.id && message.origin !== 'self'
      && hasResource(context, aiCompletionToken) && hasResource(context, databaseHostToken)
      && hasResource(context, outboundHostToken)) {
      const host = context.use(outboundHostToken);
      if (!host.sendTarget) return;
      const client = context.$client;
      if (client === undefined) throw new Error('Moderation source Client is unavailable');
      // This work outlives the Message. Its own lease keeps the captured incarnation's
      // cancellation wired after the inbound operation releases its child lease.
      const child = adapters.acquire(conversation.endpoint.id as CapabilityId, context.signal, client);
      const detach: Array<() => void> = [];
      const finish = () => {
        try { detach.forEach(remove => remove()); } finally { child.release(); }
      };
      try {
        const lifetime = new AbortController();
        const gates = adapters[generationAdmissionSource] ?? [];
        for (const gate of gates) detach.push(gate.onDeactivate(() => lifetime.abort(new Error('Moderation adapter generation retired'))));
        const signal = AbortSignal.any([context.signal, lifetime.signal, child.signal]);
        const messageId = message.id ?? '';
        const management = adapters.management(conversation.endpoint.id as CapabilityId);
        const assertTarget = () => {
          signal.throwIfAborted();
          child.assertActive();
          if (endpoint.identity.id !== conversation.endpoint.id || endpoint.selfUserId !== target.account
            || endpoint.identity.adapter !== target.adapter || gates.some(gate => !gate.active)) {
            throw new Error('Moderation target account is no longer active');
          }
        };
        const queued = await engine.groupReviewQueue.enqueue({
          scope, group: conversation.id, sender: message.sender.id, locale,
          messageId, sentAt: Number(message.metadata?.platformSentAt), text, ...remembered,
          signal,
          state: context.use(databaseHostToken).state.forConversation(destination),
          completion: context.use(aiCompletionToken), management: {
            inspectGroupMember: management?.inspectGroupMember ? async (group, member, operationSignal) => {
              assertTarget(); return management.inspectGroupMember!(group, member, operationSignal);
            } : undefined,
          },
          ...(rules ? { rules: async (hit) => {
            assertTarget();
            return rules.report({
              conversation, memberId: message.sender!.id, trigger: hit.category, newcomer: hit.newcomer,
              sentAt: Number(message.metadata?.platformSentAt), evidence: hit.evidence,
              ...(message.sender?.name ? { memberName: message.sender.name } : {}),
              ...(message.sender?.roles ? { memberRoles: message.sender.roles } : {}),
              ...(messageId ? { messageId } : {}),
              ...(hit.recall ? { recall: hit.recall } : {}),
            });
          } } : {}),
          onBehalfOf: usageSubjectFromMessage(message),
          reply: async (content, mention) => {
            assertTarget();
            const receipt = await host.sendTarget!(destination, mention ? [
              { type: 'mention', data: { target: mention } },
              { type: 'text', data: { text: ` ${content}` } },
            ] : content, { locale });
            if (!receipt) throw new Error('Moderation notice was not confirmed');
          },
          recall: async () => {
            assertTarget();
            if (!host.recall || !messageId) throw new Error('Original message cannot be recalled');
            await host.recall({ adapter: target.adapter, endpointKey: conversation.endpoint.id,
              message: { conversation, id: messageId } });
          },
          audit: (event) => logger.info({ ...event, endpoint: conversation.endpoint.id, group: conversation.id }),
        });
        return { done: queued.done.finally(finish) };
      } catch (error) {
        finish(); throw error;
      }
    }
  } catch (error) {
    logger.warn('Automatic group moderation unavailable', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Masters from plugin config + optional metadata.endpointMaster / metadata.master.
 */
function resolveEndpointMasters(
  message: Message,
  config: ModerationConfig,
): readonly string[] {
  const out: string[] = [...config.masters];
  const meta = message.metadata ?? {};
  for (const key of ['master', 'endpointMaster', 'owner'] as const) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  }
  return Object.freeze(out);
}
