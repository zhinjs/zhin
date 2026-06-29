import type { Message, Plugin } from 'zhin.js';
import { channelKey } from '@zhin.js/game-shared';
import { continueGame, startGame } from './game-flow.js';
import { riddleCount } from './riddles-catalog.js';
import type { RiddleType } from './riddles-catalog.js';
import { typeLabel } from './engine.js';
import type { SessionService } from './session-service.js';

const counts = riddleCount();

export const RIDDLE_HELP = [
  '🧩 猜谜（字谜 + 猜成语）',
  `字谜 ${counts.char.toLocaleString('zh-CN')} 题 · 成语 ${counts.idiom.toLocaleString('zh-CN')} 题`,
  '猜谜 / riddle — 帮助',
  '猜谜 开始 — 字谜模式',
  '猜谜 字谜 — 字谜模式',
  '猜谜 成语 — 猜成语模式',
  '猜谜 继续 — 刷新界面',
  '猜谜 放弃 — 结束',
  '',
  '进行中直接回复答案；连击加分，提示/失误会清零连击。',
].join('\n');

function parseMode(action: string): RiddleType | null {
  if (action === 'char' || action === '字谜') return 'char';
  if (action === 'idiom' || action === '成语') return 'idiom';
  if (action === 'start' || action === '开始') return 'char';
  return null;
}

export async function runRiddleCommand(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  action: string,
): Promise<string | undefined> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveByChannel(ch);
    const lines = [RIDDLE_HELP, ''];
    if (active) {
      lines.push(`进行中：${typeLabel(active.mode as RiddleType)} · 得分 ${active.score} · 连击 ${active.streak}`);
    } else {
      lines.push('暂无对局，发送「猜谜 开始」。');
    }
    return lines.join('\n');
  }

  const mode = parseMode(action);
  if (mode) return startGame(plugin, services, message, mode);

  if (action === 'continue' || action === '继续') {
    return continueGame(plugin, services, message);
  }

  if (action === 'quit' || action === '放弃') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的猜谜。';
    await services.updateSession(row.id, { status: 'aborted' });
    return '已放弃猜谜。';
  }

  return `未知子命令：${action}\n\n${RIDDLE_HELP}`;
}
