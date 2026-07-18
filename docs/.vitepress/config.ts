import { defineConfig, type DefaultTheme } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid'

/** 可折叠侧栏分组（默认折叠；含当前页的分组由 VitePress 自动展开） */
function sidebarGroup(
  text: string,
  items: DefaultTheme.SidebarItem[],
  collapsed = true,
): DefaultTheme.SidebarItem {
  return { text, items, collapsed }
}

const aiSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'AI 模块', link: '/advanced/ai' },
  { text: 'Agent 概念入门', link: '/advanced/agent-concepts' },
  { text: 'MCP 集成', link: '/advanced/mcp' },
  { text: '工具与技能', link: '/advanced/tools-skills' },
  { text: 'Plugin agent/ 创作面', link: '/advanced/agent-authoring' },
  { text: 'Eve 对照（维护者）', link: '/advanced/eve-comparison-zh' },
  { text: 'Feature 系统', link: '/advanced/features' },
  { text: 'Agent 安全与角色', link: '/advanced/agent-harness-engineering' },
  { text: 'Agent 最佳实践', link: '/advanced/agent-best-practices' },
  { text: 'Agent Mesh', link: '/advanced/agent-mesh' },
  { text: '五角色群协作（高级）', link: '/advanced/five-agent-recipe' },
  { text: 'Assistant Home', link: '/advanced/assistant-home' },
  { text: 'Assistant Profile', link: '/advanced/assistant-profile' },
  { text: 'pi coding-agent 映射', link: '/advanced/pi-coding-agent-mapping' },
]

const advancedInfraSidebar: DefaultTheme.SidebarItem[] = [
  { text: '组件系统', link: '/advanced/components' },
  { text: '定时任务（兼容）', link: '/advanced/cron' },
  { text: 'Schedule 设施', link: '/advanced/schedule' },
  { text: '数据库', link: '/advanced/database' },
  { text: '热重载', link: '/advanced/hot-reload' },
  { text: 'AI 内容链', link: '/advanced/ai-content-chain' },
  { text: '内容审查 hook', link: '/advanced/content-moderation' },
]

const advancedSidebar: DefaultTheme.SidebarItem[] = [
  { text: '概述', link: '/advanced/' },
  sidebarGroup('AI 模块', aiSidebar),
  sidebarGroup('框架进阶', advancedInfraSidebar),
]

const adapterSidebar: DefaultTheme.SidebarItem[] = [
  { text: '概览', link: '/adapters/' },
  { text: '适配器（框架概念）', link: '/essentials/adapters' },
  sidebarGroup('Stable', [{ text: 'Sandbox', link: '/adapters/sandbox' }]),
  sidebarGroup('Advanced', [
      { text: 'ICQQ (QQ)', link: '/adapters/icqq' },
      { text: 'QQ 官方', link: '/adapters/qq' },
      { text: 'OneBot v11', link: '/adapters/onebot11' },
      { text: 'KOOK', link: '/adapters/kook' },
      { text: 'Discord', link: '/adapters/discord' },
      { text: 'Telegram', link: '/adapters/telegram' },
      { text: 'Slack', link: '/adapters/slack' },
      { text: '钉钉', link: '/adapters/dingtalk' },
      { text: '飞书', link: '/adapters/lark' },
      { text: '微信公众号', link: '/adapters/wechat-mp' },
      { text: '微信 iLink', link: '/adapters/weixin-ilink' },
      { text: '企业微信', link: '/adapters/wecom' },
      { text: 'LINE', link: '/adapters/line' },
  ]),
  sidebarGroup('Experimental', [
      { text: 'NapCat', link: '/adapters/napcat' },
      { text: 'OneBot v12', link: '/adapters/onebot12' },
      { text: 'Milky', link: '/adapters/milky' },
      { text: 'Satori', link: '/adapters/satori' },
      { text: 'Email', link: '/adapters/email' },
      { text: 'GitHub', link: '/adapters/github' },
  ]),
]

const adrSidebar0001: DefaultTheme.SidebarItem[] = [
  { text: '索引', link: '/adr/' },
  { text: '0001 多上下文领域文档', link: '/adr/0001-use-multi-context-domain-docs' },
  { text: '0002 集中 IM 入站路由', link: '/adr/0002-centralize-im-inbound-routing' },
  { text: '0003 Agent 工具与上下文预算', link: '/adr/0003-centralize-agent-tool-selection-and-context-budget' },
  { text: '0004 队列出站字段规范化', link: '/adr/0004-normalize-queue-outbound-fields-before-im-send' },
  { text: '0005 Console EntryStore', link: '/adr/0005-use-instance-scoped-console-entry-stores' },
  { text: '0006 约定优先默认值', link: '/adr/0006-use-convention-first-config-defaults' },
  { text: '0007 modelHarness YAML', link: '/adr/0007-ai-agent-model-harness-yaml-overrides' },
  { text: '0008 Assistant Runtime', link: '/adr/0008-introduce-assistant-runtime' },
  { text: '0009 pi AI/Agent 核心', link: '/adr/0009-pi-aligned-ai-agent-core' },
  { text: '0010 pi Harness 对齐', link: '/adr/0010-pi-coding-agent-harness-alignment' },
]

