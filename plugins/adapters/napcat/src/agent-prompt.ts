import type {
  AgentPromptBuildContext,
  AgentPromptContributor,
  AgentPromptSection,
  AgentTool,
} from 'zhin.js';
import { filterTools } from 'zhin.js';

function isNapCatDelegatedTask(query: string, goal: string): boolean {
  const text = `${query} ${goal}`;
  if (/\bnapcat\b|napcat_|mcp_napcat/i.test(text)) return true;
  if (/戳一戳|poke|表情回应|emoji.*reaction/i.test(text)) return true;
  if (/精华消息|essence|群公告|group.*notice/i.test(text)) return true;
  if (/AI语音|ai.*record|tts|文字转语音/i.test(text)) return true;
  if (/群文件|upload.*file|群签到|group.*sign/i.test(text)) return true;
  if (/合并转发|forward.*msg|转发消息/i.test(text)) return true;
  if (/点赞/.test(text) && /qq|好友|\d{5,}/i.test(text)) return true;
  return false;
}

function selectNapCatDeferredTools(
  query: string,
  goal: string,
  deferredCatalog: AgentTool[],
  maxTools: number,
): AgentTool[] {
  const pool = deferredCatalog.filter(
    t => !t.name.startsWith('mcp_filesystem') && !t.name.startsWith('mcp_memory_'),
  );
  const napcatTools = pool.filter(t => t.name.startsWith('napcat_'));
  const pinned: AgentTool[] = [];
  const preferOrder = [
    'napcat_send_poke',
    'napcat_set_emoji_reaction',
    'napcat_send_like',
    'napcat_set_essence_msg',
    'napcat_send_group_notice',
    'napcat_ai_tts',
  ];
  for (const name of preferOrder) {
    const t = napcatTools.find(x => x.name === name);
    if (t) pinned.push(t);
  }
  for (const t of napcatTools) {
    if (pinned.length >= maxTools) break;
    if (!pinned.some(p => p.name === t.name)) pinned.push(t);
  }

  const extra = filterTools(query, pool, { maxTools, minScore: 0.08 })
    .filter(t => !pinned.some(p => p.name === t.name));

  const merged: AgentTool[] = [...pinned];
  for (const t of extra) {
    if (merged.length >= maxTools) break;
    merged.push(t);
  }
  return merged.slice(0, maxTools);
}

const ORCHESTRATOR_NAPCAT = [
  'On napcat/QQ: use run_deferred_task with tool_query "napcat_send_poke" or "napcat_set_emoji_reaction".',
  'NapCat supports: poke, emoji reaction, forward msg, essence, group notice, AI TTS, OCR, group files.',
  'Skip tool_search when the user clearly asks for QQ-specific features like poke, reaction, or group management.',
].join('\n');

const WORKER_NAPCAT = [
  '- Use `napcat_send_poke` for poke/戳一戳.',
  '- Use `napcat_set_emoji_reaction` for emoji reaction/表情回应.',
  '- Use `napcat_send_like` for friend like/点赞.',
  '- Use `napcat_ai_tts` for AI voice/AI语音.',
  '- Use `napcat_set_essence_msg` / `napcat_delete_essence_msg` for essence messages.',
  '- Use `napcat_send_group_notice` for group announcements.',
  '- Do NOT use mcp_filesystem_* or explore node_modules for QQ tasks.',
].join('\n');

export function createNapCatAgentPromptContributor(): AgentPromptContributor {
  return {
    platform: 'napcat',

    async buildSections(ctx: AgentPromptBuildContext): Promise<AgentPromptSection[] | null> {
      if (ctx.slot === 'orchestrator') {
        return [{
          id: 'platform.napcat.orchestrator',
          title: '## napcat / QQ',
          body: ORCHESTRATOR_NAPCAT,
          priority: 50,
        }];
      }
      if (ctx.slot === 'deferred_worker') {
        const query = ctx.deferred?.toolQuery ?? ctx.deferred?.goal ?? '';
        const goal = ctx.deferred?.goal ?? '';
        if (!isNapCatDelegatedTask(query, goal)) return null;
        return [{
          id: 'platform.napcat.deferred_worker',
          title: '## napcat / QQ（本任务）',
          body: WORKER_NAPCAT,
          priority: 50,
        }];
      }
      return null;
    },

    matchesDeferredTask(ctx: AgentPromptBuildContext): boolean {
      const query = ctx.deferred?.toolQuery ?? ctx.deferred?.goal ?? ctx.userMessagePreview ?? '';
      const goal = ctx.deferred?.goal ?? ctx.userMessagePreview ?? '';
      return isNapCatDelegatedTask(query, goal);
    },

    selectDeferredTools(query, goal, catalog, maxTools) {
      if (!isNapCatDelegatedTask(query, goal)) return null;
      return selectNapCatDeferredTools(query, goal, catalog, maxTools);
    },
  };
}
