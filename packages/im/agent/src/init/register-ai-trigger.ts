/**
 * Register AI trigger handler via the core MessageDispatcher inbound pipeline.
 */
import './types.js';
import {
  getPlugin,
  resolveSenderRoles,
  isAtBot,
  mergeAITriggerConfig,
  Message,
  prependQuoteContext,
  QUOTE_CONTEXT_SYSTEM_EXTRA_KEY,
  QUOTE_CONTEXT_SYSTEM_HINT,
  QUOTED_MESSAGE_CONTEXT_MARKER,
  resolveQuotedMessagePayload,
  segment,
  shouldTriggerAI,
} from '@zhin.js/core';
import { extractMediaParts, extractMediaPartsFromQuotedPayload } from './message-media.js';
import type { Plugin, Tool, ToolContext } from '@zhin.js/core';
import type { ContentPart } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import type { AIServiceRefs } from './shared-refs.js';
import {
  preprocessInboundMedia,
  publishOutboundElements,
  resolveMultimodalConfig,
  INBOUND_MEDIA_PARTS_EXTRA_KEY,
  buildSubagentInboundTask,
} from '../media/index.js';
import { providerSupportsVision } from '../media/vision-capability.js';
import { resolveRoutedAgentName } from '../routing/route-matcher.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
import { discoverWorkspaceAgents, loadAgentMarkdownBody } from '../discovery/agents.js';
import { summarizeSubagentResultForUser } from '../routing/subagent-summarize.js';
import { originFromToolContext } from '../builtin/spawn-task-tool.js';
import { parseOutput, resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import { canAccessTool } from '../orchestrator/tool-selection.js';
import { inferFileRole } from '../security/file-role-policy.js';
import { formatCompactLog, truncatePreview } from '@zhin.js/logger';
import { formatAiHandlerCompleteLog } from '../zhin-agent/turn-metrics.js';
import {
  formatSubagentProcessingMessage,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
  type SubagentProcessingNotice,
} from '../subagent-goal-notify.js';

function resolveBotAtIds(message: Message<any>, root: Plugin): string[] {
  const ids = new Set<string>([String(message.$bot)]);
  try {
    const adapter = root.inject(message.$adapter) as
      | { bots?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }> }
      | undefined;
    const bot = adapter?.bots?.get(message.$bot);
    const cfg = bot?.$config;
    if (cfg?.name) ids.add(String(cfg.name));
    if (cfg?.appid) ids.add(String(cfg.appid));
    if (bot?.$platformUserId) ids.add(String(bot.$platformUserId));
  } catch {
    // adapter 未就绪时仍用 message.$bot
  }
  return [...ids];
}