const adrSidebar0011: DefaultTheme.SidebarItem[] = [
  { text: '0011 Missions Harness 对齐', link: '/adr/0011-missions-harness-alignment' },
  { text: '0012 内存与生命周期', link: '/adr/0012-memory-lifecycle-stability-fixes' },
  { text: '0013 Graceful Shutdown', link: '/adr/0013-graceful-shutdown-protocol' },
  { text: '0014 稳定性路线图', link: '/adr/0014-stability-enhancement-roadmap' },
  { text: '0015 能力分档模型', link: '/adr/0015-capability-tier-model' },
  { text: '0016 Demo Host Token', link: '/adr/0016-demo-host-token-scopes' },
  { text: '0017 RAG v0 知识检索', link: '/adr/0017-rag-v0-knowledge-search' },
  { text: '0018 AI SDK Transport', link: '/adr/0018-ai-sdk-transport-layer' },
  { text: '0019 Install Size Layering', link: '/adr/0019-install-size-layering' },
  { text: '0020 Speech STT/TTS', link: '/adr/0020-speech-pipeline-stt-tts' },
]

const adrSidebar0021: DefaultTheme.SidebarItem[] = [
  { text: '0021 内容审查边界', link: '/adr/0021-content-moderation' },
  { text: '0022 Interactive 按钮模式', link: '/adr/0022-interactive-button-modes' },
  { text: '0023 GroupCell 多 Endpoint', link: '/adr/0023-group-cell-multi-endpoint-agents' },
  { text: '0024 Five-Agent Pipeline (Superseded)', link: '/adr/0024-five-agent-aop-pipeline' },
  { text: '0025 AI Outbound JSON', link: '/adr/0025-adapter-ai-outbound-json' },
  { text: '0026 废弃场景专用 Harness', link: '/adr/0026-retire-scenario-specific-pipeline-harnesses' },
  { text: '0027 Orchestration Kernel', link: '/adr/0027-agent-run-orchestration-kernel' },
  { text: '0028 Generic IM Scene Agent', link: '/adr/0028-generic-im-scene-agent' },
  { text: '0029 Deferred Tool Schema', link: '/adr/0029-deferred-tool-schema-loading' },
  { text: '0030 并行子代理', link: '/adr/0030-spawn-parallel-subagents' },
  { text: '0031 Schedule 取代 Cron', link: '/adr/0031-schedule-facility-replace-cron' },
  { text: '0035 A2A Agent Mesh', link: '/adr/0035-a2a-agent-mesh' },
  { text: '0036 Internal Room 协作', link: '/adr/0036-internal-room-collaboration' },
  { text: '0038 Activity Feedback 三相位', link: '/adr/0038-activity-feedback-schedule-phases' },
]

const adrSidebar0039: DefaultTheme.SidebarItem[] = [
  { text: '0039 Eve 对齐 Agent 创作面', link: '/adr/0039-eve-aligned-agent-surface-roadmap' },
  { text: '0040 HTTP Step Checkpoint', link: '/adr/0040-http-step-checkpoint-persistence' },
  { text: '0041 AgentStreamBus', link: '/adr/0041-agent-stream-bus-and-session-host-port' },
]

const adrSidebar0042: DefaultTheme.SidebarItem[] = [
  { text: '0042 Capability Features', link: '/adr/0042-capability-features-and-on-demand-ingress' },
  { text: '0043 统一 Capability Root', link: '/adr/0043-unify-capability-roots' },
  { text: '0044 TS HMR Plugin Kernel', link: '/adr/0044-typescript-hmr-plugin-kernel' },
  { text: '0045 层级 Plugin 配置', link: '/adr/0045-hierarchical-plugin-config-schema' },
  { text: '0046 约定式 pages', link: '/adr/0046-convention-pages-and-plugin-navigation' },
  { text: '0047 独立 Plugin 项目', link: '/adr/0047-standalone-plugin-and-root-lifecycle-domain' },
  { text: '0048 Plugin Monorepo', link: '/adr/0048-plugin-monorepo-and-feature-provider-packages' },
  { text: '0049 Isolated Plugin Runtime', link: '/adr/0049-isolated-plugin-runtime' },
  { text: '0050 Plugin Runtime 迁移边界', link: '/adr/0050-plugin-runtime-migration-boundary' },
  { text: '0051 原生 TS 开发 Runtime', link: '/adr/0051-native-typescript-development-runtime' },
  { text: '0052 Plugin Runtime 包边界', link: '/adr/0052-plugin-runtime-package-boundary' },
]

