import fs from 'fs-extra';
import path from 'path';

/**
 * The bot's instruction / memory file (#1250 bootstrap-dev-vs-bot): `BOT.md`, unless the project
 * already keeps the bot's memory in `AGENTS.md` (and has no non-empty root `BOT.md`) — adding a
 * `BOT.md` then would hide that memory from the bot.
 *
 * Mirrors the runtime rule (`hasBotBootstrapFile` in `@zhin.js/agent`): only a non-empty `BOT.md`
 * in the project root counts; `data/BOT.md` is never read.
 */
export function botInstructionsFile(cwd: string): 'BOT.md' | 'AGENTS.md' {
  return !hasRootBotFile(cwd) && fs.existsSync(path.join(cwd, 'AGENTS.md')) ? 'AGENTS.md' : 'BOT.md';
}

function hasRootBotFile(cwd: string): boolean {
  try {
    return fs.readFileSync(path.join(cwd, 'BOT.md'), 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}
