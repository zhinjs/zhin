/**
 * 危险工具硬闸（ADR 0036 §3，切片 E）。
 *
 * 硬闸 ≠ `execApprovalMode: ask`：
 * - ask / auto / bypass 只决定「普通审批」由谁回答；硬闸独立于它们，`bypass`、自动审核 Agent、
 *   主人免审、会话内「记住」的授权都**不能**放行危险工具——每次都要一次新鲜的人工批准
 *   （复用审批端口的 `humanOnly`），或运营者在 Console 批准过的同参数卡片。
 * - 拒绝即 fail closed：本次调用不执行；给模型的结果只说明「已拒绝、需人工审批」，
 *   同一回合内同一工具 / 同一危险类别的后续调用直接拒绝，不再弹审批，避免模型改参数反复重试。
 * - 工具声明 `risk: 'dangerous' | 'safe'`；核心名单与宿主配置只能把工具**调高**为 dangerous，
 *   声明 `safe` 不能把核心名单里的工具调低。
 * - 资金类默认禁用（`ai.agent.toolHardGate.allowFunds`），开启后仍需审批。
 * - 控制面（ADR 0036 §2，#1008）：会话处于 `emergency_stop` 或 `read_only`（含控制面状态不可用）时，
 *   危险工具在弹审批之前直接拒绝；`muted` / `mention_only` 不拦硬闸管理工具。
 *
 * - IM 审批通道（G6，#1013，`ai.agent.toolHardGate.imApproval`，默认关）：卡片入队后由宿主向 allowlist
 *   审批人私聊（或专用审批群）投递，审批人用固定命令结算同一 {@link ToolApprovalQueue}；仍是 humanOnly、
 *   一次一批，不提供「本会话 / 永久」授权，业务群消息不能结算。
 *
 * 审计写 `tool_approval` / `tool_hard_gate`（`ai_decision_events`）；审计写失败不影响判定。
 */
import type { DecisionEventInput, DecisionReasonCode } from '../decision-events.js';
import {
  isApprovalPortAvailable,
  requestApprovalOutcome,
  type ApprovalOutcome,
  type ApprovalPort,
} from '../session/approval-port.js';
import {
  DEFAULT_TOOL_APPROVAL_TTL_MS,
  ToolApprovalQueue,
  type ToolApprovalChannel,
  type ToolApprovalEntry,
  type ToolApprovalOrigin,
} from './tool-approval-queue.js';

export type ToolRisk = 'dangerous' | 'safe';
/** ADR 0036 §3 危险类别：成员管理 / 内容发布 / 资金 / 身份。 */
export type DangerousToolCategory = 'member' | 'publish' | 'funds' | 'identity';

export const TOOL_RISKS: readonly ToolRisk[] = Object.freeze(['dangerous', 'safe']);
export const DANGEROUS_TOOL_CATEGORIES: readonly DangerousToolCategory[] = Object.freeze(['member', 'publish', 'funds', 'identity']);