const adrSidebar: DefaultTheme.SidebarItem[] = [
  sidebarGroup('0001–0010', adrSidebar0001),
  sidebarGroup('0011–0020', adrSidebar0011),
  sidebarGroup('0021–0038', adrSidebar0021),
  sidebarGroup('0039–0041', adrSidebar0039),
  sidebarGroup('0042–0052', adrSidebar0042),
]

/** A+B：部署、配置、写插件与 AI */
const useDocsSidebar: DefaultTheme.SidebarItem[] = [
  sidebarGroup('入门', [
      { text: '这是什么？', link: '/what-is-zhin' },
      { text: '安装与启动', link: '/getting-started/' },
      { text: '5 分钟首跑', link: '/getting-started/first-run' },
      { text: '生态与资源', link: '/ecosystem' },
      { text: 'Docker 部署', link: '/getting-started/docker' },
      { text: '能力分档与定位', link: '/essentials/capability-tiers' },
      { text: '学习路径', link: '/essentials/learning-paths' },
      { text: '疑难排查', link: '/troubleshooting/' },
  ]),
  sidebarGroup('核心概念', [
      { text: '核心概念速查', link: '/essentials/' },
      { text: '消息如何流转', link: '/essentials/message-flow' },
      { text: '架构概览', link: '/architecture-overview' },
      { text: '配置文件', link: '/essentials/configuration' },
      { text: '命令系统', link: '/essentials/commands' },
      { text: '插件系统', link: '/essentials/plugins' },
      { text: '中间件', link: '/essentials/middleware' },
      { text: '消息过滤', link: '/essentials/message-filter' },
      { text: 'Rich Segment 矩阵', link: '/essentials/rich-segment-adapters' },
      { text: 'Interactive 消息段', link: '/essentials/interactive-segments' },
      { text: 'Windows 环境', link: '/essentials/windows-setup' },
  ]),
  sidebarGroup('插件开发', [
      { text: '安装插件', link: '/guide/plugin-install' },
      { text: '插件生命周期', link: '/guide/plugin-lifecycle' },
      { text: '插件开发、测试与发布', link: '/guide/plugin-development' },
  ]),
  sidebarGroup('平台适配器', adapterSidebar),
  sidebarGroup('AI 与进阶', advancedSidebar),
  sidebarGroup('Host 与 Console', [
      { text: 'Host 栈概览', link: '/host/' },
      { text: 'Remote Console', link: '/console-remote' },
  ]),
  sidebarGroup('参考与生态', [
      { text: '术语表', link: '/reference/glossary' },
      { text: 'CLI 命令', link: '/reference/cli' },
      { text: 'API 参考', link: '/api/' },
      { text: '插件市场', link: '/plugins/' },
      { text: '演练场', link: '/playground' },
  ]),
  {
    text: '框架开发 →',
    link: '/contributing',
  },
]

/** C：贡献 monorepo、读 ADR 与架构深读 */
const devDocsSidebar: DefaultTheme.SidebarItem[] = [
  sidebarGroup('贡献', [
      { text: '贡献指南总览', link: '/contributing' },
      { text: '仓库结构与模块化约定', link: '/contributing/repo-structure' },
      { text: 'Harness Engineering', link: '/contributing/harness-engineering' },
      { text: 'Monorepo（无 submodule）', link: '/contributing/monorepo-no-submodules' },
  ]),
  sidebarGroup('架构深读', [
      { text: '架构索引', link: '/architecture/' },
      { text: '架构概览（用户向）', link: '/architecture-overview' },
      { text: 'Segment 内容模型', link: '/architecture/segment-content-model' },
      { text: 'Assistant Runtime', link: '/architecture/assistant-runtime' },
      { text: 'Agent 上下文块', link: '/architecture/agent-context-blocks' },
      { text: 'Agent 提示词贡献者', link: '/architecture/agent-prompt-contributors' },
      { text: 'HTTP 路由编写', link: '/architecture/fetch-router-authoring' },
      { text: 'Harness 检查来源', link: '/architecture/harness-engineering-sources' },
  ]),
  sidebarGroup('目标实现蓝图', [
      { text: '蓝图总览', link: '/architecture/target-implementation/' },
      { text: 'Config、Discovery 与 HMR', link: '/architecture/target-implementation/config-discovery-hmr' },
      { text: 'IM、Agent 与 Console Runtime', link: '/architecture/target-implementation/domain-runtimes' },
      { text: 'Plugin Runtime 实现状态', link: '/architecture/target-implementation/greenfield-bootstrap' },
      { text: 'Plugin Runtime 原位迁移', link: '/architecture/target-implementation/in-place-migration' },
      { text: 'Kernel 与原子 Generation', link: '/architecture/target-implementation/kernel-and-generation' },
      { text: 'Plugin Runtime 迁移契约', link: '/architecture/target-implementation/migration-contract' },
      { text: 'Plugin Monorepo 与 Feature Provider', link: '/architecture/target-implementation/plugin-monorepo-and-features' },
  ]),
  sidebarGroup('ADR', adrSidebar),
  sidebarGroup('维护者', [
      { text: 'Issue 流程', link: '/agents/issue-tracker' },
      { text: 'Triage 标签', link: '/agents/triage-labels' },
      { text: '领域词汇', link: '/agents/domain' },
  ]),
  {
    text: '← 使用文档',
    link: '/getting-started/',
  },
]

