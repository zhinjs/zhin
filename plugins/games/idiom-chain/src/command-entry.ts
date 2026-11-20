import { gameActionWords, gameCommandMatch } from '@zhin.js/game-kit';

/** The chain command's short entry (`接龙`, `接龙 继续`): its `defineCommand({ match })` (#1250 第 82 批). */
export const CHAIN_SHORT_ENTRY = gameCommandMatch(['接龙'], gameActionWords('chain'));

/**
 * The Chinese spellings that reach the chain command (its short entry and its alias `成语接龙`).
 * `chain-text` takes 2–8 Chinese characters as an idiom, so it leaves these to the command: `接龙` or
 * `成语接龙` sent during a round is the command's help, not an idiom (#1250 第 82 批).
 */
export const CHAIN_COMMAND_TEXT = gameCommandMatch(['接龙', '成语接龙'], gameActionWords('chain'));
