/**
 * Readable `zhin packages verification-plan` (#1250 `verification-plan-empty-unexplained`): an empty
 * check list and a null generation are explained instead of printed as bare `[]` / `null`. `--json`
 * keeps the raw structure.
 */

type LocalizedText = Readonly<Partial<Record<string, string>>>;

/** The fields of `PluginVerificationPlan` (`@zhin.js/host-http`) this formatter reads. */
export interface VerificationPlanView {
  readonly packageName: string;
  readonly instanceKey: string;
  readonly generation: number | null;
  readonly projectRevision: string;
  readonly checkRevision: string;
  readonly checks: readonly {
    readonly id: string;
    readonly title: string;
    readonly titleI18n?: LocalizedText;
    readonly effects: readonly string[];
    readonly effectsI18n?: Readonly<Partial<Record<string, readonly string[]>>>;
    readonly scope: 'local' | 'platform';
  }[];
}

const SCOPE_LABELS = { local: '本地', platform: '平台' } as const;

export interface FormatVerificationPlanOptions {
  /** The plan came from this Host (`--live`). */
  readonly live?: string;
  /** The plan came from the running instance through this project's gateway (#1250 第 39 批). */
  readonly viaGateway?: boolean;
  /** Offline: why no running instance answered. */
  readonly unavailable?: string;
}

export function formatVerificationPlan(plan: VerificationPlanView, options: FormatVerificationPlanOptions = {}): string[] {
  const online = Boolean(options.live) || options.viaGateway === true;
  const source = options.live ? `（来自运行中的 Host ${options.live}）` : options.viaGateway ? '（经本项目网关读取运行中的实例）' : '（离线）';
  const lines = [
    `插件实例 ${plan.instanceKey}（包 ${plan.packageName}）的验证计划${source}`,
    `项目 revision: ${plan.projectRevision}`,
  ];
  if (!online && options.unavailable) lines.push(`没有连上运行中的实例：${options.unavailable}`);
  if (plan.generation !== null) lines.push(`当前 generation: ${plan.generation}`);
  else if (online) lines.push('当前 generation: 无 —— 运行中的实例还没有发布 generation（实例仍在启动，或这个插件没有加载）；稍后用 zhin packages status 确认');
  else lines.push('当前 generation: 无 —— 离线查询不连接运行中的实例，这不表示插件没有加载；启动网关（zhin start）后重新查询，或加 --live <host-url> 读取当前 generation');
  lines.push('');
  if (plan.checks.length === 0) {
    lines.push(online
      ? '业务检查: 无 —— 这个插件没有声明业务检查（插件在 definePlugin 的 setup 中返回 verification 才会提供检查）。查询本身成功，这也不影响插件运行。'
      : '业务检查: 离线时不列出 —— 业务检查由运行中的插件提供；启动网关后重新查询，或加 --live <host-url> 查看可执行的检查。');
    return lines;
  }
  lines.push(`业务检查（${plan.checks.length}）:`);
  for (const check of plan.checks) {
    lines.push(`  - ${check.id}  ${check.titleI18n?.['zh-CN'] ?? check.title}  [${SCOPE_LABELS[check.scope] ?? check.scope}]`);
    const effects = check.effectsI18n?.['zh-CN'] ?? check.effects;
    lines.push(...(effects.length > 0 ? effects.map(effect => `      副作用: ${effect}`) : ['      副作用: 无']));
  }
  lines.push('', `检查 revision: ${plan.checkRevision}`);
  if (online && plan.generation !== null) {
    lines.push(
      '确认副作用后执行:',
      `  zhin packages verify ${plan.instanceKey} <check-id>${options.live ? ` --live ${options.live}` : ''} --generation ${plan.generation} --project-revision ${plan.projectRevision} --check-revision ${plan.checkRevision}`,
    );
  }
  return lines;
}
