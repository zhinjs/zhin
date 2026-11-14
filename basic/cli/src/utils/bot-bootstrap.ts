import fs from 'fs-extra';
import path from 'path';

/**
 * The bot's instruction / memory file (#1250 bootstrap-dev-vs-bot): `BOT.md`, unless the project
 * already keeps the bot's memory in `AGENTS.md` (and has no `BOT.md`) — adding a `BOT.md` then
 * would hide that memory from the bot.
 */
export function botInstructionsFile(cwd: string): 'BOT.md' | 'AGENTS.md' {
  return !fs.existsSync(path.join(cwd, 'BOT.md')) && fs.existsSync(path.join(cwd, 'AGENTS.md')) ? 'AGENTS.md' : 'BOT.md';
}
