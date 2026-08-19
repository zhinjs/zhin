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
  if (/\bicqq\b|icqq__|send_private_msg|friend\s+send/i.test(text)) return true;
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
    t => !t.name.startsWith('mcp_filesystem')
      && !t.name.startsWith('mcp_memory_')
      && !t.name.startsWith('mcp_icqq_'),
  );
  const icqqTools = pool.filter(t => t.name.startsWith('icqq__') || t.name.startsWith('icqq_'));
  const pinned: DeferredToolCatalogItem[] = [];
  const preferOrder = [
    'icqq__send_user_like',
    'icqq__friend_list',
    'icqq__poke',
  ];
  for (const name of preferOrder) {
    const t = icqqTools.find(x => x.name === name);
    if (t) pinned.push(t);
  }
  for (const t of icqqTools) {
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
  'On icqq/QQ: if icqq__send_user_like is in your tool list, call it now with { endpoint_id, user_id, times }.',
  'endpoint_id is this bot QQ (Session endpoint). user_id is the sender to like. times is 1-20.',
  'Do not tell the user the tool is missing until you have called it this turn (or load_tool("icqq__send_user_like") failed).',
  'Ignore prior turns that said the like tool was unavailable. Other social tools: icqq__poke, icqq__friend_list.',
].join('\n');

const WORKER_ICQQ = [
  'Friend like: load_tool("icqq__send_user_like") then call with { endpoint_id, user_id, times }. endpoint_id is this bot QQ (origin.endpoint).',
  'Poke: icqq__poke. Friend list: icqq__friend_list.',
  'Do NOT use mcp_icqq_*, mcp_filesystem_*, or bash `icqq friend like`.',
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
