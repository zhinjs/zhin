import { Message, MessageCommand, getActionFromMessage, type Plugin } from 'zhin.js';
import { channelKey, normalizeTttAction, registerGameTextMiddleware } from '@zhin.js/game-shared';
import { buildFallbackMap } from './board-view.js';
import { parseBoard } from './engine.js';
import { handleMove } from './game-flow.js';
import { runTttCommand } from './ttt-command.js';
import type { SessionServices } from './session-service.js';

function actionPayload(message: Message<any>): string | undefined {
  return getActionFromMessage(message)?.payload;
}

/** @deprecated 使用 game-shared parseChoicePayload；保留 ttt 专用解析 */
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

async function resolveTttMove(
  message: Message<any>,
  services: SessionServices,
): Promise<{ sessionId: string; cell: number } | null> {
  const action = getActionFromMessage(message);
  if (!action) return null;

  const fromPayload = parseTttPayload(action.payload);
  if (fromPayload) return fromPayload;

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
  return { sessionId: session.id, cell };
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
        const action = normalizeTttAction(raw);
        return runTttCommand(plugin, services, message, action);
      }),
  );
}

export function registerCommands(
  plugin: Plugin,
  getServices: () => SessionServices | null,
): void {
  registerTttPattern(plugin, 'ttt [action:word]', '井字棋（ttt）', getServices);
  registerTttPattern(plugin, '井字棋 [action:word]', '井字棋（中文）', getServices);
}

async function handleTttAction(
  plugin: Plugin,
  getServices: () => SessionServices | null,
  message: Message<any>,
): Promise<boolean> {
  const services = getServices();
  if (!services) return false;
  const move = await resolveTttMove(message, services);
  if (!move) return false;
  const err = await handleMove(plugin, services, message, move.sessionId, move.cell);
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

    const ch = channelKey(message);
    const session = await services.session.getActiveForUser(ch, message.$sender.id);
    if (!session) return next();

    const raw = message.$raw?.trim() ?? '';
    let cell: number | null = null;
    const direct = parseTttPayload(raw.startsWith('ttt:') ? raw : '');
    if (direct && direct.sessionId === session.id) {
      cell = direct.cell;
    } else {
      const n = /^(\d)$/.exec(raw);
      if (n) {
        const map = buildFallbackMap(session.id, parseBoard(session.board));
        const payload = map[n[1]!];
        const p = payload ? parseTttPayload(payload) : null;
        if (p?.sessionId === session.id) cell = p.cell;
      }
    }
    if (cell == null) return next();

    const err = await handleMove(plugin, services, message, session.id, cell);
    if (err) await message.$reply?.(err);
  }, 'ttt:text');
}
