/**
 * AGENTS.md 合并链：子目录（近）→ workspace root（远），注入 Turn envelope。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadBootstrapFiles } from '../bootstrap.js';

async function readAgentsFile(filePath: string): Promise<string | null> {
  try {
    const content = (await fs.promises.readFile(filePath, 'utf-8')).trim();
    return content || null;
  } catch {
    return null;
  }
}

function displayAgentsPath(absPath: string, workspaceRoot: string): string {
  const root = normalizeAgentsPath(workspaceRoot);
  const abs = normalizeAgentsPath(absPath);
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') ? rel : path.basename(abs);
}

function normalizeAgentsPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export interface AgentsInstructionEntry {
  path: string;
  content: string;
}

export async function collectAgentsInstructionChain(
  workspaceDir?: string,
): Promise<AgentsInstructionEntry[]> {
  const workspaceRoot = path.resolve(workspaceDir || process.cwd());
  const startDir = path.resolve(process.cwd());

  const entries: AgentsInstructionEntry[] = [];
  const seen = new Set<string>();

  let current = startDir;
  while (true) {
    const candidate = path.resolve(path.join(current, 'AGENTS.md'));
    const normalized = normalizeAgentsPath(candidate);
    if (!seen.has(normalized)) {
      const content = await readAgentsFile(candidate);
      if (content) {
        entries.push({
          path: displayAgentsPath(candidate, workspaceRoot),
          content,
        });
        seen.add(normalized);
      }
    }

    if (path.resolve(current) === workspaceRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const bootstrapFiles = await loadBootstrapFiles(workspaceRoot);
  const rootAgents = bootstrapFiles.find(f => f.name === 'AGENTS.md' && !f.missing);
  if (rootAgents?.content?.trim() && rootAgents.path) {
    const resolved = path.resolve(rootAgents.path);
    const normalized = normalizeAgentsPath(resolved);
    if (!seen.has(normalized)) {
      entries.push({
        path: displayAgentsPath(resolved, workspaceRoot),
        content: rootAgents.content.trim(),
      });
      seen.add(normalized);
    }
  }

  return entries;
}

export async function buildAgentsEnvelopeContext(workspaceDir?: string): Promise<string | null> {
  const chain = await collectAgentsInstructionChain(workspaceDir);
  if (chain.length === 0) return null;

  const lines: string[] = ['[Agents instructions]'];
  for (const entry of chain) {
    lines.push('', `## ${entry.path}`, '', entry.content);
  }
  return lines.join('\n');
}