export function registerAITrigger(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    const rawConfig = ai.getTriggerConfig();
    const triggerConfig = mergeAITriggerConfig(rawConfig);
    if (!triggerConfig.enabled) {
      logger.info(formatCompactLog('AI Handler', { disabled: true }));
      return;
    }

    const dispatcherSvc = root.inject('dispatcher') as
      | {
          replyWithPolish?: (
            m: Message<any>,
            s: 'ai' | 'command',
            c: unknown,
            options?: { quote?: boolean | string },
          ) => Promise<unknown>;
        }
      | undefined;

    const handleAIMessage = async (
      message: Message<any>,
      content: string,
    ) => {
      const replyOptions = { quote: true as const };

      const replyOutbound = async (payload: unknown) => {
        if (dispatcherSvc && typeof dispatcherSvc.replyWithPolish === 'function') {
          return dispatcherSvc.replyWithPolish(message, 'ai', payload as any, replyOptions);
        }
        return message.$reply(payload as any, true);
      };

      const t0 = performance.now();
      if (!ai.isReady()) {
        logger.warn(formatCompactLog('AI Handler', { skip: 'not_ready', bot: message.$bot }));
        await replyOutbound('AI 服务未就绪，请检查 zhin.config.yml 中的 providers 配置。');
        return;
      }
      if (!refs.zhinAgent) {
        logger.warn(formatCompactLog('AI Handler', { skip: 'no_zhin_agent', bot: message.$bot }));
        await replyOutbound('AI Agent 未初始化，请查看启动日志。');
        return;
      }
      if (triggerConfig.thinkingMessage)
        await replyOutbound(triggerConfig.thinkingMessage);

      const adapterInstance = root.inject(message.$adapter) as
        | { bots?: Map<string, { $config?: Record<string, any> }> }
        | undefined;
      const botConfig = adapterInstance?.bots?.get(message.$bot)?.$config as Record<string, any> | undefined;
      const { scope, roles } = resolveSenderRoles(message, triggerConfig, botConfig);

      const toolContext: ToolContext = {
        platform: message.$adapter,
        botId: message.$bot,
        messageId: message.$id,
        sceneId: message.$channel?.id || message.$sender.id,
        senderId: message.$sender.id,
        message,
        scope,
        roles,
        fileRole: inferFileRole({ roles }),
        extra: {
          [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: async (notice: SubagentProcessingNotice) => {
            await replyOutbound(formatSubagentProcessingMessage(notice));
          },
        },
      };

      const tCollect = performance.now();
      const toolService = root.inject('tool');
      let externalTools: Tool[] = [...ai.getResidentToolsAsTools()];
      if (toolService) {
        externalTools.push(...toolService.getAll());
        externalTools = toolService.filterByContext(externalTools, toolContext);
      } else {
        externalTools = externalTools.filter(t => canAccessTool(t, toolContext));
      }
      logger.debug(formatCompactLog('AI Handler', {
        tools: externalTools.length,
        collect_ms: Math.round(performance.now() - tCollect),
      }));

      try {
        // 每轮 LLM 调用在 Agent 内部已有 turnTimeout（来自 triggerConfig.timeout），
        // 这里不再设置全局超时，避免多轮工具调用被不合理地截断。

        let mediaParts = extractMediaParts(message);
        if (message.$quote_id && triggerConfig.resolveQuotedMessages) {
          const quoted = await resolveQuotedMessagePayload(message, root, {
            enabled: true,
          });
          if (quoted) {
            const fromQuote = extractMediaPartsFromQuotedPayload(
              quoted,
              message.$adapter,
            );
            if (fromQuote.length) {
              mediaParts = [...fromQuote, ...mediaParts];
            }
          }
        }
        let elements: OutputElement[];
        let firstChunkMs = 0;
        const onChunk: (chunk: string, full: string) => void = (_chunk, _full) => {
          if (!firstChunkMs) {
            firstChunkMs = performance.now() - t0;
            logger.debug(formatCompactLog('AI Handler', { first_token_ms: Math.round(firstChunkMs) }));
          }
        };
        const aiContent = await prependQuoteContext(message, root, content, {
          enabled: triggerConfig.resolveQuotedMessages,
        });
        if (aiContent.includes(QUOTED_MESSAGE_CONTEXT_MARKER)) {
          toolContext.extra = {
            ...toolContext.extra,
            [QUOTE_CONTEXT_SYSTEM_EXTRA_KEY]: QUOTE_CONTEXT_SYSTEM_HINT,
          };
        }

        const routing = refs.aiService?.getRoutingConfig();
        const bindingRegistry = refs.aiService?.getBindingRegistry();
        let routedAgent = DEFAULT_ZHIN_AGENT_NAME;
        if (refs.aiService && routing && bindingRegistry) {
          const agentMetas = await discoverWorkspaceAgents(root);
          refs.aiService.setDiscoveredAgents(agentMetas);
          routedAgent = resolveRoutedAgentName(routing.agents, {
            message,
            contentText: aiContent,
            discoveredAgentNames: bindingRegistry.getDiscoveredAgentNames(),
          });
        }

        if (
          routedAgent !== DEFAULT_ZHIN_AGENT_NAME
          && refs.aiService
          && bindingRegistry
          && refs.zhinAgent
        ) {
          const routeBinding = bindingRegistry.getBinding(routedAgent);
          const subMgr = refs.zhinAgent.getSubagentManager();
          const meta = (await discoverWorkspaceAgents(root)).find(m => m.name === routedAgent);
          if (routeBinding && subMgr && meta) {
            const systemBody = await loadAgentMarkdownBody(meta.filePath);
            const origin = originFromToolContext(toolContext);
            const routeProvider = refs.aiService?.getProvider(routeBinding.providerAlias);
            const workspaceDir = process.cwd();
            const inbound = await buildSubagentInboundTask(aiContent, mediaParts, {
              workspaceDir,
              provider: routeProvider ?? undefined,
            });
            logger.info(formatCompactLog('AI Handler', {
              route: routedAgent,
              subagent_media_parts: inbound.mediaPartCount,
              subagent_payloads: inbound.payloadCount,
              subagent_spooled: inbound.spooledPaths.join(';') || 'none',
              subagent_native_vision: inbound.useNativeVision,
              subagent_vision_parts: inbound.visionPartCount,
            }));
            if (inbound.mediaPartCount > 0 && inbound.payloadCount === 0) {
              logger.warn(formatCompactLog('AI Handler', {
                route: routedAgent,
                warn: 'subagent_media_no_payload',
                media_parts: inbound.mediaPartCount,
              }));
            }
            const subResult = await subMgr.spawnSync({
              task: aiContent,
              runInput: inbound.runInput,
              label: routedAgent,
              origin,
              agent: routedAgent,
              binding: routeBinding,
              systemPrompt: systemBody || undefined,
              notifyContext: toolContext,
            });

            const sessionId = resolveIMSessionIdFromToolContext({
              platform: toolContext.platform,
              botId: toolContext.botId,
              scope: toolContext.scope,
              sceneId: toolContext.sceneId,
              senderId: toolContext.senderId,
            });
            const emitter = refs.zhinAgent.getEventEmitter();
            let summary = '';
            try {
              await emitter.dispatch('ai.processing.start', emitter.createPayload(sessionId, toolContext, 'text', {
                content: aiContent,
                agentId: DEFAULT_ZHIN_AGENT_NAME,
                label: 'summarize',
              }));
              summary = await summarizeSubagentResultForUser(
                refs.aiService,
                routedAgent,
                aiContent,
                subResult,
              );
              await emitter.dispatch('ai.response', emitter.createPayload(sessionId, toolContext, 'text', {
                path: 'agent',
                agentId: DEFAULT_ZHIN_AGENT_NAME,
                reply: summary,
              }));
            } catch (summarizeErr) {
              const msg = summarizeErr instanceof Error ? summarizeErr.message : String(summarizeErr);
              await emitter.dispatch('ai.processing.error', emitter.createPayload(sessionId, toolContext, 'text', {
                error: msg,
                agentId: DEFAULT_ZHIN_AGENT_NAME,
              }));
              throw summarizeErr;
            } finally {
              await emitter.dispatch('ai.processing.finish', emitter.createPayload(sessionId, toolContext, 'text', {
                reply: summary,
                agentId: DEFAULT_ZHIN_AGENT_NAME,
              }));
              emitter.emit('ai.typing.stop', emitter.createPayload(sessionId, toolContext, 'text', {
                reason: 'route_done',
              }));
            }

            const elements = parseOutput(summary);
            const outboundSegments = await publishOutboundElements(elements, message.$adapter);
            if (outboundSegments.length) await replyOutbound(outboundSegments);
            logger.info(formatCompactLog('AI Handler', {
              route: routedAgent,
              path: 'spawn_sync',
              total_ms: Math.round(performance.now() - t0),
            }));
            return;
          }
        }

        const zhinBinding = bindingRegistry?.getBinding(DEFAULT_ZHIN_AGENT_NAME)
          ?? bindingRegistry?.requireZhinBinding();
        if (zhinBinding) refs.zhinAgent?.setActiveBinding(zhinBinding);

        const mmConfig = resolveMultimodalConfig();
        if (mediaParts.length > 0 && mmConfig.enabled) {
          const pre = await preprocessInboundMedia(mediaParts, mmConfig);
          const fullContent = [aiContent, pre.textAppend].filter(Boolean).join('\n\n');
          const visionProvider = zhinBinding && refs.aiService?.isReady()
            ? refs.aiService.getProvider(zhinBinding.providerAlias)
            : refs.aiService?.getProvider();
          const canInjectVision = pre.visionParts.length > 0
            && refs.aiService?.isReady()
            && visionProvider
            && providerSupportsVision(visionProvider);
          if (canInjectVision) {
            toolContext.extra = {
              ...toolContext.extra,
              [INBOUND_MEDIA_PARTS_EXTRA_KEY]: pre.visionParts,
            };
          }
          try {
            elements = await refs.zhinAgent.process(fullContent, toolContext, externalTools, onChunk);
          } catch (procErr) {
            logger.warn(formatCompactLog('AI Handler', {
              multimodal_fallback: true,
              error: truncatePreview(procErr instanceof Error ? procErr.message : String(procErr)),
            }));
            const parts: ContentPart[] = [];
            if (aiContent) parts.push({ type: 'text', text: aiContent });
            parts.push(...mediaParts);
            elements = await refs.zhinAgent.processMultimodal(parts, toolContext, onChunk);
          }
        } else if (mediaParts.length > 0) {
          const parts: ContentPart[] = [];
          if (aiContent) parts.push({ type: 'text', text: aiContent });
          parts.push(...mediaParts);
          elements = await refs.zhinAgent.processMultimodal(parts, toolContext, onChunk);
        } else {
          elements = await refs.zhinAgent.process(aiContent, toolContext, externalTools, onChunk);
        }
        const outboundSegments = await publishOutboundElements(elements, message.$adapter);
        if (outboundSegments.length) await replyOutbound(outboundSegments);
        const totalMs = performance.now() - t0;
        const turnMetrics = refs.zhinAgent.getLastTurnMetrics();
        if (turnMetrics) {
          logger.info(formatAiHandlerCompleteLog(turnMetrics, totalMs));
        } else {
          logger.info(formatCompactLog('AI Handler', { total_ms: Math.round(totalMs), usage: 'n/a' }));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompactLog('AI Handler', {
          total_ms: Math.round(performance.now() - t0),
          ok: false,
          error: truncatePreview(msg),
        }));
        await replyOutbound(triggerConfig.errorTemplate.replace('{error}', msg));
      }
    };

    const dispatcher = root.inject('dispatcher');

    if (!dispatcher || typeof dispatcher.setAIHandler !== 'function') {
      logger.warn(formatCompactLog('AI Handler', { error: 'no_dispatcher' }));
      return;
    }

    dispatcher.setAITriggerMatcher((message: Message<any>) => {
      const botAtIds = resolveBotAtIds(message, root);
      const result = shouldTriggerAI(message, triggerConfig, { botAtIds });
      logger.debug(formatCompactLog('AI Trigger', {
        adapter: message.$adapter,
        bot: message.$bot,
        at: isAtBot(message, botAtIds),
        triggered: result.triggered,
        preview: truncatePreview(segment.raw(message.$content)),
      }));
      return result;
    });
    dispatcher.setAIHandler(handleAIMessage);
    logger.debug(formatCompactLog('AI Handler', { hook: 'on' }));
    return () => { logger.debug(formatCompactLog('AI Handler', { hook: 'off' })); };
  });
}
