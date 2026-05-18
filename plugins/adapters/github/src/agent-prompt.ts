import type {
  AgentPromptBuildContext,
  AgentPromptContributor,
  AgentPromptSection,
} from 'zhin.js';
import type { AgentTool } from 'zhin.js';
import { filterTools } from 'zhin.js';

function isGithubDelegatedTask(query: string, goal: string): boolean {
  const text = `${query} ${goal}`;
  return /github|gh_|mcp_github|\bissue\b|pull\s*request|\bpr\b/i.test(text);
}

function selectGithubDeferredTools(
  query: string,
  goal: string,
  deferredCatalog: AgentTool[],
  maxTools: number,
): AgentTool[] {
  const pool = deferredCatalog.filter(
    t => !t.name.startsWith('mcp_filesystem') && !t.name.startsWith('mcp_icqq_'),
  );
  const pinned: AgentTool[] = [];
  const bash = pool.find(t => t.name === 'bash');
  if (bash) pinned.push(bash);

  const preferNames = [
    ...pool.filter(t => t.name.startsWith('mcp_github_')).map(t => t.name),
    ...pool.filter(t => t.name.startsWith('github_')).map(t => t.name),
  ];
  for (const name of preferNames) {
    if (pinned.length >= maxTools) break;
    const t = pool.find(x => x.name === name);
    if (t && !pinned.some(p => p.name === name)) pinned.push(t);
  }

  const extra = filterTools(`${query} ${goal}`, pool, { maxTools, minScore: 0.08 })
    .filter(t => !pinned.some(p => p.name === t.name));

  const merged = [...pinned];
  for (const t of extra) {
    if (merged.length >= maxTools) break;
    merged.push(t);
  }
  return merged.slice(0, maxTools);
}

const ORCHESTRATOR_GITHUB = [
  'On GitHub: use run_deferred_task with tool_query "github_" or "mcp_github_" or "gh issue"/"gh pr".',
  'Discuss issues/PRs in chat context; do not call github_* or mcp_github_* tools on this orchestrator.',
  'Skip tool_search when the user clearly names a repo, issue number, or PR.',
].join('\n');

const WORKER_GITHUB = [
  'Prefer `gh` via bash for repo operations when bash is available.',
  'Use mcp_github_* or github_* plugin tools for structured API actions.',
  'Do not use mcp_filesystem_* or unrelated MCP servers to "discover" GitHub.',
  'Summarize outcomes (issue link, PR state) for the orchestrator.',
].map(line => `- ${line}`).join('\n');

export function createGithubAgentPromptContributor(): AgentPromptContributor {
  return {
    platform: 'github',

    async buildSections(ctx: AgentPromptBuildContext): Promise<AgentPromptSection[] | null> {
      if (ctx.slot === 'orchestrator') {
        if (!ctx.toolSearch) return null;
        return [{
          id: 'platform.github.orchestrator',
          title: '## GitHub',
          body: ORCHESTRATOR_GITHUB,
          priority: 50,
        }];
      }
      if (ctx.slot === 'deferred_worker') {
        const query = ctx.deferred?.toolQuery ?? ctx.deferred?.goal ?? '';
        const goal = ctx.deferred?.goal ?? '';
        if (!isGithubDelegatedTask(query, goal)) return null;
        return [{
          id: 'platform.github.deferred_worker',
          title: '## GitHub（本任务）',
          body: WORKER_GITHUB,
          priority: 50,
        }];
      }
      return null;
    },

    matchesDeferredTask(ctx: AgentPromptBuildContext): boolean {
      const query = ctx.deferred?.toolQuery ?? ctx.deferred?.goal ?? ctx.userMessagePreview ?? '';
      const goal = ctx.deferred?.goal ?? ctx.userMessagePreview ?? '';
      return isGithubDelegatedTask(query, goal);
    },

    selectDeferredTools(query, goal, catalog, maxTools) {
      if (!isGithubDelegatedTask(query, goal)) return null;
      return selectGithubDeferredTools(query, goal, catalog, maxTools);
    },
  };
}
