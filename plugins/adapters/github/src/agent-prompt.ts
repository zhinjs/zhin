import type {
  AgentPromptBuildContext,
  AgentPromptContributor,
  AgentPromptSection,
  DeferredToolCatalogItem,
} from 'zhin.js';
import { filterTools, type AgentTool } from 'zhin.js/ai';

function selectGithubDeferredTools(
  query: string,
  goal: string,
  deferredCatalog: DeferredToolCatalogItem[],
  maxTools: number,
): DeferredToolCatalogItem[] {
  const pool = deferredCatalog.filter(
    t => !t.name.startsWith('mcp_filesystem') && !t.name.startsWith('mcp_icqq_'),
  );
  const pinned: DeferredToolCatalogItem[] = [];
  const bash = pool.find(t => t.name === 'bash');
  if (bash) pinned.push(bash);

  const preferNames = [
    ...pool.filter(t => t.name.startsWith('github_')).map(t => t.name),
    ...pool.filter(t => t.name.startsWith('mcp_github_')).map(t => t.name),
  ];
  for (const name of preferNames) {
    if (pinned.length >= maxTools) break;
    const t = pool.find(x => x.name === name);
    if (t && !pinned.some(p => p.name === name)) pinned.push(t);
  }

  const extra = filterTools(`${query} ${goal}`, pool as AgentTool[], { maxTools, minScore: 0.08 })
    .map((t) => ({ name: t.name, description: t.description }));

  const merged: DeferredToolCatalogItem[] = [...pinned];
  for (const t of extra) {
    if (merged.length >= maxTools) break;
    if (!merged.some(p => p.name === t.name)) merged.push(t);
  }
  return merged.slice(0, maxTools);
}

function isGithubDelegatedTask(query: string, goal: string): boolean {
  const text = `${query} ${goal}`;
  return /github|gh_|mcp_github|\bissue\b|pull\s*request|\bpr\b/i.test(text);
}

const ORCHESTRATOR_GITHUB = [
  'On GitHub: use run_deferred_task with tool_query "github_".',
  'Discuss issues/PRs in chat context; do not call github_* tools on this orchestrator.',
  'Bot write operations use github_* tools (Installation Token), not mcp_github_*.',
].join('\n');

const WORKER_GITHUB = [
  'Use github_prepare_workspace before multi-file edits in a repo.',
  'Small single-file change: github_patch_file (Contents API).',
  'Multi-file / tests: workspace + bash, then github_push_branch (requires approval) and github_create_pr for Issues.',
  'Issue thread: new branch + new PR. PR thread: push to existing PR head branch.',
  'Do NOT use mcp_github_* for writes — PAT acts as human, not Bot.',
  'Summarize outcomes (PR link, branch) for the orchestrator.',
].map(line => `- ${line}`).join('\n');

export function createGithubAgentPromptContributor(): AgentPromptContributor {
  return {
    platform: 'github',

    async buildSections(ctx: AgentPromptBuildContext): Promise<AgentPromptSection[] | null> {
      if (ctx.slot === 'orchestrator') {
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
