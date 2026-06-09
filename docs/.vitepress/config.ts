import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const aiSidebar = [
  { text: 'AI 模块', link: '/advanced/ai' },
  { text: 'Agent 概念入门', link: '/advanced/agent-concepts' },
  { text: 'MCP 集成', link: '/advanced/mcp' },
  { text: '工具与技能', link: '/advanced/tools-skills' },
  { text: 'Feature 系统', link: '/advanced/features' },
  { text: 'Agent 安全与角色', link: '/advanced/agent-harness-engineering' },
  { text: 'Agent 最佳实践', link: '/advanced/agent-best-practices' },
  { text: 'pi coding-agent 映射', link: '/advanced/pi-coding-agent-mapping' },
]

/** 高级特性 + AI 智能（合并侧栏，避免两套导航） */
const advancedSidebar = [
  { text: '概述', link: '/advanced/' },
  ...aiSidebar,
  { text: '组件系统', link: '/advanced/components' },
  { text: '定时任务', link: '/advanced/cron' },
  { text: '数据库', link: '/advanced/database' },
  { text: '热重载', link: '/advanced/hot-reload' },
]

const adapterSidebar = [
  { text: '概览', link: '/adapters/' },
  { text: '适配器（框架概念）', link: '/essentials/adapters' },
  {
    text: 'Stable',
    items: [{ text: 'Sandbox', link: '/adapters/sandbox' }],
  },
  {
    text: 'Advanced',
    items: [
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
    ],
  },
  {
    text: 'Experimental',
    items: [
      { text: 'NapCat', link: '/adapters/napcat' },
      { text: 'OneBot v12', link: '/adapters/onebot12' },
      { text: 'Milky', link: '/adapters/milky' },
      { text: 'Satori', link: '/adapters/satori' },
      { text: 'Email', link: '/adapters/email' },
      { text: 'GitHub', link: '/adapters/github' },
    ],
  },
]

