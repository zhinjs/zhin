/**
 * ADR 0042 §8 fixed measurement scenes. Each scene is a scripted conversation
 * run through the real FullAgentTurnEngine; only the LAST turn is measured, the
 * earlier turns just build history. The fixture (tools, skills, workspace) is
 * deliberately the same across scenes so numbers are comparable before/after
 * a prompt-budget change.
 */
import type { EvalCase, EvalInboundMessage, EvalTool } from '../framework/index.js';
import type { ScriptStep } from '../framework/scripted-model.js';

export interface BudgetTurn {
  readonly inbound: EvalInboundMessage;
  readonly script: readonly ScriptStep[];
}

export interface BudgetScene {
  readonly id: string;
  readonly title: string;
  readonly turns: readonly BudgetTurn[];
  readonly base: Pick<EvalCase, 'tools' | 'skills' | 'nativeTools' | 'workspace' | 'hostBootstrap'>;
}

const ARG = { type: 'string', description: 'Free-form argument describing what to look up or change.' } as const;

function tool(name: string, description: string, deferred = false): EvalTool {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { target: ARG, detail: ARG }, required: ['target'] },
    result: `ok:${name}`,
    ...(deferred ? { deferred: true } : {}),
  };
}

const RESIDENT = ['get_schedule', 'get_member_info', 'send_reaction', 'pick_sticker', 'get_session_info', 'search_history']
  .map((name) => tool(name, `Chat helper ${name.replace(/_/g, ' ')}: returns structured data for the current conversation.`));

const DEFERRED = ['group_kick', 'group_mute', 'group_title', 'group_notice', 'schedule_add', 'schedule_remove', 'remind_set', 'remind_list',
  'weather_now', 'weather_forecast', 'music_search', 'music_play', 'image_gen', 'translate', 'rss_fetch', 'calc', 'qr_make', 'poll_create',
  'todo_add', 'todo_done'].map((name) => tool(name, `Plugin tool ${name.replace(/_/g, ' ')}: performs the ${name} operation on request.`, true));

const SKILLS = ['group-admin', 'scheduling', 'weather', 'music', 'image-creation', 'translation', 'reminders', 'polls'].map((name) => ({
  name,
  description: `Use for ${name.replace(/-/g, ' ')} requests in chat.`,
  instructions: `# ${name}\nFollow the ${name} workflow step by step.`,
}));

// hostBootstrap: measure with the production bootstrap path (system prompt), not the envelope fallback.
const BASE = { tools: [...RESIDENT, ...DEFERRED], skills: SKILLS, hostBootstrap: true } as const;

const GROUP = { scope: 'group', sender: { id: 'alice', name: 'Alice', roles: ['user'] } } as const;
const MASTER = { scope: 'private', sender: { id: 'master', name: 'Fin', roles: ['master'] } } as const;

export const BUDGET_SCENES: readonly BudgetScene[] = [
  {
    id: 'group-first-turn',
    title: 'Group chat, first turn of a new session',
    base: BASE,
    turns: [{ inbound: { ...GROUP, text: '@bot 大家好，你能做什么？' }, script: [{ text: '我可以聊天、查日程、管理群。' }] }],
  },
  {
    id: 'group-turn-6',
    title: 'Group chat, 6th turn with history (one tool call)',
    base: BASE,
    turns: [
      ...['今天群里有什么安排？', '明天呢？', '谁负责周会？', '周会改到几点？', '记一下，周五提醒我'].map((text): BudgetTurn => ({
        inbound: { ...GROUP, text: `@bot ${text}` },
        script: [{ text: `收到：${text}` }],
      })),
      {
        inbound: { ...GROUP, text: '@bot 帮我看看今天的日程' },
        script: [{ toolCalls: [{ name: 'get_schedule', args: { target: 'today' } }] }, { text: '今天 15:00 周会。' }],
      },
    ],
  },
  {
    id: 'master-private-tool-turn',
    title: 'Master private chat, tool turn (grep, read_file, reply)',
    base: {
      ...BASE,
      nativeTools: ['grep', 'read_file', 'list_dir'],
      workspace: { 'src/config.ts': 'export const port = 3000;\n', 'src/index.ts': 'import "./config.js";\n' },
    },
    turns: [{
      inbound: { ...MASTER, text: '项目里端口配在哪？' },
      script: [
        { toolCalls: [{ name: 'grep', args: { pattern: 'port', path: 'src' } }] },
        { toolCalls: [{ name: 'read_file', args: { file_path: 'src/config.ts' } }] },
        { text: '端口在 src/config.ts，当前是 3000。' },
      ],
    }],
  },
];
