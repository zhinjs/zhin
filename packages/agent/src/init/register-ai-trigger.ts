/**
 * Register AI trigger handler via MessageDispatcher or fallback middleware.
 */
import './types.js';
import { getPlugin, Message, shouldTriggerAI, inferSenderPermissions, parseRichMediaContent, mergeAITriggerConfig } from '@zhin.js/core';
import type { Tool, ToolContext } from '@zhin.js/core';
import type { ContentPart } from '@zhin.js/core';
import type { OutputElement } from '../output.js';
import type { AIServiceRefs } from './shared-refs.js';

/**
 * Extract multimodal ContentPart[] from a Message's structured $content segments.
 * Handles image, video, audio, and face/sticker types.
 * Falls back to raw string parsing for image URLs when $content has no media segments.
 */
function extractMediaParts(message: Message<any>): ContentPart[] {
  const parts: ContentPart[] = [];

  // 1. Extract from structured $content segments
  if (Array.isArray(message.$content)) {
    for (const seg of message.$content) {
      if (typeof seg === 'string' || !seg || !seg.type) continue;
      const { type, data } = seg;
      switch (type) {
        case 'image': {
          const url = data?.url || data?.file || data?.src;
          if (url) parts.push({ type: 'image_url', image_url: { url } });
          break;
        }
        case 'video': {
          const url = data?.url || data?.file || data?.src;
          if (url) parts.push({ type: 'video_url', video_url: { url } });
          break;
        }
        case 'audio':
        case 'record':
        case 'voice': {
          const url = data?.url || data?.file || data?.src;
          if (url) parts.push({ type: 'image_url', image_url: { url } });
          break;
        }
        case 'face':
        case 'sticker':
        case 'emoji': {
          const id = String(data?.id ?? data?.face_id ?? '');
          const text = data?.text || data?.name || data?.describe;
          if (id) parts.push({ type: 'face', face: { id, text } });
          break;
        }
      }
    }
  }

  // 2. Fallback: parse image URLs from $raw for adapters that don't use structured $content
  if (parts.length === 0) {
    const raw = typeof message.$raw === 'string' ? message.$raw : JSON.stringify(message.$raw || '');

    const xmlMatches = raw.match(/<image[^>]+url="([^"]+)"/g);
    if (xmlMatches) {
      for (const m of xmlMatches) {
        const urlMatch = m.match(/url="([^"]+)"/);
        if (urlMatch) parts.push({ type: 'image_url', image_url: { url: urlMatch[1] } });
      }
    }

    const cqMatches = raw.match(/\[CQ:image[^\]]*url=([^\],]+)/g);
    if (cqMatches) {
      for (const m of cqMatches) {
        const urlMatch = m.match(/url=([^\],]+)/);
        if (urlMatch) parts.push({ type: 'image_url', image_url: { url: urlMatch[1] } });
      }
    }
  }

  return parts;
}

function renderOutput(elements: OutputElement[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'text':
        if (el.content) parts.push(el.content);
        break;
      case 'image':
        parts.push(`<image url="${el.url}"/>`);
        break;
      case 'audio':
        parts.push(`<audio url="${el.url}"/>`);
        break;
      case 'video':
        parts.push(`<video url="${el.url}"/>`);
        break;
      case 'card': {
        const cp = [`📋 ${el.title}`];
        if (el.description) cp.push(el.description);
        if (el.fields?.length)
          for (const f of el.fields) cp.push(`  ${f.label}: ${f.value}`);
        if (el.imageUrl) cp.push(`<image url="${el.imageUrl}"/>`);
        parts.push(cp.join('\n'));
        break;
      }
      case 'file':
        parts.push(`📎 ${el.name}: ${el.url}`);
        break;
    }
  }
  return parts.join('\n') || '';
}

export function registerAITrigger(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    const rawConfig = ai.getTriggerConfig();
    const triggerConfig = mergeAITriggerConfig(rawConfig);
    if (!triggerConfig.enabled) {
      logger.info('AI Trigger is disabled');
      return;
    }

    const handleAIMessage = async (
      message: Message<any>,
      content: string,
    ) => {
      const t0 = performance.now();
      if (!ai.isReady()) return;
      if (triggerConfig.thinkingMessage)
        await message.$reply(triggerConfig.thinkingMessage);

      const permissions = inferSenderPermissions(message, triggerConfig);
      const toolContext: ToolContext = {
        platform: message.$adapter,
        botId: message.$bot,
        sceneId: message.$channel?.id || message.$sender.id,
        senderId: message.$sender.id,
        message,
        scope: permissions.scope,
        senderPermissionLevel: permissions.permissionLevel,
        isGroupAdmin: permissions.isGroupAdmin,
        isGroupOwner: permissions.isGroupOwner,
        isBotAdmin: permissions.isBotAdmin,
        isOwner: permissions.isOwner,
      };

      const tCollect = performance.now();
      const toolService = root.inject('tool');
      let externalTools: Tool[] = [];
      if (toolService) {
        externalTools = toolService.collectAll(root);
        externalTools = toolService.filterByContext(externalTools, toolContext);
      }
      logger.debug(`[AI Handler] 工具收集: ${externalTools.length} 个, ${(performance.now() - tCollect).toFixed(0)}ms`);

      try {
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('AI 响应超时')), triggerConfig.timeout),
        );

        let responseText: string;
        if (refs.zhinAgent) {
          const mediaParts = extractMediaParts(message);
          let elements: OutputElement[];
          if (mediaParts.length > 0) {
            const parts: ContentPart[] = [];
            if (content) parts.push({ type: 'text', text: content });
            parts.push(...mediaParts);
            elements = await Promise.race([
              refs.zhinAgent.processMultimodal(parts, toolContext),
              timeout,
            ]);
          } else {
            elements = await Promise.race([
              refs.zhinAgent.process(content, toolContext, externalTools),
              timeout,
            ]);
          }
          responseText = renderOutput(elements);
        } else {
          const response = await Promise.race([
            ai.process(content, toolContext, externalTools),
            timeout,
          ]);
          responseText = typeof response === 'string' ? response : '';
        }

        if (responseText) await message.$reply(parseRichMediaContent(responseText));
        logger.info(`[AI Handler] 总耗时: ${(performance.now() - t0).toFixed(0)}ms`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[AI Handler] 失败 (${(performance.now() - t0).toFixed(0)}ms): ${msg}`);
        await message.$reply(triggerConfig.errorTemplate.replace('{error}', msg));
      }
    };

    const dispatcher = root.inject('dispatcher');

    if (dispatcher && typeof dispatcher.setAIHandler === 'function') {
      dispatcher.setAITriggerMatcher((message: Message<any>) =>
        shouldTriggerAI(message, triggerConfig),
      );
      dispatcher.setAIHandler(handleAIMessage);
      logger.debug('AI Handler registered via MessageDispatcher');
      return () => { logger.info('AI Handler unregistered'); };
    }

    const aiMw = async (
      message: Message<any>,
      next: () => Promise<void>,
    ) => {
      const { triggered, content } = shouldTriggerAI(message, triggerConfig);
      if (!triggered) return await next();
      await handleAIMessage(message, content);
      await next();
    };
    const dispose = root.addMiddleware(aiMw);
    logger.debug('AI Trigger middleware registered (fallback mode)');
    return () => { dispose(); };
  });
}
