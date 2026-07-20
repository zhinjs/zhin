import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import {
  channelKey,
  messageFromCommandInput,
  parseChoicePayload,
  resolveGameTextPayload,
} from '@zhin.js/game-kit';
import { resolveGameServices } from '../src/runtime-store.js';
import { buildFallbackMap, TTT_PREFIX, parseTttPayload } from '../src/board-view.js';
import { parseBoard } from '../src/engine.js';
import { handleMove, restartFromTerminal } from '../src/game-flow.js';

/**
 * 文本入口：按钮 payload（`ttt:session:0-8` 或 `ttt:session:restart`）
 * 与裸数字 fallback（按空格 1-9 编号落子，对应视图『落子：回复数字 1-9（仅空格）』）。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(context.input);
    const ch = channelKey(message);

    // 直接 payload（QQ 指令预填 / Sandbox action→text）
    const payload = resolveGameTextPayload(raw);
    if (payload?.startsWith(`${TTT_PREFIX}:`)) {
      const restart = parseChoicePayload(payload, TTT_PREFIX);
      if (restart?.choiceId === 'restart') {
        const session = await services.session.getById(restart.sessionId);
        if (session?.channel_key === ch) {
          const reply = await restartFromTerminal(null, services, message, restart.sessionId);
          if (reply) await context.input.$reply(reply);
          return;
        }
      }
      const move = parseTttPayload(payload);
      if (move) {
        const session = await services.session.getById(move.sessionId);
        if (session?.channel_key === ch) {
          const reply = await handleMove(null, services, message, move.sessionId, move.cell);
          if (reply) await context.input.$reply(reply);
          return;
        }
      }
      await next();
      return;
    }

    // 裸数字：按当前棋盘空格编号映射落子
    const session = await services.session.getActiveForUser(ch, message.$sender.id);
    if (!session || session.channel_key !== ch) {
      await next();
      return;
    }
    const map = buildFallbackMap(session.id, parseBoard(session.board));
    const payloadFromDigit = resolveGameTextPayload(raw, map);
    const move = payloadFromDigit ? parseTttPayload(payloadFromDigit) : null;
    if (!move || move.sessionId !== session.id) {
      await next();
      return;
    }
    const reply = await handleMove(null, services, message, session.id, move.cell);
    if (reply) await context.input.$reply(reply);
  },
});
