/** Console navigation sections (ADR 0052); a Page declares which one its entry belongs to. */
export const CONSOLE_PAGE_SECTIONS = Object.freeze([
  'overview', 'conversations', 'features', 'plugins', 'ops', 'access',
] as const);

export type ConsolePageSection = (typeof CONSOLE_PAGE_SECTIONS)[number];

export function isConsolePageSection(value: unknown): value is ConsolePageSection {
  return typeof value === 'string' && (CONSOLE_PAGE_SECTIONS as readonly string[]).includes(value);
}
