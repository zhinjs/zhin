/**
 * Eve-style disableTool() sentinel for defineAgent disallowedTools (ADR 0039 P2).
 */
export const DISABLE_TOOL_MARKER = Symbol.for('zhin.authoring.disableTool');

export interface DisabledToolRef {
  readonly [DISABLE_TOOL_MARKER]: true;
  readonly name: string;
}

export function disableTool(toolName: string): DisabledToolRef {
  const name = toolName.trim();
  if (!name) {
    throw new Error('disableTool requires a non-empty tool name');
  }
  return { [DISABLE_TOOL_MARKER]: true, name };
}

export function isDisabledToolRef(value: unknown): value is DisabledToolRef {
  return (
    typeof value === 'object'
    && value != null
    && (value as DisabledToolRef)[DISABLE_TOOL_MARKER] === true
    && typeof (value as DisabledToolRef).name === 'string'
  );
}

/** Normalize defineAgent disallowedTools entries (string or disableTool sentinel). */
export function normalizeToolDenylist(
  entries?: readonly (string | DisabledToolRef)[],
): string[] | undefined {
  if (!entries?.length) return undefined;
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) names.push(trimmed);
      continue;
    }
    if (isDisabledToolRef(entry)) {
      names.push(entry.name);
    }
  }
  return names.length ? names : undefined;
}
