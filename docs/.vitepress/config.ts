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

// ─── Chinese (root) sidebar ───

const USE_DOC_PREFIXES = [
  '/getting-started/',
  '/concepts/',
  '/authoring/',
  '/adapters/',
  '/configuration/',
  '/cli/',
  '/ai/',
  '/console/',
  '/examples/',
  '/paths/',
  '/showcase/',
]

const DEV_DOC_PREFIXES = ['/contributing/']

const zhUseDocsSidebar: DefaultTheme.SidebarItem[] = [
  { text: '快速开始', link: '/getting-started/' },
  { text: '第一个插件', link: '/getting-started/first-plugin' },
  sidebarGroup('核心概念', [
    { text: '目标架构（SSOT）', link: '/target-architecture' },
    { text: '分层架构', link: '/concepts/architecture' },
    { text: '插件模型', link: '/concepts/plugin-model' },
    { text: '配置即数据', link: '/concepts/config-as-data' },
    { text: 'Generation 生命周期', link: '/concepts/generation-lifecycle' },
    { text: '消息流', link: '/concepts/message-flow' },
  ]),
  sidebarGroup('插件创作', [
    { text: 'definePlugin 全景', link: '/authoring/define-plugin' },
    { text: '约定目录', link: '/authoring/conventions' },
    { text: '命令', link: '/authoring/commands' },
    { text: '中间件与组件', link: '/authoring/middleware-components' },
    { text: 'Agent 工具', link: '/authoring/agent-tools' },
    { text: 'Host Token 总览', link: '/authoring/host-tokens' },
    { text: '端点生命周期', link: '/authoring/endpoint-lifecycle' },
    { text: '模块级状态', link: '/authoring/module-state' },
    { text: 'Console 页面', link: '/authoring/console-pages' },
  ]),
  sidebarGroup('平台适配器', [
    { text: '概览', link: '/adapters/' },
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
  ]),
  sidebarGroup('参考', [
    { text: '配置参考', link: '/configuration/' },
    { text: 'CLI 命令', link: '/cli/' },
    { text: 'zhin runtime start', link: '/cli/runtime' },
  ]),
  sidebarGroup('AI 模块', [
    { text: '总览', link: '/ai/' },
    { text: 'Agent 深入', link: '/ai/agent' },
    { text: '语音', link: '/ai/speech' },
  ]),
  { text: 'Console', link: '/console/' },
  { text: '示例项目', link: '/examples/' },
  sidebarGroup('学习路径', [
    { text: '路径总览', link: '/paths/' },
    { text: 'IM Bot', link: '/paths/im-bot' },
    { text: 'AI Agent', link: '/paths/ai-agent' },
    { text: 'Console 管理', link: '/paths/console' },
  ]),
  sidebarGroup('真实案例', [
    { text: '案例总览', link: '/showcase/' },
    { text: '个人生活助手', link: '/showcase/personal-assistant' },
    { text: '多平台社区 Bot', link: '/showcase/community-bot' },
  ]),
]

const zhDevDocsSidebar: DefaultTheme.SidebarItem[] = [
  { text: '仓库结构', link: '/contributing/repo-structure' },
  { text: '开发流程与门禁', link: '/contributing/development' },
  { text: '代码约定', link: '/contributing/conventions' },
  { text: 'Public API 面', link: '/contributing/public-api-surface' },
  { text: 'Legacy 概念迁移', link: '/contributing/legacy-concepts' },
]

// ─── English (/en/) sidebar ───

const EN_USE_DOC_PREFIXES = [
  '/en/getting-started/',
  '/en/concepts/',
  '/en/authoring/',
  '/en/adapters/',
  '/en/configuration/',
  '/en/cli/',
  '/en/ai/',
  '/en/console/',
  '/en/examples/',
  '/en/paths/',
  '/en/showcase/',
]

const EN_DEV_DOC_PREFIXES = ['/en/contributing/']

const enUseDocsSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'Quick Start', link: '/en/getting-started/' },
  { text: 'First Plugin', link: '/en/getting-started/first-plugin' },
  sidebarGroup('Core Concepts', [
    { text: 'Layered Architecture', link: '/en/concepts/architecture' },
    { text: 'Plugin Model', link: '/en/concepts/plugin-model' },
    { text: 'Config as Data', link: '/en/concepts/config-as-data' },
    { text: 'Generation Lifecycle', link: '/en/concepts/generation-lifecycle' },
    { text: 'Message Flow', link: '/en/concepts/message-flow' },
  ]),
  sidebarGroup('Plugin Authoring', [
    { text: 'definePlugin Overview', link: '/en/authoring/define-plugin' },
    { text: 'Convention Directories', link: '/en/authoring/conventions' },
    { text: 'Commands', link: '/en/authoring/commands' },
    { text: 'Middleware & Components', link: '/en/authoring/middleware-components' },
    { text: 'Agent Tools', link: '/en/authoring/agent-tools' },
    { text: 'Endpoint Lifecycle', link: '/en/authoring/endpoint-lifecycle' },
    { text: 'Host Token Reference', link: '/en/authoring/host-tokens' },
    { text: 'Module-level State', link: '/en/authoring/module-state' },
    { text: 'Console Pages', link: '/en/authoring/console-pages' },
  ]),
  sidebarGroup('Platform Adapters', [
    { text: 'Overview', link: '/en/adapters/' },
    sidebarGroup('Stable', [{ text: 'Sandbox', link: '/en/adapters/sandbox' }]),
    sidebarGroup('Advanced', [
      { text: 'ICQQ (QQ)', link: '/en/adapters/icqq' },
      { text: 'QQ Official', link: '/en/adapters/qq' },
      { text: 'OneBot v11', link: '/en/adapters/onebot11' },
      { text: 'KOOK', link: '/en/adapters/kook' },
      { text: 'Discord', link: '/en/adapters/discord' },
      { text: 'Telegram', link: '/en/adapters/telegram' },
      { text: 'Slack', link: '/en/adapters/slack' },
      { text: 'DingTalk', link: '/en/adapters/dingtalk' },
      { text: 'Lark (Feishu)', link: '/en/adapters/lark' },
      { text: 'WeChat MP', link: '/en/adapters/wechat-mp' },
      { text: 'WeChat iLink', link: '/en/adapters/weixin-ilink' },
      { text: 'WeCom', link: '/en/adapters/wecom' },
      { text: 'LINE', link: '/en/adapters/line' },
    ]),
    sidebarGroup('Experimental', [
      { text: 'NapCat', link: '/en/adapters/napcat' },
      { text: 'OneBot v12', link: '/en/adapters/onebot12' },
      { text: 'Milky', link: '/en/adapters/milky' },
      { text: 'Satori', link: '/en/adapters/satori' },
      { text: 'Email', link: '/en/adapters/email' },
      { text: 'GitHub', link: '/en/adapters/github' },
    ]),
  ]),
  sidebarGroup('Reference', [
    { text: 'Configuration', link: '/en/configuration/' },
    { text: 'CLI Commands', link: '/en/cli/' },
    { text: 'zhin runtime start', link: '/en/cli/runtime' },
  ]),
  sidebarGroup('AI Module', [
    { text: 'Overview', link: '/en/ai/' },
    { text: 'Agent Deep Dive', link: '/en/ai/agent' },
    { text: 'Speech', link: '/en/ai/speech' },
  ]),
  { text: 'Console', link: '/en/console/' },
  { text: 'Examples', link: '/en/examples/' },
  sidebarGroup('Learning Paths', [
    { text: 'Path Overview', link: '/en/paths/' },
    { text: 'IM Bot', link: '/en/paths/im-bot' },
    { text: 'AI Agent', link: '/en/paths/ai-agent' },
    { text: 'Console Admin', link: '/en/paths/console' },
  ]),
  sidebarGroup('Showcase', [
    { text: 'Showcase Overview', link: '/en/showcase/' },
    { text: 'Personal Assistant', link: '/en/showcase/personal-assistant' },
    { text: 'Multi-platform Bot', link: '/en/showcase/community-bot' },
  ]),
]

const enDevDocsSidebar: DefaultTheme.SidebarItem[] = [
  { text: 'Repo Structure', link: '/en/contributing/repo-structure' },
  { text: 'Development Workflow', link: '/en/contributing/development' },
  { text: 'Code Conventions', link: '/en/contributing/conventions' },
  { text: 'Public API Surface', link: '/en/contributing/public-api-surface' },
  { text: 'Legacy Concept Migration', link: '/en/contributing/legacy-concepts' },
]

function mapSidebar(
  prefixes: string[],
  sidebar: DefaultTheme.SidebarItem[],
): DefaultTheme.Sidebar {
  return Object.fromEntries(prefixes.map((prefix) => [prefix, sidebar]))
}

