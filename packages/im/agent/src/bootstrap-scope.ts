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
const ANNOTATION = /^\s*<!--\s*scope\s*:\s*([^>]*?)\s*-->\s*$/i;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
/** The `## SOUL.md` wrappers that the host puts between concatenated files. */
const FILE_WRAPPER = /^##[ \t]+(?:SOUL|AGENTS|TOOLS)\.md[ \t]*$/;

/** Derive the scene facts from the turn view (anything with origin + principal). */
export function bootstrapSceneFromTurn(
  turn: { origin: { kind: string; scope?: string }; principal: { roles: readonly string[] } } | undefined,
): BootstrapScene {
  const scope = turn?.origin.kind === 'im' ? turn.origin.scope : undefined;
  const kind: BootstrapSceneKind = scope === 'group' || scope === 'private' || scope === 'channel' ? scope : 'other';
  return { kind, master: turn?.principal.roles.includes('master') === true };
}

export function bootstrapSceneKey(scene: BootstrapScene): string {
  return `${scene.kind}${scene.master ? ':master' : ''}`;
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
export function scopeBootstrapText(text: string, scene: BootstrapScene): ScopedBootstrapText {
  if (!text || !/<!--\s*scope\s*:/i.test(text)) return { text, skipped: [] };

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
    const heading = fence === null && !fenceMark ? HEADING.exec(line) : null;
    if (!heading) {
      if (skipLevel === null) out.push(line);
      continue;
    }

    const level = FILE_WRAPPER.test(line) ? 0 : heading[1]!.length;
    if (skipLevel !== null) {
      if (level > skipLevel) continue; // still inside the skipped section
      skipLevel = null;
    }

    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    const scope = level > 0 && j < lines.length ? ANNOTATION.exec(lines[j]!) : null;
    const parsed = scope ? parseScopeList(scope[1]!) : null;
    if (parsed && !sceneMatches(parsed, scene)) {
      skipLevel = level;
      skipped.push(heading[2]!.trim());
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
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + (text.endsWith('\n') ? '\n' : ''), skipped };
}
