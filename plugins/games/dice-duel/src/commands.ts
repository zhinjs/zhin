import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeDiceAction,
  parseChoicePayload,
  registerGameTextMiddleware,
  resolveGameChoice,
  resolveGameTextPayload,
} from '@zhin.js/game-shared';
import { DICE_PREFIX, handleChoice } from './game-flow.js';
import { runDiceCommand } from './dice-command.js';
import type { SessionService } from './session-service.js';

const VALID_CHOICES = ['roll', 'restart'] as const;

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
  registerPattern(plugin, '/dice [action:word]', '骰子对决（dice）', getServices);
  registerPattern(plugin, '/骰子 [action:word]', '骰子对决（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  return resolveGameChoice({
    message,
    gamePrefix: DICE_PREFIX,
    validChoiceIds: VALID_CHOICES,
    getById: (id) => services.getById(id),
    getActiveForUser: (ch, uid) => services.getActiveForUser(ch, uid),
    getByBoardMessageId: (mid) => services.getActiveByBoardMessageId(mid),
  });
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

    const raw = message.$raw?.trim() ?? '';
    const ch = channelKey(message);

    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${DICE_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, DICE_PREFIX);
      if (parsed) {
        const session = await services.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          const err = await handleChoice(plugin, services, message, parsed.sessionId, parsed.choiceId);
          if (err) await message.$reply?.(err);
          return;
        }
      }
    }

    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session || session.status !== 'active') return next();

    const map = buildChoiceFallbackMap(DICE_PREFIX, session.id, [
      { id: 'roll', label: '掷骰' },
    ]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, DICE_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) return next();

    const err = await handleChoice(plugin, services, message, session.id, 'roll');
    if (err) await message.$reply?.(err);
  }, 'dice:text');
}
