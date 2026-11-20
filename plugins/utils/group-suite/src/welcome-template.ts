import { getLogger } from 'zhin.js';

/**
 * zhinjs/zhin#1250: welcome text is an outbound template (`${sender.name}`, `${bot.menu}`,
 * `${command.checkin}`, …) filled by the outbound renderer; the new member is passed as data in
 * `sender`, so a nickname containing `${bot.menu}` is sent literally. This module only warns about
 * menu words written without the account's command prefix.
 */

/** Words that read as the command menu; written bare they miss an account that needs a prefix. */
const BARE_MENU_WORD = /帮助|菜单|(?<![\p{L}\p{N}_])(?:help|menu)(?![\p{L}\p{N}_])/giu;
const ENVIRONMENT_PLACEHOLDER = /\$\{\s*(bot\.menu|bot\.prefix|command\.)/u;
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
    + `"${prefix}"; write \${bot.menu} (or \${bot.prefix}) instead. zhin doctor does not check per-account plugin config.`);
}

/**
 * Placeholders of the old welcome / teach formats (`{name}`, `{sender.id}`, `{time}`, a single-name
 * `${menu}`, …). They are not expanded any more and nothing migrates them: the operator is told
 * once per account and text which new path to write instead.
 */
const LEGACY_BRACE = /(?<!\$)\{\s*(name|nickname|id|user|sender|sender\.id|sender\.name|time|date|menu|prefix|group)\s*\}/gu;
const LEGACY_SINGLE = /\$\{\s*(name|nickname|id|user|sender|time|date|menu|prefix|group|adapter|endpoint|kind|conversationId|content|timestamp)\s*\}/gu;
const LEGACY_REPLACEMENT: Readonly<Record<string, string>> = Object.freeze({
  name: '${sender.name}', nickname: '${sender.name}', user: '${sender.name}', sender: '${sender.name}', 'sender.name': '${sender.name}',
  id: '${sender.id}', 'sender.id': '${sender.id}',
  time: '${now.time}', date: '${now.date}',
  menu: '${bot.menu}', prefix: '${bot.prefix}',
  group: '${conversation.id}', conversationId: '${conversation.id}', kind: '${conversation.kind}',
  adapter: '${bot.adapter}', endpoint: '${bot.endpoint}', content: '${message.content}', timestamp: '${message.timestamp}',
});

/** The old placeholders in `text`, each with the path to write instead (first occurrence order). */
export function legacyPlaceholders(text: string): readonly (readonly [written: string, replacement: string])[] {
  if (!text) return [];
  const found = new Map<string, string>();
  for (const pattern of [LEGACY_BRACE, LEGACY_SINGLE]) {
    for (const match of text.matchAll(pattern)) {
      const replacement = LEGACY_REPLACEMENT[match[1]!];
      if (replacement && !found.has(match[0])) found.set(match[0], replacement);
    }
  }
  return [...found];
}

/**
 * Warns (once per account and text) that `text` still uses old placeholders. `where` names the
 * setting: the welcome message, or a taught answer. Only the placeholders are logged, not the text.
 */
export function hintLegacyPlaceholders(where: 'welcomeMessage' | 'teach', endpoint: string, text: string): void {
  const legacy = legacyPlaceholders(text);
  if (legacy.length === 0) return;
  const key = `legacy\0${where}\0${endpoint}\0${text}`;
  if (hinted.has(key)) return;
  if (hinted.size >= MAX_HINTED) hinted.clear();
  hinted.add(key);
  const pairs = legacy.map(([written, replacement]) => `${written} → ${replacement}`).join(', ');
  const subject = where === 'welcomeMessage' ? 'group-suite welcomeMessage' : 'a group-suite teach answer';
  const timeNote = where === 'welcomeMessage' && legacy.some(([, replacement]) => replacement.startsWith('${now.'))
    ? ' (${now.time} / ${now.date} are filled in teach answers only; a welcome message has no time placeholder)' : '';
  logger.warn(`${subject} for account ${endpoint} uses old placeholders that are sent as written: ${pairs}${timeNote}. `
    + 'Rewrite the text with the new paths (see the message template reference); it is not migrated automatically.');
}

/** @internal Tests only. */
export function resetWelcomePrefixHints(): void {
  hinted.clear();
}
