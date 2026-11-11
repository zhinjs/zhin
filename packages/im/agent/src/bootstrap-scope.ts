/**
 * Bootstrap section scopes (ADR 0042 §5).
 *
 * Workspace prompt files (AGENTS.md / SOUL.md / TOOLS.md) may annotate a heading's
 * section with an HTML comment on the first non-blank line under the heading:
 *
 *   ## Deploy notes
 *   <!-- scope: master-private -->
 *
 * The section (up to the next heading of the same or a higher level) is then injected
 * only into turns whose scene matches. Everything here is a pure function of
 * (text, scene), so the rendered bootstrap is byte-stable per scene kind.
 */

import type { ContextFile } from './bootstrap.js';

export type BootstrapSceneKind = 'group' | 'private' | 'channel' | 'other';

/** Scene facts a scope annotation can match on. */
export interface BootstrapScene {
  readonly kind: BootstrapSceneKind;
  readonly master: boolean;
}

export interface ScopedBootstrapText {
  readonly text: string;
  /** Titles (only) of the sections left out for this scene. */
  readonly skipped: readonly string[];
}

const KNOWN_PARTS: ReadonlySet<string> = new Set(['group', 'private', 'channel', 'master']);
/** The `## SOUL.md` wrappers that the host puts between concatenated files. */
const FILE_WRAPPER = /^##[ \t]+((?:SOUL|AGENTS|TOOLS)\.md)[ \t]*$/;

const isHeadingSpace = (character: string | undefined): boolean => character === ' ' || character === '\t';

/** Parse the existing heading grammar without redistributing long whitespace runs. */
function parseHeading(line: string): { level: number; title: string } | null {
  // A split CRLF line still carries its delimiter; it is not heading content.
  if (line.endsWith('\r')) line = line.slice(0, -1);
  let level = 0;
  while (line[level] === '#') level++;
  if (level === 0 || level > 6 || !isHeadingSpace(line[level])) return null;
  // Embedded line terminators are not part of this line's Markdown title.
  if (/[\r\u2028\u2029]/u.test(line)) return null;
  let start = level;
  while (isHeadingSpace(line[start])) start++;
  // Even an all-whitespace title matched the original grammar's mandatory title character.
  if (start === line.length) {
    if (start - level < 2) return null;
    start--;
  }
  let end = line.length;
  while (isHeadingSpace(line[end - 1])) end--;
  while (line[end - 1] === '#') end--;
  while (isHeadingSpace(line[end - 1])) end--;
  return { level, title: line.slice(start, Math.max(start + 1, end)).trim() };
}

/** A scope comment cannot contain `>` before its closing delimiter. */
function parseAnnotation(line: string): { value: string } | null {
  const comment = line.trim();
  if (!comment.startsWith('<!--') || !comment.endsWith('-->')) return null;
  const body = comment.slice(4, -3).trimStart();
  if (body.includes('>') || body.slice(0, 5).toLowerCase() !== 'scope') return null;
  const suffix = body.slice(5).trimStart();
  return suffix.startsWith(':') ? { value: suffix.slice(1).trim() } : null;
}

/** Derive the scene facts from the turn view (anything with origin + principal). */
export function bootstrapSceneFromTurn(
  turn: { origin: { kind: string; scope?: string }; principal: { roles: readonly string[] } } | undefined,
): BootstrapScene {
  const scope = turn?.origin.kind === 'im' ? turn.origin.scope : undefined;
  const kind: BootstrapSceneKind = scope === 'group' || scope === 'private' || scope === 'channel' ? scope : 'other';
  return { kind, master: turn?.principal.roles.includes('master') === true };
}

/**
 * Parse a scope list (`group, master-private`). Items are OR-ed; `a-b` means a AND b.
 * Unknown items are ignored; returns null when no valid item remains (annotation
 * ignored, section stays visible in every scene).
 */
export function parseScopeList(raw: string): string[][] | null {
  const items: string[][] = [];
  for (const item of raw.split(',')) {
    const parts = item.trim().toLowerCase().split('-').map(part => part.trim());
    if (parts.length > 0 && parts.every(part => KNOWN_PARTS.has(part))) items.push(parts);
  }
  return items.length > 0 ? items : null;
}

export function sceneMatches(scope: readonly (readonly string[])[], scene: BootstrapScene): boolean {
  return scope.some(parts => parts.every(part => (part === 'master' ? scene.master : part === scene.kind)));
}

/** Keep only the sections whose scope annotation matches `scene`. Unannotated text is untouched. */
export function scopeBootstrapText(text: string, scene: BootstrapScene, options?: {
  /** Omit an already-loaded file at its existing wrapper boundary, including nested headings. */
  excludeFiles?: readonly string[];
  /** Captured Host sources. File identity comes from metadata, never from document headings. */
  contextFiles?: readonly ContextFile[];
}): ScopedBootstrapText {
  const excluded = new Set(options?.excludeFiles ?? []);
  if (options?.contextFiles !== undefined) {
    const parts: string[] = [];
    const skipped: string[] = [];
    for (const file of options.contextFiles) {
      if (excluded.has(file.path)) { skipped.push(file.path); continue; }
      const scoped = scopeBootstrapDocument(file.content, scene);
      parts.push(`## ${file.path}\n${scoped.text}`);
      skipped.push(...scoped.skipped);
    }
    return { text: parts.join('\n\n'), skipped };
  }
  return scopeSections(text, scene, { excluded, fileWrappers: true });
}

/** A known file's Markdown headings cannot act as boundaries between Host-loaded files. */
export function scopeBootstrapDocument(text: string, scene: BootstrapScene): ScopedBootstrapText {
  return scopeSections(text, scene, { excluded: new Set(), fileWrappers: false });
}

function scopeSections(text: string, scene: BootstrapScene, options: {
  excluded: ReadonlySet<string>;
  fileWrappers: boolean;
}): ScopedBootstrapText {
  const { excluded } = options;
  if (!text || (!/<!--\s*scope\s*:/i.test(text) && excluded.size === 0)) return { text, skipped: [] };

  const lines = text.split('\n');
  const out: string[] = [];
  const skipped: string[] = [];
  let fence: string | null = null;
  /** Level of the heading whose section is being skipped; null when not skipping. */
  let skipLevel: number | null = null;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMark = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fenceMark) {
      if (fence === null) fence = fenceMark;
      else if (fence === fenceMark) fence = null;
    }
    const heading = fence === null && !fenceMark ? parseHeading(line) : null;
    if (!heading) {
      if (skipLevel === null) out.push(line);
      continue;
    }

    const file = options.fileWrappers ? FILE_WRAPPER.exec(line) : null;
    const level = file ? 0 : heading.level;
    if (skipLevel !== null) {
      if (level > skipLevel) continue; // still inside the skipped section
      skipLevel = null;
    }

    if (file && excluded.has(file[1]!)) {
      skipLevel = 0;
      skipped.push(file[1]!);
      changed = true;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    const scope = level > 0 && j < lines.length ? parseAnnotation(lines[j]!) : null;
    const parsed = scope ? parseScopeList(scope.value) : null;
    if (parsed && !sceneMatches(parsed, scene)) {
      skipLevel = level;
      skipped.push(heading.title);
      changed = true;
      i = j; // drop heading and annotation
      continue;
    }
    out.push(line);
    if (scope) {
      i = j; // drop the annotation line (and the blanks before it)
      changed = true;
    }
  }

  if (!changed) return { text, skipped: [] };
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + (text.endsWith('\n') ? '\n' : ''), skipped };
}
