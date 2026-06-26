import type { Message, Plugin } from 'zhin.js';
import { channelKey } from '@zhin.js/game-shared';
import { continueGame, startGame } from './game-flow.js';
import { idiomCount, modeLabel, promptLine } from './engine.js';
import type { MatchMode } from './engine.js';
import type { SessionService } from './session-service.js';

export const CHAIN_HELP = [
  '📜 成语接龙（文字接龙 · 四字成语）',
  `开源词库 ${idiomCount()} 条 · 机器人先出第一句`,
  '接龙 / chain — 帮助',
  '接龙 开始 / 同音 — 同音接龙（默认，首字同音即可）',
  '接龙 同字 — 严格同字接龙',
  '接龙 继续 — 刷新界面',
  '接龙 放弃 — 结束对局',
  '',
  '进行中：直接回复四字成语',
  '按钮：提示 · 跳过 · 认输（失误 3 次判负）',
].join('\n');

export async function runChainCommand(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  action: string,
): Promise<string | undefined> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveByChannel(ch);
    const lines = [CHAIN_HELP, ''];
    if (active) {
      const mode: MatchMode = active.match_mode === 'char' ? 'char' : 'pinyin';
      lines.push(
        `进行中：${active.player_name} · ${modeLabel(mode)} · 局分 ${active.player_score}:${active.bot_score} · 连击 ${active.streak}`,
      );
      if (active.last_idiom) lines.push(promptLine(active.last_idiom, mode));
    } else {
      lines.push('暂无对局，发送「接龙 开始」或「接龙 同字」。');
    }
    return lines.join('\n');
  }

  if (action === 'start_pinyin') return startGame(plugin, services, message, 'pinyin');
  if (action === 'start_char') return startGame(plugin, services, message, 'char');
  if (action === 'continue') return continueGame(plugin, services, message);

  if (action === 'quit') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return '你没有进行中的接龙。';
    await services.updateSession(row.id, { status: 'aborted' });
    return '已放弃成语接龙。';
  }

  return `未知子命令：${action}\n\n${CHAIN_HELP}`;
}
