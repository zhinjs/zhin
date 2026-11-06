import {
  definePage,
  definePageBlueprint,
  type ConsolePageBlueprint,
  type DeclarativePageComponentProps,
} from '@zhin.js/page';

export type { ConsolePageBlueprint, DeclarativePageComponentProps };

export interface FullBotTraceTurnRow {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly status: string;
  readonly tokens: number;
  readonly updatedAt: string;
  readonly [key: string]: string | number;
}

export interface FullBotTraceStatus {
  readonly plugin: 'full-bot';
  readonly retentionDays: number;
  readonly maxArchiveMb: number;
  readonly recentTurns: number;
  readonly turns: readonly FullBotTraceTurnRow[];
  readonly updatedAt: string;
  readonly [key: string]:
    | string
    | number
    | readonly FullBotTraceTurnRow[];
}

export const meta = definePage({
  title: 'Agent Trace',
  titleI18n: { 'zh-CN': 'Agent 轨迹归档', en: 'Agent Trace' },
  icon: 'Activity',
  order: 31,
});

const FullBotAgentTracePage = definePageBlueprint<FullBotTraceStatus>({
  title: { zh: 'Agent 回合轨迹归档', en: 'Agent Turn Trace Archive' },
  description: {
    zh: '查看脱敏后的 Agent 回合轨迹、工具调用瀑布与 Token 预算开销',
    en: 'Inspect redacted agent turn traces, tool execution waterfall, and token budget usage.',
  },
  statusMethod: 'trace-summary',
  stats: [
    {
      key: 'recentTurns',
      label: { zh: '最近回合数', en: 'Recent Turns' },
      value: 'recentTurns',
    },
    {
      key: 'retentionDays',
      label: { zh: '保留天数', en: 'Retention (Days)' },
      value: 'retentionDays',
    },
    {
      key: 'maxArchiveMb',
      label: { zh: '归档上限 (MB)', en: 'Max Archive (MB)' },
      value: 'maxArchiveMb',
    },
  ],
  actions: [
    {
      name: 'refresh-traces',
      label: { zh: '刷新轨迹摘要', en: 'Refresh Trace Summary' },
      description: {
        zh: '重新读取最近脱敏回合轨迹统计',
        en: 'Reload recent redacted agent turn trace statistics',
      },
    },
  ],
  sections: [
    {
      id: 'turns',
      title: { zh: '最近回合轨迹', en: 'Recent Turn Traces' },
      emptyText: { zh: '暂无回合轨迹记录', en: 'No turn traces recorded yet' },
      items: 'turns',
      columns: [
        { key: 'turnId', label: { zh: '回合 ID', en: 'Turn ID' } },
        { key: 'sessionKey', label: { zh: '会话标识', en: 'Session' } },
        { key: 'status', label: { zh: '状态', en: 'Status' } },
        { key: 'tokens', label: { zh: 'Token 数', en: 'Tokens' } },
        { key: 'updatedAt', label: { zh: '记录时间', en: 'Recorded At' } },
      ] satisfies readonly {
        readonly key: keyof FullBotTraceTurnRow & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});

export const blueprint: ConsolePageBlueprint<FullBotTraceStatus> = FullBotAgentTracePage();

export default FullBotAgentTracePage;
