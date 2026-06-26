import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeDiceAction,
  parseChoicePayload,
  registerGameTextMiddleware,
} from '@zhin.js/game-shared';
import { DICE_PREFIX, handleChoice } from './game-flow.js';
import { runDiceCommand } from './dice-command.js';
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
        if (!services) return '骰子对决需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runDiceCommand(plugin, services, message, normalizeDiceAction(raw));
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, 'dice [action:word]', '骰子对决（dice）', getServices);
  registerPattern(plugin, '骰子 [action:word]', '骰子对决（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  const action = getActionFromMessage(message);
  if (!action) return null;

  const parsed = parseChoicePayload(action.payload, DICE_PREFIX);
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

  if (!['roll', 'restart'].includes(choiceId)) return null;
  return { sessionId: session.id, choiceId };
}

export function registerInteractive(plugin: Plugin, getServices: () => SessionService | null): void {
  plugin.registerInteractiveHandler(`${DICE_PREFIX}:`, async (message) => {
    const services = getServices();
    if (!services) return false;
    const choice = await resolveChoice(message, services);
    if (!choice) return false;
    const err = await handleChoice(plugin, services, message, choice.sessionId, choice.choiceId);
    if (err) await message.$reply?.(err);
    return true;
  });
}

export function registerTextFallback(plugin: Plugin, getServices: () => SessionService | null): void {
  registerGameTextMiddleware(plugin, async (message, next) => {
    const services = getServices();
    if (!services) return next();

    const action = getActionFromMessage(message);
    if (action?.payload.startsWith(`${DICE_PREFIX}:`)) return next();

    const ch = channelKey(message);
    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session || session.status !== 'active') return next();

    const raw = message.$raw?.trim() ?? '';
    if (raw !== '1') return next();

    const map = buildChoiceFallbackMap(DICE_PREFIX, session.id, [
      { id: 'roll', label: '掷骰' },
    ]);
    const payload = map['1'];
    const parsed = payload ? parseChoicePayload(payload, DICE_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) return next();

    const err = await handleChoice(plugin, services, message, session.id, 'roll');
    if (err) await message.$reply?.(err);
  }, 'dice:text');
}
