import type {
  AgentPromptBuildContext,
  AgentPromptContributor,
  AgentPromptSection,
  DeferredToolCatalogItem,
} from 'zhin.js';
import { filterTools, type AgentTool } from 'zhin.js/ai';

function isIcqqDelegatedTask(query: string, goal: string): boolean {
  const text = `${query} ${goal}`;
  const lower = text.toLowerCase();
  if (/\bicqq\b|mcp_icqq|send_private_msg|friend\s+send/i.test(text)) return true;
  if (/\bfriend\s+like\b/.test(lower) && /qq|好友|\d{5,}/i.test(text)) return true;
  if (/点赞/.test(text) && /qq|好友|\d{5,}/i.test(text)) return true;
  if (/发消息|发送消息|私聊/.test(text) && /qq|\d{5,}/i.test(text)) return true;
  return false;
}

function selectIcqqDeferredTools(
  query: string,
  goal: string,
  deferredCatalog: DeferredToolCatalogItem[],
  maxTools: number,
): DeferredToolCatalogItem[] {
  const pool = deferredCatalog.filter(
    t => !t.name.startsWith('mcp_filesystem') && !t.name.startsWith('mcp_memory_'),
  );
  const icqqMcpTools = pool.filter(t => t.name.startsWith('mcp_icqq_'));
  const icqqTools = pool.filter(t => t.name.startsWith('icqq_'));
  const pinned: DeferredToolCatalogItem[] = [];
  const bash = pool.find(t => t.name === 'bash');
  if (bash) pinned.push(bash);
  const preferOrder = [
    'mcp_icqq_icqq_invoke',
    'mcp_icqq_icqq_list_actions',
    'icqq_send_user_like',
    'icqq_friend_list',
    'icqq_poke',
  ];
  for (const name of preferOrder) {
    const t =
      icqqMcpTools.find(x => x.name === name) ??
      icqqTools.find(x => x.name === name);
    if (t) pinned.push(t);
  }
  for (const t of [...icqqMcpTools, ...icqqTools]) {
    if (pinned.length >= maxTools) break;
    if (!pinned.some(p => p.name === t.name)) pinned.push(t);
  }

  const extra = filterTools(query, pool as AgentTool[], { maxTools, minScore: 0.08 })
    .map((t) => ({ name: t.name, description: t.description }))
    .filter(t => !pinned.some(p => p.name === t.name));

  const merged: DeferredToolCatalogItem[] = [...pinned];
  for (const t of extra) {
    if (merged.length >= maxTools) break;
    merged.push(t);
  }
  return merged.slice(0, maxTools);
}

const ORCHESTRATOR_ICQQ = [
  'On icqq/QQ: use run_deferred_task with tool_query "mcp_icqq_icqq_invoke" or "icqq_send_user_like".',
  'Examples: send_private_msg, friend_like; do not use mcp_filesystem_* for QQ tasks.',
  'Skip tool_search when the user clearly asks to send a message, like a friend, or poke on QQ.',
].join('\n');

const WORKER_ICQQ = [
  'Send private message: `mcp_icqq_icqq_invoke` action `send_private_msg` params `{ user_id, message }`, or bash `icqq friend send <uid> "<text>"`.',
  'Friend like: action `friend_like` or `icqq_send_user_like`, or bash `icqq friend like <uid> -t <times>`.',
  'Use `icqq_list_actions` only if action name is unclear.',
  'Do NOT use mcp_filesystem_* or explore node_modules / package.json to "discover" icqq.',
  'Do not stop at --help; execute the action the goal describes.',
].map(line => `- ${line}`).join('\n');

export function createIcqqAgentPromptContributor(): AgentPromptContributor {
  return {
    platform: 'icqq',

    async buildSections(ctx: AgentPromptBuildContext): Promise<AgentPromptSection[] | null> {
      if (ctx.slot === 'orchestrator') {
        return [{
          id: 'platform.icqq.orchestrator',
          title: '## icqq / QQ',
          body: ORCHESTRATOR_ICQQ,
          priority: 50,
        }];
      }
      if (ctx.slot === 'deferred_worker') {
        const query = ctx.deferred?.toolQuery ?? ctx.deferred?.goal ?? '';
        const goal = ctx.deferred?.goal ?? '';
        if (!isIcqqDelegatedTask(query, goal)) return null;
        return [{
          id: 'platform.icqq.deferred_worker',
          title: '## icqq / QQ（本任务）',
          body: WORKER_ICQQ,
          priority: 50,
        }];
      }
      return null;
    },

    matchesDeferredTask(ctx: AgentPromptBuildContext): boolean {
      const query = ctx.deferred?.toolQuery ?? ctx.deferred?.goal ?? ctx.userMessagePreview ?? '';
      const goal = ctx.deferred?.goal ?? ctx.userMessagePreview ?? '';
      return isIcqqDelegatedTask(query, goal);
    },

    selectDeferredTools(query, goal, catalog, maxTools) {
      if (!isIcqqDelegatedTask(query, goal)) return null;
      return selectIcqqDeferredTools(query, goal, catalog, maxTools);
    },
  };
}
