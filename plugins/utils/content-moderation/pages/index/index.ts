import { definePage, createDeclarativePage } from '@zhin.js/console-contract';
import type {
  ModerationConsoleStatus,
  ModerationProviderStatusRow,
} from '../../src/console.js';

export const meta = definePage({
  title: '内容审核',
  titleI18n: { en: 'Content Moderation' },
  icon: 'ShieldAlert',
  order: 55,
  requiredPermissions: ['content-moderation:read'],
});

export default createDeclarativePage<ModerationConsoleStatus>({
  title: { zh: '内容审核', en: 'Content Moderation' },
  description: {
    zh: '多源内容安全扫描引擎状态、提供方列表与在线干跑检测',
    en: 'Multi-source content moderation engine status, providers, and dry-run check',
  },
  stats: [
    {
      key: 'enabled',
      label: { zh: '引擎状态', en: 'Engine Status' },
      value: {
        $map: {
          path: 'enabled',
          cases: {
            true: { zh: '已启用', en: 'Enabled' },
            false: { zh: '已禁用', en: 'Disabled' },
          },
          default: { zh: '已禁用', en: 'Disabled' },
        },
      },
    },
    {
      key: 'sensitivity',
      label: { zh: '敏感度等级', en: 'Sensitivity' },
      value: 'sensitivity',
    },
    {
      key: 'providersCount',
      label: { zh: '审核源数量', en: 'Providers' },
      value: 'providersCount',
    },
    {
      key: 'whitelistCount',
      label: { zh: '白名单条目', en: 'Whitelist Entries' },
      value: 'whitelistCount',
    },
    {
      key: 'pendingReviewsCount',
      label: { zh: '待审群消息', en: 'Pending Reviews' },
      value: 'pendingReviewsCount',
    },
  ],
  actions: [
    {
      name: 'check-text',
      label: { zh: '检测文本', en: 'Check Text' },
      description: {
        zh: '执行一次不产生副作用的策略干跑检测',
        en: 'Run a dry-run moderation check against active rules',
      },
      fields: [
        {
          key: 'text',
          label: { zh: '测试文本', en: 'Sample text' },
          required: true,
        },
      ],
      // The verdict sits right under the input, localized, with what would actually happen.
      result: {
        title: { $i18n: 'decisionI18n' },
        tone: {
          $map: { path: 'decision', cases: { allow: 'success', flag: 'warning', block: 'danger' }, default: 'neutral' },
        },
        entries: [
          { label: { zh: '严重度', en: 'Severity' }, value: { $i18n: 'severityI18n' } },
          { label: { zh: '命中词', en: 'Matched text' }, value: { $path: 'hitsText', fallback: '—' } },
          { label: { zh: '审核源', en: 'Sources' }, value: { $path: 'sourcesText', fallback: '—' } },
          {
            label: { zh: '按当前 actions 配置将执行', en: 'Actions under the current config' },
            value: { $i18n: 'actionsI18n' },
          },
        ],
      },
    },
  ],
  sections: [
    {
      id: 'overview',
      title: { zh: '配置概览', en: 'Configuration Overview' },
      entries: [
        {
          label: { zh: '已启用', en: 'Enabled' },
          value: {
            $map: {
              path: 'enabled',
              cases: { true: { zh: '是', en: 'Yes' }, false: { zh: '否', en: 'No' } },
              default: { zh: '否', en: 'No' },
            },
          },
        },
        { label: { zh: '敏感度等级', en: 'Sensitivity' }, dataKey: 'sensitivity' },
        { label: { zh: '审核源数量', en: 'Providers' }, dataKey: 'providersCount' },
        { label: { zh: '白名单条目', en: 'Whitelist entries' }, dataKey: 'whitelistCount' },
        { label: { zh: '待审群消息', en: 'Pending reviews' }, dataKey: 'pendingReviewsCount' },
      ],
    },
    {
      id: 'providers',
      title: { zh: '审核提供方', en: 'Moderation Providers' },
      emptyText: { zh: '未配置额外审核源', en: 'No moderation providers configured' },
      items: 'providers',
      columns: [
        { key: 'id', label: { zh: '源 ID', en: 'Source ID' } },
        { key: 'type', label: { zh: '类型', en: 'Type' } },
        { key: 'enabled', label: { zh: '启用', en: 'Enabled' } },
        { key: 'onError', label: { zh: '故障策略', en: 'On Error' } },
      ] satisfies readonly { key: keyof ModerationProviderStatusRow & string; label: { zh: string; en: string } }[],
    },
  ],
});
