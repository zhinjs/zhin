import {
  definePage,
  definePageBlueprint,
  type ConsolePageBlueprint,
  type DeclarativePageComponentProps,
} from '@zhin.js/page';

export type { ConsolePageBlueprint, DeclarativePageComponentProps };

export interface FullBotWorkroomRunRow {
  readonly runId: string;
  readonly projectId: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly [key: string]: string;
}

export interface FullBotWorkroomStatus {
  readonly plugin: 'full-bot';
  readonly activeRuns: number;
  readonly pendingTasks: number;
  readonly journalMode: string;
  readonly runs: readonly FullBotWorkroomRunRow[];
  readonly updatedAt: string;
  readonly [key: string]:
    | string
    | number
    | readonly FullBotWorkroomRunRow[];
}

export const meta = definePage({
  title: 'Orchestration',
  titleI18n: { 'zh-CN': 'Workroom 编排', en: 'Orchestration' },
  icon: 'Workflow',
  order: 30,
});

const FullBotWorkroomPage = definePageBlueprint<FullBotWorkroomStatus>({
  title: { zh: 'Workroom 编排运行态', en: 'Workroom Orchestration' },
  description: {
    zh: '只读查看 Project-scoped Workroom Run、Task 与 Assignment 协作状态（ADR 0048 Engagement Journal）',
    en: 'Read-only view of project-scoped Workroom runs, tasks, and assignment journal state.',
  },
  statusMethod: 'workroom-summary',
  stats: [
    {
      key: 'activeRuns',
      label: { zh: '活跃 Run 数', en: 'Active Runs' },
      value: 'activeRuns',
    },
    {
      key: 'pendingTasks',
      label: { zh: '待处理任务', en: 'Pending Tasks' },
      value: 'pendingTasks',
    },
    {
      key: 'journalMode',
      label: { zh: '日志存储模式', en: 'Journal Mode' },
      value: 'journalMode',
    },
  ],
  actions: [
    {
      name: 'refresh-workroom',
      label: { zh: '刷新编排快照', en: 'Refresh Workroom' },
      description: {
        zh: '同步当前 Workroom Engagement Journal 状态摘要',
        en: 'Synchronize current Workroom Engagement Journal summary',
      },
    },
  ],
  sections: [
    {
      id: 'runs',
      title: { zh: 'Workroom 运行记录', en: 'Workroom Runs' },
      emptyText: { zh: '当前无活跃 Workroom Run', en: 'No active Workroom runs' },
      items: 'runs',
      columns: [
        { key: 'runId', label: { zh: 'Run ID', en: 'Run ID' } },
        { key: 'projectId', label: { zh: '项目 ID', en: 'Project ID' } },
        { key: 'status', label: { zh: '状态', en: 'Status' } },
        { key: 'updatedAt', label: { zh: '更新时间', en: 'Updated At' } },
      ] satisfies readonly {
        readonly key: keyof FullBotWorkroomRunRow & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});

export const blueprint: ConsolePageBlueprint<FullBotWorkroomStatus> = FullBotWorkroomPage();

export default FullBotWorkroomPage;
