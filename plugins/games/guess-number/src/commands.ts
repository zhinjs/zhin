import { Message, MessageCommand, type Plugin } from 'zhin.js';
import { channelKey, normalizeGuessAction, registerGameTextMiddleware } from '@zhin.js/game-shared';
import { processGuess } from './game-flow.js';
import { runGuessCommand } from './guess-command.js';
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
        if (!services) return '猜数字需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runGuessCommand(services, message, normalizeGuessAction(raw));
      }),
  );
}

export function registerCommands(plugin: Plugin, getServices: () => SessionService | null): void {
  registerPattern(plugin, 'guess [action:word]', '猜数字（guess）', getServices);
  registerPattern(plugin, '猜数 [action:word]', '猜数字（中文）', getServices);
}

export function registerGuessMiddleware(plugin: Plugin, getServices: () => SessionService | null): void {
  registerGameTextMiddleware(plugin, async (message, next) => {
    const services = getServices();
    if (!services) return next();

    const raw = message.$raw?.trim() ?? '';
    const m = /^(\d+)$/.exec(raw);
    if (!m) return next();

    const ch = channelKey(message);
    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    const reply = await processGuess(services, message, Number(m[1]));
    if (reply) await message.$reply?.(reply);
  }, 'guess-number:text');
}
