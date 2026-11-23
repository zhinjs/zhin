import { isCancelWord } from '@zhin.js/core';
import { managementCommandText } from '../init/command-presentation.js';

/**
 * Whether a message is a request to stop the running turn: the whole message is one cancel word
 * (`取消` / `退出` / `算了` / `cancel` / `quit` / `exit`, any language, full-width, any case,
 * trailing punctuation ignored — #1250 第 74 批 shared vocabulary in `@zhin.js/core`).
 *
 * With `commandPrefix` (the dispatcher's real prefix for this message) a prefixed cancel word
 * such as `/cancel` or `#取消` counts too; without one only the bare word does.
 */
export function isCancelIntent(text: string, commandPrefix?: string): boolean {
  if (isCancelWord(text)) return true;
  if (!commandPrefix) return false;
  const command = managementCommandText(text, commandPrefix);
  return command !== undefined && isCancelWord(command);
}
