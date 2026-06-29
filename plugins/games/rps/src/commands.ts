import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeRpsAction,
  parseChoicePayload,
  registerGameTextMiddleware,
  resolveGameChoice,
  resolveGameTextPayload,
} from '@zhin.js/game-shared';
import { handleChoice, RPS_PREFIX } from './game-flow.js';
import { runRpsCommand } from './rps-command.js';
import type { SessionService } from './session-service.js';

const VALID_CHOICES = ['rock', 'paper', 'scissors', 'restart'] as const;

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
        if (!services) return '猜拳需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runRpsCommand(plugin, services, message, normalizeRpsAction(raw));
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, '/rps [action:word]', '猜拳（rps）', getServices);
  registerPattern(plugin, '/猜拳 [action:word]', '猜拳（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  return resolveGameChoice({
    message,
    gamePrefix: RPS_PREFIX,
    validChoiceIds: VALID_CHOICES,
    getById: (id) => services.getById(id),
    getActiveForUser: (ch, uid) => services.getActiveForUser(ch, uid),
    getByBoardMessageId: (mid) => services.getActiveByBoardMessageId(mid),
  });
}

export function registerInteractive(plugin: Plugin, getServices: () => SessionService | null): void {
  plugin.registerInteractiveHandler(`${RPS_PREFIX}:`, async (message) => {
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
    if (action?.payload.startsWith(`${RPS_PREFIX}:`)) return next();

    const raw = message.$raw?.trim() ?? '';
    const ch = channelKey(message);

    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${RPS_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, RPS_PREFIX);
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

    const map = buildChoiceFallbackMap(RPS_PREFIX, session.id, [
      { id: 'rock', label: '石头' },
      { id: 'paper', label: '布' },
      { id: 'scissors', label: '剪刀' },
    ]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, RPS_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) return next();

    const err = await handleChoice(plugin, services, message, session.id, parsed.choiceId);
    if (err) await message.$reply?.(err);
  }, 'rps:text');
}
