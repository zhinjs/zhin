import { gameActionWords, gameCommandMatch } from '@zhin.js/game-kit';

/** The riddle command's short entry (`猜谜`, `猜谜 开始`): its `defineCommand({ match })` (#1250 第 82 批). */
export const RIDDLE_SHORT_ENTRY = gameCommandMatch(['猜谜'], gameActionWords('riddle'));

/**
 * The Chinese spellings that reach the riddle command (its short entry and its alias `猜谜语`).
 * `riddle-text` takes short Chinese text as an answer, so it leaves these to the command: `猜谜` sent
 * during a round is the command's help, not a wrong answer (#1250 第 82 批).
 */
export const RIDDLE_COMMAND_TEXT = gameCommandMatch(['猜谜', '猜谜语'], gameActionWords('riddle'));
