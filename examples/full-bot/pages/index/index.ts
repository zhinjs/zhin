import { definePage } from '@zhin.js/console-contract';
import {
  createDeclarativePage,
  type DeclarativePageComponentProps,
} from '@zhin.js/client';
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

export interface ConsolePageBlueprint {
  readonly kind: 'zhin.console.page-blueprint';
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly dataSource: {
    readonly action: 'status';
  };
  readonly sections: readonly (
    | {
        readonly type: 'stats';
        readonly id: string;
        readonly title: string;
        readonly items: readonly { readonly key: string; readonly label: string }[];
      }
    | {
        readonly type: 'table';
        readonly id: string;
        readonly title: string;
        readonly dataKey: string;
        readonly rowKey: string;
        readonly columns: readonly { readonly key: string; readonly label: string }[];
      }
    | {
        readonly type: 'actions';
        readonly id: string;
        readonly title: string;
        readonly items: readonly { readonly label: string; readonly action: string }[];
      }
  )[];
}

export const meta = definePage({
  title: 'Full Bot (L4)',
  titleI18n: { 'zh-CN': 'Full Bot 概览', en: 'Full Bot (L4)' },
  icon: 'Bot',
  order: 10,
});

export const blueprint: ConsolePageBlueprint = Object.freeze({
  kind: 'zhin.console.page-blueprint',
  version: 1,
  title: 'Full Bot (L4 Reference)',
  description: 'L4 Reference runtime overview: adapters, skills/tools, memory, and orchestration.',
  dataSource: {
    action: 'status',
  },
  sections: [
    {
      type: 'stats',
      id: 'runtime-stats',
      title: 'Runtime Stats',
      items: [
        { key: 'tier', label: 'Tier' },
        { key: 'rssMb', label: 'RSS (MB)' },
        { key: 'heapMb', label: 'Heap Used (MB)' },
        { key: 'uptimeSec', label: 'Uptime (s)' },
      ],
    },
    {
      type: 'table',
      id: 'adapters',
      title: 'Adapters',
      dataKey: 'adapters',
      rowKey: 'instance',
      columns: [
        { key: 'instance', label: 'Instance' },
        { key: 'package', label: 'Package' },
        { key: 'mode', label: 'Mode' },
      ],
    },
    {
      type: 'table',
      id: 'capabilities',
      title: 'Capabilities',
      dataKey: 'capabilities',
      rowKey: 'name',
      columns: [
        { key: 'name', label: 'Capability' },
        { key: 'kind', label: 'Kind' },
        { key: 'entry', label: 'Entry' },
      ],
    },
    {
      type: 'actions',
      id: 'actions',
      title: 'Actions',
      items: [
        { label: 'Refresh Status', action: 'status' },
        { label: 'Ping Runtime', action: 'ping' },
      ],
    },
  ],
} as const);

const DeclarativeOverviewPage = createDeclarativePage<FullBotConsoleStatus>({
  title: { zh: 'Full Bot (L4 参考)', en: 'Full Bot (L4 Reference)' },
  description: {
    zh: 'L4 全维度参考运行态概览：三适配器、Skill/Tool、语义记忆与编排监控',
    en: 'L4 reference runtime overview: adapters, skills/tools, semantic memory, and orchestration',
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

const FullBotOverviewPage = Object.assign(
  function FullBotOverviewPage(props?: DeclarativePageComponentProps) {
    if (props === undefined) {
      return blueprint;
    }
    try {
      return (DeclarativeOverviewPage as (input: DeclarativePageComponentProps) => unknown)(props);
    } catch {
      return blueprint;
    }
  },
  blueprint,
);

export default FullBotOverviewPage;
