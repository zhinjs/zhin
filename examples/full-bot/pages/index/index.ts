import {
  createDeclarativePage,
  definePage,
  type ConsolePageBlueprint,
  type DeclarativePageComponentProps,
} from '@zhin.js/console-contract';

export type { ConsolePageBlueprint, DeclarativePageComponentProps };

export interface FullBotAdapterRow {
  readonly instance: string;
  readonly package: string;
  readonly mode: string;
  readonly [key: string]: string;
}

export interface FullBotCapabilityRow {
  readonly name: string;
  readonly kind: string;
  readonly entry: string;
  readonly [key: string]: string;
}

export interface FullBotConsoleStatus {
  readonly plugin: 'full-bot';
  readonly tier: 'L4 Reference';
  readonly nodeVersion: string;
  readonly rssMb: number;
  readonly heapMb: number;
  readonly uptimeSec: number;
  readonly adapters: readonly FullBotAdapterRow[];
  readonly capabilities: readonly FullBotCapabilityRow[];
  readonly updatedAt: string;
  readonly [key: string]:
    | string
    | number
    | readonly FullBotAdapterRow[]
    | readonly FullBotCapabilityRow[];
}

export const meta = definePage({
  title: 'Full Bot (L4)',
  titleI18n: { 'zh-CN': 'Full Bot 概览', en: 'Full Bot (L4)' },
  icon: 'Bot',
  order: 10,
});

const FullBotOverviewPage = createDeclarativePage<FullBotConsoleStatus>({
  title: { zh: 'Full Bot (L4 参考)', en: 'Full Bot (L4 Reference)' },
  description: {
    zh: 'L4 全维度参考运行态概览：三适配器、Skill/Tool、语义记忆与编排监控',
    en: 'L4 Reference runtime overview: adapters, skills/tools, memory, and orchestration.',
  },
  stats: [
    {
      key: 'tier',
      label: { zh: '运行分档', en: 'Tier' },
      value: 'tier',
    },
    {
      key: 'rssMb',
      label: { zh: 'RSS 内存 (MB)', en: 'RSS (MB)' },
      value: 'rssMb',
    },
    {
      key: 'heapMb',
      label: { zh: '堆内存 (MB)', en: 'Heap Used (MB)' },
      value: 'heapMb',
    },
    {
      key: 'uptimeSec',
      label: { zh: '运行时长 (s)', en: 'Uptime (s)' },
      value: 'uptimeSec',
    },
  ],
  actions: [
    {
      name: 'ping',
      label: { zh: '探测运行态 (Ping)', en: 'Ping Runtime' },
      description: {
        zh: '向 full-bot L4 插件发送轻量健康探测',
        en: 'Send a lightweight health ping to the full-bot L4 plugin',
      },
    },
  ],
  sections: [
    {
      id: 'adapters',
      title: { zh: '已配置适配器', en: 'Configured Adapters' },
      emptyText: { zh: '未配置适配器', en: 'No adapters configured' },
      items: 'adapters',
      columns: [
        { key: 'instance', label: { zh: '实例名', en: 'Instance' } },
        { key: 'package', label: { zh: '适配器包', en: 'Package' } },
        { key: 'mode', label: { zh: '连接模式', en: 'Mode' } },
      ] satisfies readonly {
        readonly key: keyof FullBotAdapterRow & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
    {
      id: 'capabilities',
      title: { zh: '声明式能力清单', en: 'Declared Capabilities' },
      emptyText: { zh: '暂无声明能力', en: 'No capabilities declared' },
      items: 'capabilities',
      columns: [
        { key: 'name', label: { zh: '能力名称', en: 'Capability' } },
        { key: 'kind', label: { zh: '类型', en: 'Kind' } },
        { key: 'entry', label: { zh: '入口路径', en: 'Entry' } },
      ] satisfies readonly {
        readonly key: keyof FullBotCapabilityRow & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});

export const blueprint: ConsolePageBlueprint<FullBotConsoleStatus> = FullBotOverviewPage();

export default FullBotOverviewPage;
