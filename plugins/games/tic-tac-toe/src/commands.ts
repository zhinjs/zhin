import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import {
  channelKey,
  normalizeTttAction,
  parseChoicePayload,
  registerGameTextMiddleware,
  resolveGameChoice,
  resolveGameTextPayload,
} from '@zhin.js/game-shared';
import { buildFallbackMap, TTT_PREFIX } from './board-view.js';
import { parseBoard } from './engine.js';
import { handleMove, restartFromTerminal } from './game-flow.js';
import { runTttCommand } from './ttt-command.js';
import type { SessionServices } from './session-service.js';

function actionPayload(message: Message<any>): string | undefined {
  return getActionFromMessage(message)?.payload;
}

function parseTttPayload(payload: string): { sessionId: string; cell: number } | null {
  const m = /^ttt:([^:]+):(\d)$/.exec(payload);
  if (!m) return null;
  return { sessionId: m[1]!, cell: Number(m[2]) };
}

function parseCellButtonId(id: string): number | null {
  const m = /^c(\d)$/.exec(id);
  if (!m) return null;
  const cell = Number(m[1]);
  return cell >= 0 && cell <= 8 ? cell : null;
}

async function resolveTttAction(
  message: Message<any>,
  services: SessionServices,
): Promise<{ kind: 'move'; sessionId: string; cell: number } | { kind: 'restart'; sessionId: string } | null> {
  const restart = await resolveGameChoice({
    message,
    gamePrefix: TTT_PREFIX,
    validChoiceIds: ['restart'],
    getById: (id) => services.session.getById(id),
    getActiveForUser: (ch, uid) => services.session.getActiveForUser(ch, uid),
    getByBoardMessageId: (mid) => services.session.getActiveByBoardMessageId(mid),
  });
  if (restart) return { kind: 'restart', sessionId: restart.sessionId };

  const action = getActionFromMessage(message);
  if (!action) return null;

  const fromPayload = parseTttPayload(action.payload);
  if (fromPayload) return { kind: 'move', ...fromPayload };

  const cell =
    parseCellButtonId(action.payload)
    ?? parseCellButtonId(action.id ?? '');
  if (cell == null) return null;

  const ch = channelKey(message);
  const session =
    await services.session.getActiveForUser(ch, message.$sender.id)
    ?? (action.sourceMessageId
      ? await services.session.getActiveByBoardMessageId(action.sourceMessageId)
      : null);
  if (!session || session.channel_key !== ch) return null;
  return { kind: 'move', sessionId: session.id, cell };
}

export function registerCommands(
  plugin: Plugin,
  getServices: () => SessionServices | null,
): void {
  registerTttPattern(plugin, '/ttt [action:word]', '井字棋（ttt）', getServices);
  registerTttPattern(plugin, '/井字棋 [action:word]', '井字棋（中文）', getServices);
}

function registerTttPattern(
  plugin: Plugin,
  pattern: string,
  desc: string,
  getServices: () => SessionServices | null,
): void {
  plugin.addCommand(
    new MessageCommand(pattern)
      .desc(desc)
      .action(async (message, result) => {
        const services = getServices();
        if (!services) return '井字棋需要启用 database 配置。';
        const raw = (result.params.action as string | undefined) ?? '';
        return runTttCommand(plugin, services, message, normalizeTttAction(raw));
      }),
  );
}

async function handleTttAction(
  plugin: Plugin,
  getServices: () => SessionServices | null,
  message: Message<any>,
): Promise<boolean> {
  const services = getServices();
  if (!services) return false;
  const action = await resolveTttAction(message, services);
  if (!action) return false;

  if (action.kind === 'restart') {
    const err = await restartFromTerminal(plugin, services, message, action.sessionId);
    if (err) await message.$reply?.(err);
    return true;
  }

  const err = await handleMove(plugin, services, message, action.sessionId, action.cell);
  if (err) await message.$reply?.(err);
  return true;
}

export function registerInteractive(plugin: Plugin, getServices: () => SessionServices | null): void {
  plugin.registerInteractiveHandler('ttt:', (message) => handleTttAction(plugin, getServices, message));
  plugin.registerInteractiveHandler('c', (message) => handleTttAction(plugin, getServices, message));
}

export function registerTextFallback(plugin: Plugin, getServices: () => SessionServices | null): void {
  registerGameTextMiddleware(plugin, async (message, next) => {
    const services = getServices();
    if (!services) return next();

    const inboundAction = actionPayload(message);
    if (inboundAction?.startsWith('ttt:')) return next();

    const raw = message.$raw?.trim() ?? '';
    const ch = channelKey(message);

    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${TTT_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, TTT_PREFIX);
      if (parsed?.choiceId === 'restart') {
        const session = await services.session.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          const err = await restartFromTerminal(plugin, services, message, parsed.sessionId);
          if (err) await message.$reply?.(err);
          return;
        }
      }
    }

    const session = await services.session.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    let cell: number | null = null;
    const map = buildFallbackMap(session.id, parseBoard(session.board));
    const payloadText = resolveGameTextPayload(raw, map);
    const p = payloadText ? parseTttPayload(payloadText) : null;
    if (p?.sessionId === session.id) cell = p.cell;
    if (cell == null) return next();

    const err = await handleMove(plugin, services, message, session.id, cell);
    if (err) await message.$reply?.(err);
  }, 'ttt:text');
}
