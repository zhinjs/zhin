import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeRiddleAction,
  parseChoicePayload,
  registerGameTextMiddleware,
  resolveGameChoice,
  resolveGameTextPayload,
} from '@zhin.js/game-shared';
import { handleChoice, processAnswerText, RIDDLE_PREFIX } from './game-flow.js';
import { runRiddleCommand } from './riddle-command.js';
import type { SessionService } from './session-service.js';

const VALID_CHOICES = ['hint', 'skip', 'quit', 'restart_char', 'restart_idiom'] as const;

function registerPattern(
  plugin: Plugin,
  pattern: string,
  desc: string,
  getServices: () => SessionService | null,
): void {
  plugin.addCommand(
    new MessageCommand(pattern)
      .desc(desc)
      .action(async (message, result) => {
        const services = getServices();
        if (!services) return '猜谜需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runRiddleCommand(plugin, services, message, normalizeRiddleAction(raw));
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, '/riddle [action:word]', '猜谜（riddle）', getServices);
  registerPattern(plugin, '/猜谜 [action:word]', '猜谜（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  return resolveGameChoice({
    message,
    gamePrefix: RIDDLE_PREFIX,
    validChoiceIds: VALID_CHOICES,
    getById: (id) => services.getById(id),
    getActiveForUser: (ch, uid) => services.getActiveForUser(ch, uid),
    getByBoardMessageId: (mid) => services.getActiveByBoardMessageId(mid),
  });
}

export function registerInteractive(plugin: Plugin, getServices: () => SessionService | null): void {
  plugin.registerInteractiveHandler(`${RIDDLE_PREFIX}:`, async (message) => {
    const services = getServices();
    if (!services) return false;
    const choice = await resolveChoice(message, services);
    if (!choice) return false;
    const err = await handleChoice(plugin, services, message, choice.sessionId, choice.choiceId);
    if (typeof err === 'string') await message.$reply?.(err);
    return true;
  });
}

export function registerTextMiddleware(plugin: Plugin, getServices: () => SessionService | null): void {
  registerGameTextMiddleware(plugin, async (message, next) => {
    const services = getServices();
    if (!services) return next();

    const action = getActionFromMessage(message);
    if (action?.payload.startsWith(`${RIDDLE_PREFIX}:`)) return next();

    const ch = channelKey(message);
    const raw = message.$raw?.trim() ?? '';
    if (!raw) return next();

    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${RIDDLE_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, RIDDLE_PREFIX);
      if (parsed) {
        const session = await services.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          const err = await handleChoice(plugin, services, message, parsed.sessionId, parsed.choiceId);
          if (typeof err === 'string') await message.$reply?.(err);
          return;
        }
      }
    }

    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    if (session.status === 'active') {
      const map = buildChoiceFallbackMap(RIDDLE_PREFIX, session.id, [
        { id: 'hint', label: '提示' },
        { id: 'skip', label: '跳过' },
        { id: 'quit', label: '结束' },
      ]);
      const payload = resolveGameTextPayload(raw, map);
      const parsed = payload ? parseChoicePayload(payload, RIDDLE_PREFIX) : null;
      if (parsed?.sessionId === session.id) {
        const err = await handleChoice(plugin, services, message, session.id, parsed.choiceId);
        if (typeof err === 'string') await message.$reply?.(err);
        return;
      }
    }

    if (/^[\u4e00-\u9fff]{1,8}$/.test(raw)) {
      await processAnswerText(plugin, services, message, raw);
      return;
    }

    return next();
  }, 'word-riddle:text');
}