export default withMermaid(defineConfig({
  title: "Zhin.js",
  description: "AI 驱动的 TypeScript 机器人框架",
  
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
    /^https?:\/\/github\.com/,
    // Monorepo 源码 / 示例（链出 docs/ 根目录；VitePress 校验时会去掉 .md 后缀）
    /\.\.\/\.\.\/(examples|packages|basic)\//,
  ],
  
  themeConfig: {
    // 顶栏保持少量入口，其余收进下拉，降低首屏认知负担（侧栏仍保留完整路径）
    nav: [
      { text: '快速开始', link: '/getting-started/' },
      {
        text: '文档',
        items: [
          { text: '学习路径', link: '/essentials/learning-paths' },
          { text: '核心基础', link: '/essentials/' },
          { text: '消息如何流转', link: '/essentials/message-flow' },
          { text: '架构概览', link: '/architecture-overview' },
          { text: '架构索引', link: '/architecture/' },
          { text: '术语表', link: '/reference/glossary' },
          { text: '平台适配器', link: '/adapters/' },
          { text: 'Host 栈', link: '/host/' },
        ],
      },
      { text: '插件开发', link: '/guide/plugin-development' },
      { text: 'AI', link: '/advanced/ai' },
      {
        text: '参考与生态',
        items: [
          { text: 'API 参考', link: '/api/' },
          { text: '高级特性', link: '/advanced/' },
          { text: '插件市场', link: '/plugins/' },
          { text: '演练场', link: '/playground' },
          { text: '贡献指南', link: '/contributing' },
        ],
      },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: '快速开始',
          items: [
            { text: '安装与启动', link: '/getting-started/' },
            { text: 'Docker 部署', link: '/getting-started/docker' },
            { text: 'Remote Console', link: '/console-remote' },
          ]
        }
      ],

      '/console-remote': [
        {
          text: '快速开始',
          items: [
            { text: '安装与启动', link: '/getting-started/' },
            { text: 'Docker 部署', link: '/getting-started/docker' },
            { text: 'Remote Console', link: '/console-remote' },
          ]
        }
      ],

      '/guide/': [
        {
          text: '开发指南',
          items: [
            { text: '插件开发、测试与发布', link: '/guide/plugin-development' }
          ]
        }
      ],
      
      '/essentials/': [
        {
          text: '核心基础',
          items: [
            { text: '核心概念', link: '/essentials/' },
            { text: '学习路径', link: '/essentials/learning-paths' },
            { text: '消息如何流转', link: '/essentials/message-flow' },
            { text: '配置文件', link: '/essentials/configuration' },
            { text: '命令系统', link: '/essentials/commands' },
            { text: '插件系统', link: '/essentials/plugins' },
            { text: '中间件', link: '/essentials/middleware' },
            { text: '适配器', link: '/essentials/adapters' },
            { text: '平台适配器索引', link: '/adapters/' },
            { text: '消息过滤', link: '/essentials/message-filter' },
            { text: 'Windows 环境', link: '/essentials/windows-setup' },
          ]
        }
      ],

      '/essentials/adapters': [{ text: '平台适配器', items: adapterSidebar }],

      '/adapters/': [{ text: '平台适配器', items: adapterSidebar }],

      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '术语表', link: '/reference/glossary' },
            { text: 'CLI 命令', link: '/reference/cli' },
          ],
        },
      ],

      '/host/': [
        {
          text: 'Host 栈',
          items: [
            { text: '概览', link: '/host/' },
            { text: 'Remote Console', link: '/console-remote' },
            { text: 'MCP 集成', link: '/advanced/mcp' },
          ],
        },
      ],

      '/adr/': [
        {
          text: 'ADR',
          items: [
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
          ],
        },
      ],

      '/advanced/': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/ai': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/agent-concepts': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/mcp': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/tools-skills': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/features': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/agent-harness-engineering': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/agent-best-practices': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/components': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/cron': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/database': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/hot-reload': [{ text: '高级特性', items: advancedSidebar }],
      '/advanced/pi-coding-agent-mapping': [{ text: '高级特性', items: advancedSidebar }],

      '/architecture/': [
        {
          text: '架构',
          items: [
            { text: '架构索引', link: '/architecture/' },
            { text: '架构概览', link: '/architecture-overview' },
            { text: 'Agent 上下文块', link: '/architecture/agent-context-blocks' },
            { text: 'Agent 提示词贡献者', link: '/architecture/agent-prompt-contributors' },
            { text: 'HTTP 路由编写', link: '/architecture/fetch-router-authoring' },
            { text: 'Harness 检查来源', link: '/architecture/harness-engineering-sources' },
            { text: 'ADR 索引', link: '/adr/' },
          ]
        }
      ],

      '/architecture-overview': [
        {
          text: '架构',
          items: [
            { text: '架构概览', link: '/architecture-overview' },
            { text: '架构索引', link: '/architecture/' },
            { text: 'Host 栈', link: '/host/' },
            { text: 'ADR 索引', link: '/adr/' },
          ],
        },
      ],
      
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: 'API 总览', link: '/api/' }
          ]
        }
      ],

      '/contributing': [
        {
          text: '贡献指南',
          items: [
            { text: '总览', link: '/contributing' },
            { text: '仓库结构与模块化约定', link: '/contributing/repo-structure' },
            { text: 'Harness Engineering', link: '/contributing/harness-engineering' },
            { text: 'Monorepo（无 submodule）', link: '/contributing/monorepo-no-submodules' },
            { text: 'Issue 流程（维护者）', link: '/agents/issue-tracker' },
          ]
        }
      ],
      '/contributing/': [
        {
          text: '贡献指南',
          items: [
            { text: '总览', link: '/contributing' },
            { text: '仓库结构与模块化约定', link: '/contributing/repo-structure' },
            { text: 'Harness Engineering', link: '/contributing/harness-engineering' },
            { text: 'Monorepo（无 submodule）', link: '/contributing/monorepo-no-submodules' },
            { text: 'Issue 流程（维护者）', link: '/agents/issue-tracker' },
          ]
        }
      ],

      '/agents/': [
        {
          text: '维护者',
          items: [
            { text: 'Issue 流程', link: '/agents/issue-tracker' },
            { text: 'Triage 标签', link: '/agents/triage-labels' },
            { text: '领域词汇', link: '/agents/domain' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' }
    ],
    
    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024-present lc-cn'
    },
    
    search: {
      provider: 'local'
    }
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
