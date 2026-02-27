/**
 * ZhinAgent System Prompt 构建 + 消息辅助函数
 */

import * as path from 'path';
import type { ContentPart } from './types.js';
import type { SkillFeature } from '../built/skill.js';
import type { ZhinAgentConfig } from './zhin-agent-config.js';
import type { ToolContext } from '../types.js';
import { SECTION_SEP, HISTORY_CONTEXT_MARKER, CURRENT_MESSAGE_MARKER } from './zhin-agent-config.js';
import type { ChatMessage } from './types.js';
import { getFileMemoryContext } from './bootstrap.js';

export function contentToText(c: string | ContentPart[]): string {
  if (typeof c === 'string') return c;
  return (c as ContentPart[]).map(p => (p.type === 'text' ? p.text : '')).join('');
}

export function buildUserMessageWithHistory(history: ChatMessage[], currentContent: string): string {
  if (history.length === 0) return currentContent;
  const roleLabel = (role: string) => (role === 'user' ? '用户' : role === 'assistant' ? '助手' : '系统');
  const lines = history
    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map(m => `${roleLabel(m.role)}: ${contentToText(m.content)}`);
  const historyBlock = lines.join('\n');
  return `${HISTORY_CONTEXT_MARKER}\n${historyBlock}\n\n${CURRENT_MESSAGE_MARKER}\n${currentContent}`;
}

export function buildEnhancedPersona(
  config: Required<ZhinAgentConfig>,
  profileSummary: string,
  toneHint: string,
): string {
  let persona = config.persona;
  if (profileSummary) {
    persona += `\n\n${profileSummary}`;
  }
  if (toneHint) {
    persona += `\n\n[语气提示] ${toneHint}`;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: tz });
  persona += `\n\n当前时间: ${timeStr} (${tz})`;
  return persona;
}

export function buildContextHint(context: ToolContext, _content: string): string {
  const parts: string[] = [];
  if (context.platform) parts.push(`平台:${context.platform}`);
  if (context.botId) parts.push(`Bot:${context.botId}`);
  if (context.senderId) parts.push(`用户:${context.senderId}`);
  if (context.scope) parts.push(`场景类型:${context.scope}`);
  if (context.sceneId) parts.push(`场景ID:${context.sceneId}`);
  if (parts.length === 0) return '';
  return `\n上下文: ${parts.join(' | ')}`;
}

export interface RichSystemPromptContext {
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillFeature | null;
  skillsSummaryXML: string;
  activeSkillsContext: string;
  bootstrapContext: string;
}

export function buildRichSystemPrompt(ctx: RichSystemPromptContext): string {
  const { config, skillRegistry, skillsSummaryXML, activeSkillsContext, bootstrapContext } = ctx;
  const parts: string[] = [];
  const cwd = process.cwd();
  const dataDir = path.join(cwd, 'data');

  // §1 Identity
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = now.toLocaleString('zh-CN', { timeZone: tz });
  const memoryDir = path.join(dataDir, 'memory');
  const todayStr = new Date().toISOString().split('T')[0];
  const identityLines: string[] = [
    config.persona,
    '',
    `当前时间: ${timeStr} (${tz})`,
    `工作区: ${cwd}`,
    `数据目录: ${dataDir}（记忆、技能等）`,
    `长期记忆: ${path.join(memoryDir, 'MEMORY.md')}；今日笔记: ${path.join(memoryDir, todayStr + '.md')}。重要事项可用 write_file 写入 MEMORY.md。`,
  ];
  parts.push(identityLines.join('\n'));

  // §2 Rules
  const ruleLines = [
    '## 规则',
    '1. 直接调用工具执行操作，不要描述步骤或解释意图',
    '2. 时间/日期问题：直接用上方"当前时间"回答，不调工具',
    '3. 修改文件必须调用 edit_file/write_file，禁止给手动教程',
    '4. activate_skill 返回后，必须继续调用其中指导的工具，不要停',
    '5. 所有回答必须基于工具返回的实际数据',
    '6. 工具失败时尝试替代方案，不要直接把错误丢给用户',
    '7. 只根据用户**最后一条**消息作答，前面的对话仅作背景',
    '8. 耗时或复杂的独立任务可使用 spawn_task 交给后台处理，不要阻塞当前对话',
    '9. 用户要求从 URL 安装/加入/学习技能时，使用 install_skill(url) 下载并安装，安装后自动 activate_skill 激活',
  ];
  parts.push(ruleLines.join('\n'));

  // §3 Skills
  if (skillsSummaryXML) {
    parts.push('## 可用技能\n\n以下技能可扩展你的能力。使用技能时用 read_file 读取对应 SKILL.md，或直接调用 activate_skill(name)。\n\n' + skillsSummaryXML + '\n\n用户提到技能名 → 调用 activate_skill(name) → 按返回的指导执行工具');
  } else if (skillRegistry && skillRegistry.size > 0) {
    const skills = skillRegistry.getAll();
    const skillLines: string[] = ['## 可用技能'];
    for (const skill of skills) {
      skillLines.push(`- ${skill.name}: ${skill.description}`);
    }
    skillLines.push('用户提到技能名 → 调用 activate_skill(name) → 按返回的指导执行工具');
    parts.push(skillLines.join('\n'));
  }

  // §4 Active skills
  if (activeSkillsContext) {
    parts.push('## Active Skills\n\n' + activeSkillsContext);
  }

  // §5 Memory
  const fileMemory = getFileMemoryContext();
  if (fileMemory) {
    parts.push('## Memory\n\n' + fileMemory);
  }
  if (bootstrapContext && bootstrapContext.includes('AGENTS.md')) {
    parts.push('## 记忆\n\n长期记忆与重要记录见下方引导文件 AGENTS.md。');
  }

  // §6 Bootstrap
  if (bootstrapContext) {
    parts.push(bootstrapContext);
  }

  return parts.filter(Boolean).join(SECTION_SEP);
}
