import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeRpsAction,
  parseChoicePayload,
  registerGameTextMiddleware,
} from '@zhin.js/game-shared';
import { handleChoice, RPS_PREFIX } from './game-flow.js';
import { runRpsCommand } from './rps-command.js';
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
        if (!services) return '猜拳需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runRpsCommand(plugin, services, message, normalizeRpsAction(raw));
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, 'rps [action:word]', '猜拳（rps）', getServices);
  registerPattern(plugin, '猜拳 [action:word]', '猜拳（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  const action = getActionFromMessage(message);
  if (!action) return null;

  const parsed = parseChoicePayload(action.payload, RPS_PREFIX);
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

  const valid = ['rock', 'paper', 'scissors', 'restart'];
  if (!valid.includes(choiceId)) return null;
  return { sessionId: session.id, choiceId };
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

    const ch = channelKey(message);
    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session || session.status !== 'active') return next();

    const raw = message.$raw?.trim() ?? '';
    const n = /^(\d+)$/.exec(raw);
    if (!n) return next();

    const map = buildChoiceFallbackMap(RPS_PREFIX, session.id, [
      { id: 'rock', label: '石头' },
      { id: 'paper', label: '布' },
      { id: 'scissors', label: '剪刀' },
    ]);
    const payload = map[n[1]!];
    const parsed = payload ? parseChoicePayload(payload, RPS_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) return next();

    const err = await handleChoice(plugin, services, message, session.id, parsed.choiceId);
    if (err) await message.$reply?.(err);
  }, 'rps:text');
}