export function isToolRisk(value: unknown): value is ToolRisk {
  return value === 'dangerous' || value === 'safe';
}
export function isDangerousToolCategory(value: unknown): value is DangerousToolCategory {
  return typeof value === 'string' && (DANGEROUS_TOOL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * 核心危险工具名单（按工具本地名匹配，即限定名最后一段；场景管理通用工具的 `{prefix}_{suffix}`
 * 按后缀匹配，见 {@link coreDangerousCategory}）。覆盖仓库内各 adapter 的管理类工具，
 * 以及资金类常见名；插件声明 `risk: 'safe'` 不能把它们调低。
 *
 * 改他人群名片属于成员管理（ADR 0037 §3）：`set_group_card`、以及场景管理通用工具
 * `{prefix}_set_nickname`（`setMemberNickname`，改的是成员的群名片）都记 `member`。
 * 改 Bot 自身资料的工具请用不同的本地名（如 `set_self_nickname` / `set_bot_nickname`），或声明 `riskCategory: 'identity'`。
 */
export const CORE_DANGEROUS_TOOLS: ReadonlyMap<string, DangerousToolCategory> = new Map<string, DangerousToolCategory>([
  // 成员管理：踢人、禁言、设管理员、角色、拉黑、拉人
  ...(['group_kick', 'kick', 'kick_member', 'set_group_kick', 'set_mute', 'mute', 'mute_member', 'set_group_ban',
    'set_group_whole_ban', 'unmute', 'ban', 'unban', 'blacklist', 'set_admin', 'set_group_admin', 'set_managers',
    'remove_managers', 'set_title', 'grant_role', 'revoke_role', 'add_role', 'remove_role', 'create_role', 'delete_role',
    'set_permissions', 'add_members', 'add_chat_members', 'group_invite', 'invite_to_channel', 'delete_friend',
    'dissolve_chat', 'archive_channel'] as const).map((name) => [name, 'member'] as const),
  // 成员管理：场景管理通用工具后缀（`packages/im/core/src/built/common-adapter-tools.ts`）
  ...(['remove_member', 'ban_member', 'unban_member', 'set_moderator', 'rename_scene', 'set_scene_muted'] as const)
    .map((name) => [name, 'member'] as const),
  // 成员管理：改他人群名片、群名、匿名开关
  ...(['set_group_card', 'set_nickname', 'set_group_name', 'set_anonymous', 'set_group_anonymous'] as const)
    .map((name) => [name, 'member'] as const),
  // 内容发布：群公告、频道发帖、精华、置顶、B 站评论
  ...(['send_group_notice', 'del_group_notice', 'announce', 'forum_post', 'set_essence_msg', 'delete_essence_msg',
    'essence', 'pin_message', 'unpin_message', 'bili_comment', 'bili_reply', 'post_comment', 'publish_post'] as const)
    .map((name) => [name, 'publish'] as const),
  // 资金：红包、转账、付款（默认禁用）
  ...(['send_red_packet', 'red_packet', 'send_hongbao', 'transfer', 'transfer_money', 'pay', 'payment',
    'send_payment'] as const).map((name) => [name, 'funds'] as const),
  // 身份：改 Bot 资料、头像、签名、昵称、解绑账号
  ...(['set_profile', 'set_avatar', 'set_signature', 'set_self_nickname', 'set_bot_nickname', 'set_online_status',
    'set_group_portrait', 'unbind'] as const).map((name) => [name, 'identity'] as const),
]);

/** IM 审批卡片投递方式：审批人私聊（默认），或显式配置的专用审批群（不能是业务会话）。 */
export type ToolHardGateImDelivery = 'dm' | 'approver_group';

/** `approverIds` 扁平列表在归一化后挂在这个键下，表示对所有平台生效。 */
export const IM_APPROVER_ANY_PLATFORM = '*';

/** 用户配置形态：`approverIds` 可以是扁平列表，也可以是 `platform → userIds`。 */
export interface ToolHardGateImApprovalConfig {
  readonly enabled?: boolean;
  readonly approverIds?: readonly string[] | Readonly<Record<string, readonly string[]>>;
  readonly delivery?: ToolHardGateImDelivery;
  readonly approverGroupId?: string | null;
}

/** 归一化后的 IM 审批通道设置。 */
export interface ToolHardGateImApprovalSettings {
  readonly enabled: boolean;
  /** `platform → userIds`；{@link IM_APPROVER_ANY_PLATFORM} 下的 id 对所有平台生效。 */
  readonly approverIds: Readonly<Record<string, readonly string[]>>;
  readonly delivery: ToolHardGateImDelivery;
  /** `delivery: approver_group` 时的群 id；缺省时 IM 通道不可投递（fail closed，仅 Console）。 */
  readonly approverGroupId: string | null;
}

export interface ToolHardGateSettings {
  /** 宿主额外标为 dangerous 的工具（本地名或限定名）；只能调高。 */
  readonly dangerousTools: readonly string[];
  /** 资金类危险工具是否可用；默认 false（直接拒绝），开启后仍需审批。 */
  readonly allowFunds: boolean;
  /** 审批等待上限（毫秒），超时即拒绝。 */
  readonly approvalTimeoutMs: number;
  /** IM 审批通道（G6，#1013）；默认关闭。 */
  readonly imApproval: ToolHardGateImApprovalSettings;
}

/** `ai.agent.toolHardGate` 的输入形态；已归一化的 {@link ToolHardGateSettings} 也可直接传入。 */
export type ToolHardGateConfig = Partial<Omit<ToolHardGateSettings, 'imApproval'>> & {
  readonly imApproval?: ToolHardGateImApprovalConfig;
};

export const DEFAULT_TOOL_HARD_GATE_IM_APPROVAL: ToolHardGateImApprovalSettings = Object.freeze({
  enabled: false,
  approverIds: Object.freeze({}) as Readonly<Record<string, readonly string[]>>,
  delivery: 'dm' as const,
  approverGroupId: null,
});

export const DEFAULT_TOOL_HARD_GATE: ToolHardGateSettings = Object.freeze({
  dangerousTools: Object.freeze([]) as readonly string[],
  allowFunds: false,
  approvalTimeoutMs: DEFAULT_TOOL_APPROVAL_TTL_MS,
  imApproval: DEFAULT_TOOL_HARD_GATE_IM_APPROVAL,
});

export function resolveToolHardGate(value?: ToolHardGateConfig | null): ToolHardGateSettings {
  const dangerousTools = Array.isArray(value?.dangerousTools)
    ? value!.dangerousTools.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map((name) => name.trim())
    : [];
  const timeout = value?.approvalTimeoutMs;
  return Object.freeze({
    dangerousTools: Object.freeze(dangerousTools),
    allowFunds: value?.allowFunds === true,
    approvalTimeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
      ? Math.trunc(timeout)
      : DEFAULT_TOOL_HARD_GATE.approvalTimeoutMs,
    imApproval: resolveToolHardGateImApproval(value?.imApproval),
  });
}

export function resolveToolHardGateImApproval(value?: ToolHardGateImApprovalConfig | null): ToolHardGateImApprovalSettings {
  if (!value || typeof value !== 'object') return DEFAULT_TOOL_HARD_GATE_IM_APPROVAL;
  const approverIds = normalizeApproverIds(value.approverIds);
  const groupId = typeof value.approverGroupId === 'string' ? value.approverGroupId.trim() : '';
  return Object.freeze({
    enabled: value.enabled === true,
    approverIds,
    delivery: value.delivery === 'approver_group' ? 'approver_group' : 'dm',
    approverGroupId: groupId || null,
  });
}

/** 某平台的 IM 审批人（平台专属 + 全平台），去重。 */
export function imApproversFor(settings: ToolHardGateImApprovalSettings, platform: string): readonly string[] {
  const platformApprovers = settings.approverIds[platform] ?? [];
  const anyPlatformApprovers = settings.approverIds[IM_APPROVER_ANY_PLATFORM] ?? [];
  return [...new Set([...platformApprovers, ...anyPlatformApprovers])];
}

/** IM 通道开启且发送者在该平台的 allowlist 里。 */
export function isImApprover(settings: ToolHardGateImApprovalSettings, platform: string, userId: string): boolean {
  if (!settings.enabled) return false;
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;
  return imApproversFor(settings, platform).includes(normalizedUserId);
}

/** IM 通道能否为该来源投递卡片：开启、有审批人、审批群模式下配置了群且不是业务会话本身。 */
export function isImApprovalDeliverable(settings: ToolHardGateImApprovalSettings, origin: ToolApprovalOrigin | null | undefined): boolean {
  if (!settings.enabled || !origin) return false;
  if (imApproversFor(settings, origin.platform).length === 0) return false;
  if (settings.delivery === 'approver_group') {
    if (!settings.approverGroupId) return false;
    if (origin.scope !== 'private' && origin.sceneId === settings.approverGroupId) return false;
  }
  return true;
}

function normalizeApproverIds(value: ToolHardGateImApprovalConfig['approverIds']): Readonly<Record<string, readonly string[]>> {
  const normalized: Record<string, readonly string[]> = {};
  if (Array.isArray(value)) {
    const ids = normalizeIdList(value);
    if (ids.length > 0) normalized[IM_APPROVER_ANY_PLATFORM] = ids;
    return Object.freeze(normalized);
  }
  if (!value || typeof value !== 'object') return Object.freeze(normalized);
  for (const [platform, ids] of Object.entries(value as Record<string, unknown>)) {
    const platformKey = platform.trim();
    if (!platformKey || !Array.isArray(ids)) continue;
    const list = normalizeIdList(ids);
    if (list.length > 0) normalized[platformKey] = list;
  }
  return Object.freeze(normalized);
}

function normalizeIdList(values: readonly unknown[]): readonly string[] {
  const ids = values
    .map((id) => (typeof id === 'number' && Number.isFinite(id) ? String(id) : id))
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  return Object.freeze([...new Set(ids)]);
}

/** 限定名（`owner__…__local` 或 `a.b`）的最后一段。 */
export function toolLocalName(name: string): string {
  const segments = name.split(/__|\./u).filter(Boolean);
  return segments[segments.length - 1] ?? name;
}

/** 后缀匹配至少取两段（如 `remove_member`），避免 `pay` / `ban` 这类单词误伤 `file_transfer` 之类的工具。 */
const MIN_SUFFIX_SEGMENTS = 2;

/**
 * 按本地名查核心名单：先整段精确匹配；再按 `_` 切段，从左往右去掉前缀，取最长的、至少两段的后缀匹配。
 * 这样场景管理通用工具 `discord_remove_member` / `lark_mute_member` 能命中 `remove_member` / `mute_member`。
 */
export function coreDangerousCategory(localName: string): DangerousToolCategory | null {
  const exact = CORE_DANGEROUS_TOOLS.get(localName);
  if (exact) return exact;
  const segments = localName.split('_');
  for (let start = 1; start <= segments.length - MIN_SUFFIX_SEGMENTS; start += 1) {
    const suffix = segments.slice(start).join('_');
    const category = CORE_DANGEROUS_TOOLS.get(suffix);
    if (category) return category;
  }
  return null;
}

export interface ToolRiskView {
  readonly name: string;
  readonly qualifiedName?: string;
  readonly risk?: ToolRisk;
  readonly riskCategory?: DangerousToolCategory;
}

export interface ToolRiskAssessment {
  readonly risk: ToolRisk;
  readonly category: DangerousToolCategory | null;
  /** 判为 dangerous 的来源；`safe` 时为 `declared` 或 `default`。 */
  readonly source: 'declared' | 'core' | 'host' | 'default';
}

/** 合并声明、核心名单与宿主配置：任何一方判 dangerous 即 dangerous，不能被调低。 */
export function assessToolRisk(tool: ToolRiskView, settings: ToolHardGateSettings = DEFAULT_TOOL_HARD_GATE): ToolRiskAssessment {
  const names = new Set([tool.name, tool.qualifiedName, toolLocalName(tool.name), tool.qualifiedName && toolLocalName(tool.qualifiedName)]
    .filter((name): name is string => Boolean(name)));
  const declaredCategory = isDangerousToolCategory(tool.riskCategory) ? tool.riskCategory : null;
  const coreCategory = [...names].map((name) => coreDangerousCategory(name)).find(Boolean) ?? null;
  if (coreCategory) return Object.freeze({ risk: 'dangerous', category: declaredCategory ?? coreCategory, source: 'core' });
  if (tool.risk === 'dangerous') return Object.freeze({ risk: 'dangerous', category: declaredCategory, source: 'declared' });
  if (settings.dangerousTools.some((name) => names.has(name))) {
    return Object.freeze({ risk: 'dangerous', category: declaredCategory, source: 'host' });
  }
  return Object.freeze({ risk: 'safe', category: null, source: tool.risk === 'safe' ? 'declared' : 'default' });
}

/** 审计写入口；与切片 B 的 `DecisionEventLog.record` 结构兼容。写失败不得抛给调用方。 */
export interface DecisionAuditSink {
  record(input: DecisionEventInput): unknown;
}

export interface ToolHardGateLocation {
  readonly instanceId: string;
  readonly platform: string;
  readonly sceneId: string;
  readonly userId?: string | null;
}

/**
 * 硬闸读取的控制面视图（`AiControlPlane` 结构兼容，#1008）。两个方法在状态不可用时都返回 true（fail closed）。
 */
export interface ToolHardGateControlView {
  isEmergencyStopped(platform?: string, sceneId?: string): boolean;
  isReadOnly(platform?: string, sceneId?: string): boolean;
}

export type ToolHardGateControlSource = () => ToolHardGateControlView | undefined;

export interface ToolHardGateContext {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly requesterId?: string;
  readonly conversationScope?: 'private' | 'group' | 'channel';
  readonly unattended: boolean;
  readonly approval?: ApprovalPort;
  readonly signal: AbortSignal;
  readonly location: ToolHardGateLocation;
  readonly audit?: DecisionAuditSink;
  readonly queue?: ToolApprovalQueue;
  /** 触发会话的原生定位；写进审批卡片，供 IM 审批通道选择 Endpoint、拒绝业务会话内结算。 */
  readonly origin?: ToolApprovalOrigin;
  /** 控制面；未接时不做控制面判定（与入站 / 出站闸一致）。每次判定现读，回合中途开关变化也生效。 */
  readonly controlPlane?: ToolHardGateControlSource;
}

type ControlDenial = Readonly<{
  reasonCode: Extract<DecisionReasonCode, 'control_emergency_stop' | 'control_read_only'>;
  controlSwitch: 'emergency_stop' | 'read_only';
  detail: string;
  why: string;
}>;

const CONTROL_EMERGENCY_STOP_DENIAL: ControlDenial = Object.freeze({
  reasonCode: 'control_emergency_stop',
  controlSwitch: 'emergency_stop',
  detail: 'control plane: emergency_stop',
  why: '控制面已急停',
});

const CONTROL_READ_ONLY_DENIAL: ControlDenial = Object.freeze({
  reasonCode: 'control_read_only',
  controlSwitch: 'read_only',
  detail: 'control plane: read_only',
  why: '控制面处于只读',
});

export type ToolHardGateResult =
  | Readonly<{ status: 'safe' }>
  | Readonly<{ status: 'approved'; category: DangerousToolCategory | null; approvalId?: string }>
  | Readonly<{ status: 'denied'; category: DangerousToolCategory | null; reasonCode: DecisionReasonCode; reason: string }>
  | Readonly<{ status: 'cancelled' }>;

/** `TurnToolOutcome.denied.policy`，便于日志 / 轨迹区分硬闸与普通审批。 */
export const TOOL_HARD_GATE_POLICY = 'tool-hard-gate';

/** 危险类别的中文标签（审批提示 / IM 审批卡片共用）。 */
export const DANGEROUS_TOOL_CATEGORY_LABELS: Readonly<Record<DangerousToolCategory, string>> = Object.freeze({
  member: '成员管理',
  publish: '内容发布',
  funds: '资金',
  identity: '身份',
});

/**
 * 一个回合一个实例：记住本回合已拒绝的工具与类别，后续调用直接 fail closed。
 */
export class ToolHardGate {
  readonly #settings: ToolHardGateSettings;
  readonly #context: ToolHardGateContext;
  readonly #deniedTools = new Set<string>();
  readonly #deniedCategories = new Set<DangerousToolCategory>();

  constructor(settings: ToolHardGateConfig | undefined, context: ToolHardGateContext) {
    this.#settings = resolveToolHardGate(settings);
    this.#context = context;
  }

  assess(tool: ToolRiskView): ToolRiskAssessment {
    return assessToolRisk(tool, this.#settings);
  }

  /**
   * 危险工具执行前调用。`safe` 直接放行；dangerous 必须拿到新鲜的人工批准或 Console 已批准的同参数卡片。
   */
  async check(
    tool: ToolRiskView,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
  ): Promise<ToolHardGateResult> {
    const assessment = this.assess(tool);
    const name = tool.name;
    if (assessment.risk !== 'dangerous') {
      // ADR 0036：只读 / safe 工具直接放行，但仍写一条 tool_call 审计。
      this.#audit('tool_call', 'allow', 'tool_safe_allowed', { tool: name, risk: 'safe', riskSource: assessment.source, toolUseId });
      return SAFE;
    }
    const { category } = assessment;
    const payload = { tool: name, category, riskSource: assessment.source, toolUseId };

    const controlDenial = this.#checkControlPlane();
    if (controlDenial) {
      const controlPayload = { ...payload, controlSwitch: controlDenial.controlSwitch };
      return this.#deny(name, category, controlDenial.reasonCode, controlPayload, controlDenial.detail, controlDenial.why);
    }

    if (this.#deniedTools.has(name) || (category && this.#deniedCategories.has(category))) {
      return this.#deny(name, category, 'tool_hard_gate_latched', payload,
        'repeat after a hard-gate denial in this turn',
        '本回合内已拒绝过同类危险操作');
    }
    if (category === 'funds' && !this.#settings.allowFunds) {
      return this.#deny(name, category, 'tool_funds_disabled', payload, 'funds tools are disabled (ai.agent.toolHardGate.allowFunds)',
        '资金类工具默认禁用');
    }

    const queue = this.#context.queue;
    const preApproved = queue?.consumeApproved(this.#context.sessionKey, name, input);
    if (preApproved) {
      const channel = preApproved.channel ?? 'console';
      const approved = { ...payload, approvalId: preApproved.id, via: channel, channel };
      this.#audit('tool_approval', 'allow', 'tool_approval_approved', approved, preApproved.decidedBy);
      this.#audit('tool_hard_gate', 'allow', 'tool_approval_approved', approved);
      return Object.freeze({ status: 'approved', category, approvalId: preApproved.id });
    }

    const entry = queue?.enqueue({
      toolName: name,
      category,
      sessionKey: this.#context.sessionKey,
      requesterId: this.#context.requesterId ?? null,
      turnId: this.#context.turnId,
      args: input,
      ttlMs: this.#settings.approvalTimeoutMs,
      ...(this.#context.origin ? { origin: this.#context.origin } : {}),
    });
    const imDeliverable = entry ? isImApprovalDeliverable(this.#settings.imApproval, entry.origin) : false;
    const requested = { ...payload, ...(entry ? { approvalId: entry.id, imApproval: imDeliverable } : {}) };
    this.#audit('tool_approval', 'defer', 'tool_approval_requested', requested);

    const port = this.#context.approval;
    if (this.#context.unattended || !isApprovalPortAvailable(port)) {
      return this.#deny(name, category, 'tool_dangerous_no_approval', { ...payload, ...(entry ? { approvalId: entry.id } : {}) },
        this.#context.unattended ? 'unattended turn' : 'no approval channel',
        entry ? pendingCardHint(imDeliverable) : '当前没有可用的人工审批渠道');
    }

    const settled = await this.#awaitApproval(port, name, category, input, toolUseId, entry);
    if (settled.kind === 'cancelled') return CANCELLED;
    const withId = {
      ...payload,
      ...(entry ? { approvalId: entry.id } : {}),
      via: settled.via,
      ...('channel' in settled ? { channel: settled.channel } : {}),
    };
    if (settled.kind === 'approved') {
      if (entry) queue?.markConsumed(entry.id);
      this.#audit('tool_approval', 'allow', 'tool_approval_approved', withId, settled.decidedBy);
      this.#audit('tool_hard_gate', 'allow', 'tool_approval_approved', withId);
      return Object.freeze({ status: 'approved', category, ...(entry ? { approvalId: entry.id } : {}) });
    }
    if (settled.kind === 'timed_out') {
      this.#audit('tool_approval', 'deny', 'tool_approval_timeout', withId);
      return this.#deny(name, category, 'tool_approval_timeout', withId, 'approval timed out', '审批超时，默认拒绝');
    }
    if (settled.kind === 'unavailable') {
      return this.#deny(name, category, 'tool_dangerous_no_approval', withId, settled.detail,
        entry ? `审批提示无法送达，${pendingCardHint(imDeliverable)}` : '当前没有可用的人工审批渠道');
    }
    this.#audit('tool_approval', 'deny', 'tool_approval_denied', withId, settled.decidedBy);
    return this.#deny(name, category, 'tool_approval_denied', withId, 'approval denied', '审批人拒绝了此操作');
  }

  /**
   * ADR 0036 §2：`emergency_stop` / `read_only` 下危险工具不弹审批、不执行。`muted` 不拦硬闸管理工具。
   * 读控制面本身出错按急停处理（fail closed）。
   */
  #checkControlPlane(): ControlDenial | null {
    const source = this.#context.controlPlane;
    if (!source) return null;
    const { platform, sceneId } = this.#context.location;
    try {
      const plane = source();
      if (!plane) return null;
      if (plane.isEmergencyStopped(platform, sceneId)) return CONTROL_EMERGENCY_STOP_DENIAL;
      if (plane.isReadOnly(platform, sceneId)) return CONTROL_READ_ONLY_DENIAL;
      return null;
    } catch {
      return CONTROL_EMERGENCY_STOP_DENIAL;
    }
  }

  async #awaitApproval(
    port: ApprovalPort,
    toolName: string,
    category: DangerousToolCategory | null,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
    entry: ToolApprovalEntry | undefined,
  ): Promise<
    | { kind: 'approved'; via: string; channel: ToolApprovalAuditChannel; decidedBy: string | null }
    | { kind: 'denied'; via: string; channel: ToolApprovalAuditChannel; decidedBy: string | null }
    | { kind: 'timed_out'; via: string }
    | { kind: 'unavailable'; via: string; detail: string }
    | { kind: 'cancelled' }
  > {
    const signal = this.#context.signal;
    if (signal.aborted) return { kind: 'cancelled' };
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const queue = this.#context.queue;
    const timeoutMs = this.#settings.approvalTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fromPort = requestApprovalOutcome(port, {
        humanOnly: true,
        requestId: entry?.id ?? `${this.#context.turnId}:${toolUseId}`,
        sessionKey: this.#context.sessionKey,
        ...(this.#context.conversationScope ? { conversationScope: this.#context.conversationScope } : {}),
        ...(this.#context.requesterId ? { requesterId: this.#context.requesterId } : {}),
        toolName,
        // Never matches a remembered grant: every dangerous call is confirmed on its own.
        scopeKey: `${TOOL_HARD_GATE_POLICY}:${this.#context.turnId}:${toolUseId}`,
        question: formatHardGateQuestion(toolName, category, input, entry),
        timeoutMs,
        signal: controller.signal,
      }).then(
        (outcome) => ({ source: 'port' as const, outcome }),
        () => ({ source: 'port' as const, outcome: { status: 'unavailable', reason: 'the approval prompt failed' } as ApprovalOutcome }),
      );
      const fromQueue = entry && queue
        ? queue.wait(entry.id, controller.signal).then((settlement) => ({ source: 'queue' as const, settlement }))
        : new Promise<never>(() => undefined);
      const fromTimer = new Promise<{ source: 'timer' }>((resolve) => {
        timer = setTimeout(() => resolve({ source: 'timer' }), timeoutMs);
        (timer as { unref?: () => void }).unref?.();
      });
      const cancelled = new Promise<{ source: 'cancelled' }>((resolve) => {
        if (signal.aborted) resolve({ source: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ source: 'cancelled' }), { once: true });
      });
      const first = await Promise.race([fromPort, fromQueue, fromTimer, cancelled]);
      if (first.source === 'cancelled' || signal.aborted) {
        if (entry) queue?.resolve(entry.id, false, 'turn_cancelled');
        return { kind: 'cancelled' };
      }
      if (first.source === 'timer') {
        if (entry) queue?.resolve(entry.id, false, 'timeout');
        return { kind: 'timed_out', via: 'timeout' };
      }
      if (first.source === 'queue') {
        const settledEntry = entry ? queue?.get(entry.id) : undefined;
        const decided = settledEntry?.decidedBy ?? null;
        const channel: ToolApprovalChannel = settledEntry?.channel ?? 'console';
        if (first.settlement === 'approved') return { kind: 'approved', via: channel, channel, decidedBy: decided };
        if (first.settlement === 'expired') return { kind: 'timed_out', via: channel };
        return { kind: 'denied', via: channel, channel, decidedBy: decided };
      }
      const outcome = first.outcome;
      switch (outcome.status) {
        case 'approved':
          if (entry) queue?.resolve(entry.id, true, 'approval_port');
          return { kind: 'approved', via: 'approval_port', channel: TURN_PROMPT_CHANNEL, decidedBy: null };
        case 'timed_out':
          if (entry) queue?.resolve(entry.id, false, 'timeout');
          return { kind: 'timed_out', via: 'approval_port' };
        case 'unavailable':
          // Nobody can be asked here: keep the card pending for the Console and fail closed now.
          return { kind: 'unavailable', via: 'approval_port', detail: outcome.reason };
        default:
          if (entry) queue?.resolve(entry.id, false, 'approval_port');
          return { kind: 'denied', via: 'approval_port', channel: TURN_PROMPT_CHANNEL, decidedBy: null };
      }
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  #deny(
    toolName: string,
    category: DangerousToolCategory | null,
    reasonCode: DecisionReasonCode,
    payload: Record<string, unknown>,
    detail: string,
    why: string,
  ): ToolHardGateResult {
    this.#deniedTools.add(toolName);
    if (category) this.#deniedCategories.add(category);
    this.#audit('tool_hard_gate', 'deny', reasonCode, payload, null, detail);
    return Object.freeze({ status: 'denied', category, reasonCode, reason: formatHardGateDenial(toolName, why) });
  }

  #audit(
    kind: 'tool_call' | 'tool_approval' | 'tool_hard_gate',
    outcome: 'allow' | 'deny' | 'defer',
    reasonCode: DecisionReasonCode,
    payload: Record<string, unknown>,
    decidedBy?: string | null,
    detail?: string,
  ): void {
    const sink = this.#context.audit;
    if (!sink) return;
    const location = this.#context.location;
    const operator = decidedBy && !['approval_port', 'timeout', 'turn_cancelled'].includes(decidedBy) ? decidedBy : null;
    try {
      const result = sink.record({
        turnId: this.#context.turnId,
        instanceId: location.instanceId,
        platform: location.platform,
        sceneId: location.sceneId,
        userId: location.userId ?? null,
        kind,
        outcome,
        reasonCode,
        ...(detail ? { reasonDetail: detail } : {}),
        payload,
        // 硬闸判定与发起审批是策略；审批端口 / 超时的结论记 system；Console 结论记 operator。
        actor: operator ? 'operator' : kind !== 'tool_approval' || outcome === 'defer' ? 'policy' : 'system',
        ...(operator ? { actorId: operator } : {}),
      });
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
    } catch {
      // 审计不是门禁：写失败不影响硬闸判定。
    }
  }
}

