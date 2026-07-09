import type { ScheduleJobExecutionPlan } from './types.js';

/** commMessage.extra / AI hookContext 键名（legacy；新路径用 TurnContext ALS） */
export const SCHEDULE_MESSAGE_EXTRA = {
  createdBy: 'scheduleCreatedBy',
  activityFeedback: 'scheduleActivityFeedback',
  preview: 'schedulePreview',
  executionPlan: 'scheduleExecutionPlan',
  jobId: 'scheduleJobId',
} as const;

export type ScheduleTurnPromptMode = 'preview' | 'scheduled';

export function buildScheduleTurnPrompt(input: {
  basePrompt: string;
  mode: ScheduleTurnPromptMode;
}): string {
  const base = input.basePrompt.trim();
  if (input.mode === 'preview') {
    return [
      '[系统] 这是调度任务预演（dry-run），不会向群聊投递最终结果。',
      '请按真实到点执行的预期完成一次完整输出；系统将记录所用工具/技能并展示给创建者确认。',
      '不要输出「收到」「正在安排」等元评论，直接给出预演结果正文。',
      '',
      `任务: ${base}`,
    ].join('\n');
  }

  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { hour12: false });
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdays[now.getDay()];
  return [
    `[系统] 这是定时任务自动触发，当前时间: ${timeStr} 星期${weekday}`,
    '你的输出将被直接发送到目标聊天中，请注意：',
    '- 直接输出最终内容，不要包含任何确认、进度报告或元评论（如"收到""正在执行""已完成"等）',
    '- 不要使用"为您""帮你"等对话式措辞，你不是在回复某个人的请求',
    '- 像一个真实的群成员一样自然发言',
    '',
    `任务: ${base}`,
  ].join('\n');
}

/** @deprecated use buildScheduleTurnPrompt */
export function buildScheduleTimeContextPrompt(prompt: string): string {
  return buildScheduleTurnPrompt({ basePrompt: prompt, mode: 'scheduled' });
}

/** @deprecated use buildScheduleTurnPrompt */
export function buildSchedulePreviewPrompt(prompt: string): string {
  return buildScheduleTurnPrompt({ basePrompt: prompt, mode: 'preview' });
}

export function parseStringArrayArg(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function parseExecutionPlanFromArgs(
  args: Record<string, unknown>,
  fallbackPrompt: string,
): ScheduleJobExecutionPlan | undefined {
  const raw = args.execution_plan ?? args.executionPlan;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const prompt = String(record.prompt ?? fallbackPrompt).trim();
    const tools = parseStringArrayArg(record.tools);
    const skills = parseStringArrayArg(record.skills);
    const previewSample = record.previewSample != null ? String(record.previewSample) : undefined;
    if (!prompt && !tools.length && !skills.length && !previewSample) return undefined;
    return {
      prompt: prompt || fallbackPrompt,
      tools: tools.length ? tools : undefined,
      skills: skills.length ? skills : undefined,
      previewSample,
      previewedAt: typeof record.previewedAt === 'number' ? record.previewedAt : undefined,
      confirmed: record.confirmed === true,
    };
  }

  const refined = args.refined_prompt != null ? String(args.refined_prompt).trim() : '';
  const tools = parseStringArrayArg(args.tools);
  const skills = parseStringArrayArg(args.skills);
  if (!refined && !tools.length && !skills.length) return undefined;
  return {
    prompt: refined || fallbackPrompt,
    tools: tools.length ? tools : undefined,
    skills: skills.length ? skills : undefined,
  };
}

export function parseScheduleJobExecutionPlan(raw: unknown): ScheduleJobExecutionPlan | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const prompt = record.prompt != null ? String(record.prompt).trim() : '';
  if (!prompt) return undefined;
  const tools = parseStringArrayArg(record.tools);
  const skills = parseStringArrayArg(record.skills);
  return {
    prompt,
    tools: tools.length ? tools : undefined,
    skills: skills.length ? skills : undefined,
    previewSample: record.previewSample != null ? String(record.previewSample) : undefined,
    previewedAt: typeof record.previewedAt === 'number' ? record.previewedAt : undefined,
    confirmed: record.confirmed === true,
  };
}
