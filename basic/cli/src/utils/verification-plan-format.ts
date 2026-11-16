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

export function formatVerificationPlan(plan: VerificationPlanView, options: { readonly live?: string } = {}): string[] {
  const lines = [
    `插件实例 ${plan.instanceKey}（包 ${plan.packageName}）的验证计划${options.live ? `（来自运行中的 Host ${options.live}）` : '（离线）'}`,
    `项目 revision: ${plan.projectRevision}`,
  ];
  if (plan.generation !== null) lines.push(`当前 generation: ${plan.generation}`);
  else if (options.live) lines.push('当前 generation: 无 —— 运行中的实例还没有发布 generation（实例仍在启动，或这个插件没有加载）；稍后用 zhin packages status 确认');
  else lines.push('当前 generation: 无 —— 离线查询不连接运行中的实例，这不表示插件没有加载；加 --live <host-url> 读取当前 generation');
  lines.push('');
  if (plan.checks.length === 0) {
    lines.push(options.live
      ? '业务检查: 无 —— 这个插件没有声明业务检查（插件在 definePlugin 的 setup 中返回 verification 才会提供检查）。查询本身成功，这也不影响插件运行。'
      : '业务检查: 离线时不列出 —— 业务检查由运行中的插件提供；加 --live <host-url> 查看可执行的检查。');
    return lines;
  }
  lines.push(`业务检查（${plan.checks.length}）:`);
  for (const check of plan.checks) {
    lines.push(`  - ${check.id}  ${check.titleI18n?.['zh-CN'] ?? check.title}  [${SCOPE_LABELS[check.scope] ?? check.scope}]`);
    const effects = check.effectsI18n?.['zh-CN'] ?? check.effects;
    lines.push(...(effects.length > 0 ? effects.map(effect => `      副作用: ${effect}`) : ['      副作用: 无']));
  }
  lines.push('', `检查 revision: ${plan.checkRevision}`);
  if (options.live && plan.generation !== null) {
    lines.push(
      '确认副作用后执行:',
      `  zhin packages verify ${plan.instanceKey} <check-id> --live ${options.live} --generation ${plan.generation} --project-revision ${plan.projectRevision} --check-revision ${plan.checkRevision}`,
    );
  }
  return lines;
}
