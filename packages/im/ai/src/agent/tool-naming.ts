import type { AgentTool } from '../types.js';

export interface ToolNamePolicyWarning {
  name: string;
  source: string;
  action: 'ignored' | 'overridden';
  previousSource?: string;
  reason: string;
}

export interface ToolNamePolicyOptions {
  reservedNames?: Iterable<string>;
  reservedPrefixes?: Iterable<string>;
}

export function isBuiltinToolSource(source?: string): boolean {
  if (!source) return false;
  return source === 'builtin' || source.startsWith('builtin:') || source.startsWith('system:');
}

export function isReservedToolName(name: string, options: ToolNamePolicyOptions = {}): boolean {
  const lowered = name.toLowerCase();
  const reserved = new Set(Array.from(options.reservedNames || []).map(n => n.toLowerCase()));
  if (reserved.has(lowered)) return true;
  for (const prefix of options.reservedPrefixes || []) {
    if (lowered.startsWith(prefix.toLowerCase())) return true;
  }
  return false;
}

export interface MergeToolsByNameResult {
  tools: AgentTool[];
  warnings: ToolNamePolicyWarning[];
}

export function mergeToolsByName(tools: AgentTool[], options: ToolNamePolicyOptions = {}): MergeToolsByNameResult {
  const merged = new Map<string, AgentTool>();
  const warnings: ToolNamePolicyWarning[] = [];

  for (const tool of tools) {
    const source = tool.source || 'unknown';
    const name = tool.name;
    const reserved = isReservedToolName(name, options);
    const incomingIsBuiltin = isBuiltinToolSource(source);
    if (reserved && !incomingIsBuiltin) {
      warnings.push({
        name,
        source,
        action: 'ignored',
        reason: 'reserved_name',
      });
      continue;
    }
    const current = merged.get(name);

    if (!current) {
      merged.set(name, tool);
      continue;
    }

    const currentSource = current.source || 'unknown';
    const currentProtected = isReservedToolName(name, options) || isBuiltinToolSource(currentSource);
    const incomingProtected = reserved || incomingIsBuiltin;

    if (currentProtected && !incomingProtected) {
      warnings.push({
        name,
        source,
        previousSource: currentSource,
        action: 'ignored',
        reason: 'protected_tool_kept',
      });
      continue;
    }

    if (!currentProtected && incomingProtected) {
      warnings.push({
        name,
        source,
        previousSource: currentSource,
        action: 'overridden',
        reason: 'protected_tool_takes_precedence',
      });
      merged.set(name, tool);
      continue;
    }

    warnings.push({
      name,
      source,
      previousSource: currentSource,
      action: 'overridden',
      reason: 'duplicate_name_last_wins',
    });
    merged.set(name, tool);
  }

  return { tools: Array.from(merged.values()), warnings };
}