const USE_DOC_PREFIXES = [
  '/getting-started/',
  '/what-is-zhin',
  '/ecosystem',
  '/console-remote',
  '/troubleshooting/',
  '/guide/',
  '/essentials/',
  '/adapters/',
  '/reference/',
  '/host/',
  '/advanced/',
  '/architecture-overview',
  '/api/',
  '/plugins/',
  '/playground',
]

const DEV_DOC_PREFIXES = [
  '/contributing',
  '/contributing/',
  '/adr/',
  '/architecture/',
  '/agents/',
]

function mapSidebar(
  prefixes: string[],
  sidebar: DefaultTheme.SidebarItem[],
): DefaultTheme.Sidebar {
  return Object.fromEntries(prefixes.map((prefix) => [prefix, sidebar]))
}

export default withMermaid(defineConfig({
  title: 'Zhin.js',
  description: 'AI 驱动的 TypeScript 机器人框架',

  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
    /^https?:\/\/github\.com/,
    /\.\.\/\.\.\/(examples|packages|basic|deploy)\//,
    /^\/adr\/index$/,
  ],

  srcExclude: ['**/snippets/**', 'README.md'],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '生态', link: '/ecosystem' },
      {
        text: '使用文档',
        activeMatch: '^/(getting-started|essentials|guide|adapters|advanced|reference|host|troubleshooting|what-is-zhin|architecture-overview|console-remote|api|plugins|playground|ecosystem)',
        items: [
          { text: '快速开始', link: '/getting-started/' },
          { text: '5 分钟首跑', link: '/getting-started/first-run' },
          { text: '生态与资源', link: '/ecosystem' },
          { text: '学习路径', link: '/essentials/learning-paths' },
          { text: '核心概念', link: '/essentials/' },
          { text: '插件开发', link: '/guide/plugin-development' },
          { text: '平台适配器', link: '/adapters/' },
          { text: 'AI 模块', link: '/advanced/ai' },
          { text: '架构概览', link: '/architecture-overview' },
          { text: '疑难排查', link: '/troubleshooting/' },
        ],
      },
      {
        text: '框架开发',
        activeMatch: '^/(contributing|adr|architecture|agents)',
        items: [
          { text: '贡献指南', link: '/contributing' },
          { text: '仓库结构', link: '/contributing/repo-structure' },
          { text: 'Harness Engineering', link: '/contributing/harness-engineering' },
          { text: '架构深读', link: '/architecture/' },
          { text: 'ADR 索引', link: '/adr/' },
          { text: 'Issue 流程', link: '/agents/issue-tracker' },
        ],
      },
    ],

    sidebar: {
      ...mapSidebar(USE_DOC_PREFIXES, useDocsSidebar),
      ...mapSidebar(DEV_DOC_PREFIXES, devDocsSidebar),
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' },
    ],

    footer: {
      message: 'MIT License · <a href="/ecosystem">生态</a> · <a href="/adapters/">适配器</a> · <a href="https://github.com/zhinjs/zhin">GitHub</a>',
      copyright: 'Copyright © 2024-present lc-cn',
    },

    search: {
      provider: 'local',
    },
  },

  vite: {
    optimizeDeps: {
      include: ['mermaid'],
    },
    ssr: {
      noExternal: ['mermaid'],
    },
  },

  mermaid: {
    startOnLoad: true,
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
    },
  },

  mermaidPlugin: {
    class: 'mermaid',
  },
}))