export default withMermaid(defineConfig({
  title: 'Zhin.js',
  description: 'AI-native TypeScript bot framework',

  // TODO: revert to strict dead-link checking once all English pages are translated
  ignoreDeadLinks: true,

  srcExclude: ['**/snippets/**', 'README.md'],

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      description: 'AI 驱动的 TypeScript 机器人框架',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          {
            text: '使用文档',
            activeMatch: '^/(getting-started|concepts|authoring|examples|paths|showcase)/',
            items: [
              {
                text: '入门',
                items: [
                  { text: '快速开始', link: '/getting-started/' },
                  { text: '第一个插件', link: '/getting-started/first-plugin' },
                  { text: '学习路径', link: '/paths/' },
                  { text: '示例项目', link: '/examples/' },
                  { text: '真实案例', link: '/showcase/' },
                ],
              },
              {
                text: '深入',
                items: [
                  { text: '核心概念', link: '/concepts/architecture' },
                  { text: '插件创作', link: '/authoring/define-plugin' },
                ],
              },
            ],
          },
          { text: '适配器', link: '/adapters/', activeMatch: '^/adapters/' },
          {
            text: '参考',
            activeMatch: '^/(configuration|cli|console)/',
            items: [
              { text: '配置参考', link: '/configuration/' },
              { text: 'CLI 命令', link: '/cli/' },
              { text: 'zhin runtime start', link: '/cli/runtime' },
              { text: 'Console', link: '/console/' },
            ],
          },
          {
            text: 'AI 模块',
            activeMatch: '^/ai/',
            items: [
              { text: '总览', link: '/ai/' },
              { text: 'Agent 深入', link: '/ai/agent' },
              { text: '语音', link: '/ai/speech' },
            ],
          },
          { text: '贡献指南', link: '/contributing/repo-structure', activeMatch: '^/contributing/' },
        ],
        sidebar: {
          ...mapSidebar(USE_DOC_PREFIXES, zhUseDocsSidebar),
          ...mapSidebar(DEV_DOC_PREFIXES, zhDevDocsSidebar),
        },
        footer: {
          message: 'MIT License · <a href="/adapters/">适配器</a> · <a href="https://github.com/zhinjs/zhin">GitHub</a>',
          copyright: 'Copyright © 2024-present lc-cn',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'AI-native TypeScript bot framework',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          {
            text: 'Guide',
            activeMatch: '^/en/(getting-started|concepts|authoring|examples|paths|showcase)/',
            items: [
              {
                text: 'Getting Started',
                items: [
                  { text: 'Quick Start', link: '/en/getting-started/' },
                  { text: 'First Plugin', link: '/en/getting-started/first-plugin' },
                  { text: 'Learning Paths', link: '/en/paths/' },
                  { text: 'Examples', link: '/en/examples/' },
                  { text: 'Showcase', link: '/en/showcase/' },
                ],
              },
              {
                text: 'Deep Dive',
                items: [
                  { text: 'Core Concepts', link: '/en/concepts/architecture' },
                  { text: 'Plugin Authoring', link: '/en/authoring/define-plugin' },
                ],
              },
            ],
          },
          { text: 'Adapters', link: '/en/adapters/', activeMatch: '^/en/adapters/' },
          {
            text: 'Reference',
            activeMatch: '^/en/(configuration|cli|console)/',
            items: [
              { text: 'Configuration', link: '/en/configuration/' },
              { text: 'CLI Commands', link: '/en/cli/' },
              { text: 'zhin runtime start', link: '/en/cli/runtime' },
              { text: 'Console', link: '/en/console/' },
            ],
          },
          {
            text: 'AI Module',
            activeMatch: '^/en/ai/',
            items: [
              { text: 'Overview', link: '/en/ai/' },
              { text: 'Agent Deep Dive', link: '/en/ai/agent' },
              { text: 'Speech', link: '/en/ai/speech' },
            ],
          },
          { text: 'Contributing', link: '/en/contributing/repo-structure', activeMatch: '^/en/contributing/' },
        ],
        sidebar: {
          ...mapSidebar(EN_USE_DOC_PREFIXES, enUseDocsSidebar),
          ...mapSidebar(EN_DEV_DOC_PREFIXES, enDevDocsSidebar),
        },
        footer: {
          message: 'MIT License · <a href="/en/adapters/">Adapters</a> · <a href="https://github.com/zhinjs/zhin">GitHub</a>',
          copyright: 'Copyright © 2024-present lc-cn',
        },
      },
    },
  },

  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' },
    ],

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
