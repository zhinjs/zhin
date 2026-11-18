/**
 * #1250: static check (config file only, no IM layers) for approval settings that cannot be answered.
 * Unattended turns (scheduled tasks, reminders, background events, MCP / A2A calls) have no approval
 * channel; in IM only the bot owner, or a zhin `admin` confirming their own live turn, can approve.
 */
export interface ApprovalConfigDiagnosis {
  readonly status: 'ok' | 'warn';
  readonly message: string;
  readonly fix?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

type ConfirmLevel = 'off' | 'untrusted_content' | 'any_content' | 'always';

/** ADR 0067 categories as written in config, with their default levels (kept in step with `@zhin.js/agent`). */
const CATEGORIES: readonly (readonly [key: string, label: string, fallback: ConfirmLevel])[] = [
  ['shell', '执行命令', 'any_content'],
  ['fileWrite', '写文件', 'any_content'],
  ['outbound', '向其他会话发消息', 'any_content'],
  ['config', '修改配置', 'any_content'],
  ['schedule', '定时任务', 'untrusted_content'],
];
const LEVELS = new Set<string>(['off', 'untrusted_content', 'any_content', 'always']);

/** ADR 0067 D3: same resolution as the agent (a string applies to every category; unknown values never relax). */
function confirmLevels(raw: unknown): Readonly<Record<string, ConfirmLevel>> {
  if (raw === undefined || raw === null) return Object.fromEntries(CATEGORIES.map(([key, , fallback]) => [key, fallback]));
  if (typeof raw === 'string') {
    const level: ConfirmLevel = raw === 'off' ? 'off' : raw === 'always' ? 'always' : 'any_content';
    return Object.fromEntries(CATEGORIES.map(([key]) => [key, level]));
  }
  const tiers = record(raw) ?? {};
  return Object.fromEntries(CATEGORIES.map(([key, , fallback]) => {
    const value = tiers[key];
    if (value === undefined) return [key, fallback];
    return [key, typeof value === 'string' && LEVELS.has(value) ? value as ConfirmLevel : 'any_content'];
  }));
}

const STRING_FORMS = new Set<string>(['external_content', 'always', 'off']);

/** Values the agent cannot read and treats as `any_content` (e.g. `Always`, `fileWrite: yes`, `file_write:`). */
function unrecognisedConfirmValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') return STRING_FORMS.has(raw) ? [] : [`confirmHighRisk: ${JSON.stringify(raw)}`];
  const tiers = record(raw);
  if (!tiers) return [`confirmHighRisk: ${JSON.stringify(raw)}`];
  const known = new Set(CATEGORIES.map(([key]) => key));
  return Object.entries(tiers).flatMap(([key, value]) => {
    if (!known.has(key)) return [`confirmHighRisk.${key}（未知类别，被忽略）`];
    if (value === undefined || (typeof value === 'string' && LEVELS.has(value))) return [];
    return [`confirmHighRisk.${key}: ${JSON.stringify(value)}`];
  });
}

/** ADR 0067 D2.1: what the schedule relaxation does and does not cover. */
export const SCHEDULE_RELAXATION_NOTE = '定时任务类别为 untrusted_content：只读过第一方只读查询（如天气）后创建定时任务不再确认；'
  + '但这样创建的任务每次到点运行（以及 schedule_preview 预演）都按读过外部内容处理，其中写文件、向其他会话发消息、修改配置、执行命令会被拒绝；'
  + 'schedule_preview 会立刻执行提示词，不享受这一放宽（至少按 any_content 确认）';

/** ADR 0067 D5: what turning every category off gives up, and a narrower setting that keeps it. */
export const CONFIRM_HIGH_RISK_OFF_MESSAGE = 'ai.agent.injectionGuard.confirmHighRisk 已全部关闭：读过网页、MCP 工具结果、文件内容或群聊背景之后，'
  + '被注入的指令可以直接执行命令、写文件、向其他会话发消息、修改配置、创建定时任务，不再经过任何人确认';
export const CONFIRM_HIGH_RISK_OFF_FIX = '删掉 confirmHighRisk 使用默认值（第一方只读查询如天气不再触发确认），'
  + '或只关掉需要的类别，例如 confirmHighRisk: { schedule: off }；结果确实可信的工具写进 injectionGuard.trustedOutputTools';

export function diagnoseApprovalChannelConfig(config: Record<string, unknown> | null | undefined): ApprovalConfigDiagnosis | undefined {
  const ai = record(config?.ai);
  if (!ai || ai.enabled === false) return undefined;
  const agent = record(ai.agent);
  const mode = agent?.execApprovalMode ?? 'auto';
  const raw = record(agent?.injectionGuard)?.confirmHighRisk;
  const levels = confirmLevels(raw);
  const off = CATEGORIES.filter(([key]) => levels[key] === 'off');
  const allOff = off.length === CATEGORIES.length;
  if (mode === 'ask') {
    return {
      status: 'warn',
      message: 'ai.agent.execApprovalMode 为 ask：定时任务等无人值守回合没有审批渠道，需要审批的工具会被直接拒绝；'
        + 'IM 里只有 Bot 主人或 zhin 管理员（admin，本人发起的实时回合）能确认，其他用户需要审批的操作会被拒绝'
        + (allOff ? `。另外，${CONFIRM_HIGH_RISK_OFF_MESSAGE}` : ''),
      fix: '需要无人值守执行时改为 execApprovalMode: auto（审核 Agent 判断），或在 Console 中操作'
        + (allOff ? `；${CONFIRM_HIGH_RISK_OFF_FIX}` : ''),
    };
  }
  if (allOff) {
    return { status: 'warn', message: CONFIRM_HIGH_RISK_OFF_MESSAGE, fix: CONFIRM_HIGH_RISK_OFF_FIX };
  }
  const unrecognised = unrecognisedConfirmValues(raw);
  if (unrecognised.length) {
    return {
      status: 'warn',
      message: `无法识别的高危确认配置：${unrecognised.join('、')}；无法识别的级别按 any_content 处理（不会放宽，但也不是你想要的设置）`,
      fix: '级别只能是 off / untrusted_content / any_content / always（小写），类别只能是 shell / fileWrite / outbound / config / schedule；'
        + '字符串形式只能是 external_content / always / off',
    };
  }
  const notes = [
    `execApprovalMode: ${String(mode)}；读取外部内容后的高危动作在实时 IM 会话中请发起人确认，定时任务等无人值守回合中会被拒绝`,
    ...(off.length ? [`已关闭确认的类别：${off.map(([, label]) => label).join('、')}`] : []),
    ...(levels.schedule === 'untrusted_content' ? [SCHEDULE_RELAXATION_NOTE] : []),
    ...(raw === 'external_content'
      ? ['confirmHighRisk 显式写为 external_content，保持原来的严格度：只读过第一方只读查询（如天气）后建定时任务也要确认；'
        + '想用新默认值（这种情况不再确认），删掉这一行或改为按类别配置（ADR 0067）']
      : []),
  ];
  return { status: 'ok', message: notes.join('；') };
}
