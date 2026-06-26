import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  buildChoiceFallbackMap,
  channelKey,
  normalizeChainAction,
  parseChoicePayload,
  registerGameTextMiddleware,
} from '@zhin.js/game-shared';
import { CHAIN_PREFIX, handleChoice, processIdiomText } from './game-flow.js';
import { runChainCommand } from './chain-command.js';
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
        if (!services) return '成语接龙需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runChainCommand(plugin, services, message, normalizeChainAction(raw));
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, 'chain [action:word]', '成语接龙（chain）', getServices);
  registerPattern(plugin, '接龙 [action:word]', '成语接龙（中文）', getServices);
}

async function resolveChoice(
  message: Message<any>,
  services: SessionService,
): Promise<{ sessionId: string; choiceId: string } | null> {
  const action = getActionFromMessage(message);
  if (!action) return null;

  const parsed = parseChoicePayload(action.payload, CHAIN_PREFIX);
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

  const valid = ['hint', 'skip', 'quit', 'restart'];
  if (!valid.includes(choiceId)) return null;
  return { sessionId: session.id, choiceId };
}

export function registerInteractive(plugin: Plugin, getServices: () => SessionService | null): void {
  plugin.registerInteractiveHandler(`${CHAIN_PREFIX}:`, async (message) => {
    const services = getServices();
    if (!services) return false;
    const choice = await resolveChoice(message, services);
    if (!choice) return false;
    const err = await handleChoice(plugin, services, message, choice.sessionId, choice.choiceId);
    if (err) await message.$reply?.(err);
    return true;
  });
}

export function registerTextMiddleware(plugin: Plugin, getServices: () => SessionService | null): void {
  registerGameTextMiddleware(plugin, async (message, next) => {
    const services = getServices();
    if (!services) return next();

    const action = getActionFromMessage(message);
    if (action?.payload.startsWith(`${CHAIN_PREFIX}:`)) return next();

    const ch = channelKey(message);
    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    const raw = message.$raw?.trim() ?? '';
    if (!raw) return next();

    const n = /^(\d+)$/.exec(raw);
    if (n && session.status === 'active') {
      const map = buildChoiceFallbackMap(CHAIN_PREFIX, session.id, [
        { id: 'hint', label: '提示' },
        { id: 'skip', label: '跳过' },
        { id: 'quit', label: '认输' },
      ]);
      const payload = map[n[1]!];
      const parsed = payload ? parseChoicePayload(payload, CHAIN_PREFIX) : null;
      if (parsed?.sessionId === session.id) {
        const err = await handleChoice(plugin, services, message, session.id, parsed.choiceId);
        if (err) await message.$reply?.(err);
        return;
      }
    }

    if (/^[\u4e00-\u9fff]{2,8}$/.test(raw)) {
      await processIdiomText(plugin, services, message, raw);
      return;
    }

    return next();
  }, 'idiom-chain:text');
}
