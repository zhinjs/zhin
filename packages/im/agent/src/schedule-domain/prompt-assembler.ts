import type { ScheduleJobCreator } from '../assistant/types.js';

export interface SchedulePromptAssemblerInput {
  jobId: string;
  prompt: string;
  createdBy?: ScheduleJobCreator;
  now?: Date;
  timeZone?: string;
  platformContext?: string;
  memoryContext?: string;
  skillContext?: string;
  bootstrapContext?: string;
  security?: Readonly<{ execPreset: 'readonly' | 'network' }>;
}

export interface SchedulePromptAssembly {
  systemPrompt: string;
  userPrompt: string;
}

function formatTime(now: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false,
  }).format(now);
}

function section(title: string, content?: string): string | null {
  const value = content?.trim();
  return value ? `# ${title}\n${value}` : null;
}

export function assembleSchedulePrompt(input: SchedulePromptAssemblerInput): SchedulePromptAssembly {
  const creator = input.createdBy
    ? `${input.createdBy.name ?? input.createdBy.userId} (${input.createdBy.roles.join(', ') || 'readonly'})`
    : 'system (readonly)';
  const identity = [
    '# 执行身份与约束',
    '你是一个定时任务执行引擎。直接完成任务并输出最终结果。',
    '禁止确认语、进度报告、寒暄、元评论和对话式措辞。',
    '不得请求用户确认，不得派生子任务。工具或权限不足时明确失败，不得虚构结果。',
  ].join('\n');
  const runtime = [
    '# 执行上下文',
    `当前时间: ${formatTime(input.now ?? new Date(), input.timeZone)}`,
    `任务 ID: ${input.jobId}`,
    `创建者: ${creator}`,
  ].join('\n');
  const execPreset = input.security?.execPreset ?? 'readonly';
  const safety = [
    '# 安全约束',
    '- 文件访问仅限 workspace。',
    `- Shell 仅允许 ${execPreset} preset；无人值守审批一律拒绝。`,
    '- 网络访问仅允许 HTTPS 且必须通过既有域名白名单。',
  ].join('\n');
  const output = [
    '# 输出格式',
    '只输出最终内容，不包含前缀、后缀、系统标记或执行元信息。',
  ].join('\n');

  return {
    systemPrompt: [
      identity,
      runtime,
      section('平台上下文', input.platformContext),
      safety,
      section('技能指令', input.skillContext),
      section('记忆', input.memoryContext),
      section('Workspace 指令', input.bootstrapContext),
      output,
    ].filter((value): value is string => Boolean(value)).join('\n\n'),
    userPrompt: input.prompt.trim(),
  };
}
