import type { ScheduleJobExecutionPlan } from './types.js';

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
