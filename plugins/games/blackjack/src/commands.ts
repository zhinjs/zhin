import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  parseChoicePayload,
  registerGameTextMiddleware,
  resolveGameChoice,
  resolveGameTextPayload,
} from '@zhin.js/game-shared';
import { BJ_PREFIX, handleChoice } from './game-flow.js';
import { runBjCommand } from './bj-command.js';
import type { SessionService } from './session-service.js';

const VALID_CHOICES = ['hit', 'stand', 'restart'] as const;

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
        if (!services) return '21 点需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runBjCommand(plugin, services, message, raw);
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, '/21点 [action:word]', '21 点（中文）', getServices);
  registerPattern(plugin, '/bj [action:word]', 'Blackjack (English)', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  return resolveGameChoice({
    message,
    gamePrefix: BJ_PREFIX,
    validChoiceIds: VALID_CHOICES,
    getById: (id) => services.getById(id),
    getActiveForUser: (ch, uid) => services.getActiveForUser(ch, uid),
    getByBoardMessageId: (mid) => services.getActiveByBoardMessageId(mid),
  });
}

export function registerInteractive(plugin: Plugin, getServices: () => SessionService | null): void {
  plugin.registerInteractiveHandler(`${BJ_PREFIX}:`, async (message) => {
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
    if (action?.payload.startsWith(`${BJ_PREFIX}:`)) return next();

    const raw = message.$raw?.trim() ?? '';
    const ch = channelKey(message);

    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${BJ_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, BJ_PREFIX);
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
    if (!session) return next();

    if (session.status !== 'active') {
      const map = buildChoiceFallbackMap(BJ_PREFIX, session.id, [
        { id: 'restart', label: '再来一局', keepEnabledWhenTerminal: true },
      ]);
      const payload = resolveGameTextPayload(raw, map);
      const parsed = payload ? parseChoicePayload(payload, BJ_PREFIX) : null;
      if (parsed?.choiceId === 'restart') {
        const err = await handleChoice(plugin, services, message, parsed.sessionId, 'restart');
        if (err) await message.$reply?.(err);
        return;
      }
      return next();
    }

    const map = buildChoiceFallbackMap(BJ_PREFIX, session.id, [
      { id: 'hit', label: '要牌' },
      { id: 'stand', label: '停牌' },
    ]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, BJ_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) return next();

    const err = await handleChoice(plugin, services, message, session.id, parsed.choiceId);
    if (err) await message.$reply?.(err);
  }, 'bj:text');
}
