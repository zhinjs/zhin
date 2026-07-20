import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from 'zhin.js';
import { getRiddleById, RIDDLE_PREFIX, typeLabel } from './engine.js';
import type { RiddleSessionRow } from './models.js';
import { currentRiddleId, parseQueue } from './session-service.js';

const MAX_WRONG = 3;

export function buildRiddleView(
  session: RiddleSessionRow,
  eventLines: string[] = [],
  channelType?: string,
): SendContent | string {
  const queue = parseQueue(session.queue);
  const terminal = session.status !== 'active';
  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;

  const lines = [
    `🧩 **${typeLabel(session.mode as 'char' | 'idiom')}**`,
    '',
    `进度 ${Math.min(session.index + 1, queue.length)}/${queue.length} · 得分 **${session.score}** · 连击 **${session.streak}**（最佳 ${session.best_streak}）`,
  ];

  if (terminal) {
    lines.push('', '🎊 **本轮题目已全部完成！**', `最终得分：**${session.score}**`);
  } else if (entry) {
    lines.push('', `❓ ${entry.question}`);
    if (session.wrong_count > 0) {
      lines.push(`⚠️ 本题失误 ${session.wrong_count}/${MAX_WRONG}`);
    }
    lines.push('', session.mode === 'char' ? '请回复一个汉字。' : '请回复四字成语。');
  }

  if (eventLines.length) lines.push('', ...eventLines);

  if (!entry && !terminal) return '题目加载失败，请重新开始。';

  const choices = terminal
    ? [
        { id: 'restart_char', label: '🔤 再来字谜', style: 'primary' as const, keepEnabledWhenTerminal: true },
        { id: 'restart_idiom', label: '📜 再来成语', style: 'primary' as const, keepEnabledWhenTerminal: true },
      ]
    : [
        { id: 'hint', label: '💡 提示', style: 'secondary' as const },
        { id: 'skip', label: '⏭️ 跳过', style: 'secondary' as const },
        { id: 'quit', label: '🏳️ 结束', style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: RIDDLE_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    buttonsPerRow: terminal ? 2 : 3,
    fallbackHint: '回复答案，或 1提示 2跳过 3结束',
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

export { MAX_WRONG };