/** 审计 `channel`：人工结算渠道，或回合内审批提示（`turn_prompt`，#1006 既有行为）。 */
export type ToolApprovalAuditChannel = ToolApprovalChannel | 'turn_prompt';

const TURN_PROMPT_CHANNEL: ToolApprovalAuditChannel = 'turn_prompt';

function pendingCardHint(imDeliverable: boolean): string {
  return imDeliverable
    ? '已生成审批卡片，需审批人在 Console 或 IM 审批通道批准'
    : '已生成审批卡片，需管理员在 Console 批准';
}

const SAFE: ToolHardGateResult = Object.freeze({ status: 'safe' });
const CANCELLED: ToolHardGateResult = Object.freeze({ status: 'cancelled' });

/** 给模型的拒绝说明：只说明已拒绝、需人工审批，明确不要重试 / 改参数 / 换工具。 */
export function formatHardGateDenial(toolName: string, why: string): string {
  return `危险工具「${toolName}」已被硬闸拒绝（${why}），本次调用没有执行。`
    + '不要重试这个调用，也不要改参数或换其他工具达成同样的操作；'
    + '请直接告诉用户：该操作需要管理员人工审批后才能执行。';
}

export function formatHardGateQuestion(
  toolName: string,
  category: DangerousToolCategory | null,
  input: Readonly<Record<string, unknown>>,
  entry?: ToolApprovalEntry,
): string {
  return [
    `工具「${toolName}」是危险操作${category ? `（${DANGEROUS_TOOL_CATEGORY_LABELS[category]}）` : ''}，需要人工审批后才会执行。`,
    `本次参数：${stableJson(input)}`,
    entry ? `审批卡片：${entry.id}（也可在 Console 处理）` : undefined,
    '超时未批准将自动拒绝。是否执行？',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  if (typeof value === 'undefined') return 'undefined';
  try { return JSON.stringify(value); } catch { return String(value); }
}
