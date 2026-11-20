import { getLogger } from 'zhin.js';

/**
 * zhinjs/zhin#1250: welcome text is an outbound template (`${sender.name}`, `${menu}`,
 * `${command.checkin}`, …) filled by the outbound renderer; the new member is passed as data in
 * `sender`, so a nickname containing `${menu}` is sent literally. This module only warns about
 * menu words written without the account's command prefix.
 */

/** Words that read as the command menu; written bare they miss an account that needs a prefix. */
const BARE_MENU_WORD = /帮助|菜单|(?<![\p{L}\p{N}_])(?:help|menu)(?![\p{L}\p{N}_])/giu;
const ENVIRONMENT_PLACEHOLDER = /\$\{\s*(menu|prefix|command)\b/u;
const MAX_HINTED = 512;
const hinted = new Set<string>();
const logger = getLogger('group-suite');

/** Whether `text` names the menu by a bare word while the account requires `prefix` before it. */
export function welcomeNeedsPrefixHint(text: string, prefix: string | undefined): boolean {
  if (!text || !prefix || ENVIRONMENT_PLACEHOLDER.test(text)) return false;
  // `/help` with prefix `/` is already written for this account.
  for (const match of text.matchAll(BARE_MENU_WORD)) {
    if (!text.slice(0, match.index).endsWith(prefix)) return true;
  }
  return false;
}

/**
 * Logged once per account and text, the first time a message of that account shows its real
 * command prefix (the dispatch's own value): `zhin doctor` does not see per-account plugin config.
 */
export function hintWelcomePrefix(endpoint: string, text: string, prefix: string | undefined): void {
  if (!welcomeNeedsPrefixHint(text, prefix)) return;
  const key = `${endpoint}\0${text}`;
  if (hinted.has(key)) return;
  if (hinted.size >= MAX_HINTED) hinted.clear();
  hinted.add(key);
  logger.warn(`group-suite welcomeMessage for account ${endpoint} names the menu without its command prefix `
    + `"${prefix}"; write \${menu} (or \${prefix}) instead. zhin doctor does not check per-account plugin config.`);
}

/** @internal Tests only. */
export function resetWelcomePrefixHints(): void {
  hinted.clear();
}
