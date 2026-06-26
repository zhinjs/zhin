import { buildChoiceKeyboard } from '@zhin.js/game-shared';
import type { SendContent } from 'zhin.js';
import type { ChainSessionRow } from './models.js';
import { CHAIN_PREFIX, getGloss, idiomCount, modeLabel, promptLine } from './engine.js';

const MAX_WRONG = 3;

function sessionMode(session: ChainSessionRow): 'char' | 'pinyin' {
  return session.match_mode === 'char' ? 'char' : 'pinyin';
}

export function buildChainView(
  session: ChainSessionRow,
  eventLines: string[] = [],
): SendContent {
  const terminal = session.status !== 'active';
  const mode = sessionMode(session);
  const lines = [
    `📜 **成语接龙** · ${modeLabel(mode)}`,
    '',
    `词库 **${idiomCount()}** 条 · 局分 ${session.player_score}:${session.bot_score} · 连击 **${session.streak}**（最佳 ${session.best_streak}）`,
  ];

  if (session.last_idiom) {
    const gloss = getGloss(session.last_idiom);
    lines.push('', `上一句：**${session.last_idiom}**${gloss ? `（${gloss}）` : ''}`);
    lines.push(promptLine(session.last_idiom, mode));
  }

  if (session.wrong_count > 0 && session.status === 'active') {
    lines.push(`⚠️ 失误 ${session.wrong_count}/${MAX_WRONG}`);
  }

  if (eventLines.length) {
    lines.push('', ...eventLines);
  }

  if (terminal) {
    lines.push('');
    if (session.status === 'won') lines.push('🏆 **你赢了本局！** 机器人接不上啦。');
    else if (session.status === 'lost') lines.push('💀 **机器人获胜。** 发送「接龙 开始」再来。');
  } else {
    lines.push('', '直接回复四字成语，或点下方按钮：');
  }

  const choices = terminal
    ? [{ id: 'restart', label: '🔄 再来一局', style: 'primary' as const }]
    : [
        { id: 'hint', label: '💡 提示', style: 'secondary' as const },
        { id: 'skip', label: '⏭️ 跳过', style: 'secondary' as const },
        { id: 'quit', label: '🏳️ 认输', style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: CHAIN_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    buttonsPerRow: 3,
    fallbackHint: '回复成语，或 1提示 2跳过 3认输',
  });
}

export { MAX_WRONG };
