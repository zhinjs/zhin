/**
 * ZhinAgent System Prompt builder + message helpers
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
  const roleLabel = (role: string) => (role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : 'System');
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
    persona += `\n\n[Tone hint] ${toneHint}`;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = new Date().toLocaleString('zh-CN', { timeZone: tz });
  persona += `\n\nCurrent time: ${timeStr} (${tz})`;
  return persona;
}

export function buildContextHint(context: ToolContext, _content: string): string {
  const parts: string[] = [];
  if (context.platform) parts.push(`platform:${context.platform}`);
  if (context.botId) parts.push(`bot:${context.botId}`);
  if (context.senderId) parts.push(`user:${context.senderId}`);
  if (context.scope) parts.push(`scope:${context.scope}`);
  if (context.sceneId) parts.push(`scene:${context.sceneId}`);
  if (parts.length === 0) return '';
  return `\nContext: ${parts.join(' | ')}`;
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
  const todayStr = now.toISOString().split('T')[0];
  parts.push([
    config.persona,
    '',
    `Current time: ${timeStr} (${tz})`,
    `Workspace: ${cwd}`,
    `Data dir: ${dataDir}`,
    `Long-term memory: ${path.join(memoryDir, 'MEMORY.md')}; today's notes: ${path.join(memoryDir, todayStr + '.md')}. Use write_file to persist important info.`,
  ].join('\n'));

  // §2 Rules
  parts.push([
    '## Rules',
    '1. Call tools directly — do not describe steps or explain intent',
    '2. For time/date questions, use "Current time" above — no tool needed',
    '3. File changes must use edit_file/write_file — never give manual instructions',
    '4. After activate_skill returns, continue calling the tools it specifies — do not stop',
    '5. All answers must be based on actual tool output',
    '6. On tool failure, try alternatives — do not dump raw errors to user',
    '7. Answer based on the user\'s **last message** only; prior messages are context',
    '8. Use spawn_task for long/complex independent tasks — do not block the conversation',
    '9. When user asks to install/learn a skill from URL, use install_skill(url) then activate_skill',
  ].join('\n'));

  // §3 Skills
  if (skillsSummaryXML) {
    parts.push('## Available Skills\n\n' + skillsSummaryXML + '\n\nUser mentions skill → activate_skill(name) → follow returned instructions');
  } else if (skillRegistry && skillRegistry.size > 0) {
    const skills = skillRegistry.getAll();
    const lines: string[] = ['## Available Skills'];
    for (const skill of skills) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
    lines.push('User mentions skill → activate_skill(name) → follow returned instructions');
    parts.push(lines.join('\n'));
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

  // §6 Bootstrap
  if (bootstrapContext) {
    parts.push(bootstrapContext);
  }

  return parts.filter(Boolean).join(SECTION_SEP);
}
