import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeRiddleAction,
  parseChoicePayload,
  registerGameTextMiddleware,
} from '@zhin.js/game-shared';
import { handleChoice, processAnswerText, RIDDLE_PREFIX } from './game-flow.js';
import { runRiddleCommand } from './riddle-command.js';
import type { SessionService } from './session-service.js';

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
  registerPattern(plugin, 'riddle [action:word]', '猜谜（riddle）', getServices);
  registerPattern(plugin, '猜谜 [action:word]', '猜谜（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  const action = getActionFromMessage(message);
  if (!action) return null;

  const parsed = parseChoicePayload(action.payload, RIDDLE_PREFIX);
  if (parsed) return { sessionId: parsed.sessionId, choiceId: parsed.choiceId };

  const choiceId = action.id || action.payload;
  if (!choiceId) return null;

  const ch = channelKey(message);
  const session =
    await services.getActiveForUser(ch, message.$sender.id)
    ?? (action.sourceMessageId
      ? await services.getActiveByBoardMessageId(action.sourceMessageId)
      : null);
  if (!session || session.channel_key !== ch) return null;

  const valid = ['hint', 'skip', 'quit', 'restart_char', 'restart_idiom'];
  if (!valid.includes(choiceId)) return null;
  return { sessionId: session.id, choiceId };
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
    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    const raw = message.$raw?.trim() ?? '';
    if (!raw) return next();

    const n = /^(\d+)$/.exec(raw);
    if (n && session.status === 'active') {
      const map = buildChoiceFallbackMap(RIDDLE_PREFIX, session.id, [
        { id: 'hint', label: '提示' },
        { id: 'skip', label: '跳过' },
        { id: 'quit', label: '结束' },
      ]);
      const payload = map[n[1]!];
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
