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
]

const DEV_DOC_PREFIXES = ['/contributing/']

const useDocsSidebar: DefaultTheme.SidebarItem[] = [
  { text: '快速开始', link: '/getting-started/' },
  { text: '第一个插件', link: '/getting-started/first-plugin' },
  sidebarGroup('核心概念', [
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
]

const devDocsSidebar: DefaultTheme.SidebarItem[] = [
  { text: '仓库结构', link: '/contributing/repo-structure' },
  { text: '开发流程与门禁', link: '/contributing/development' },
  { text: '代码约定', link: '/contributing/conventions' },
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
  ],

  srcExclude: ['**/snippets/**', 'README.md'],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      {
        text: '使用文档',
        activeMatch: '^/(getting-started|concepts|authoring|examples)/',
        items: [
          {
            text: '入门',
            items: [
              { text: '快速开始', link: '/getting-started/' },
              { text: '第一个插件', link: '/getting-started/first-plugin' },
              { text: '示例项目', link: '/examples/' },
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
      ...mapSidebar(USE_DOC_PREFIXES, useDocsSidebar),
      ...mapSidebar(DEV_DOC_PREFIXES, devDocsSidebar),
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' },
    ],

    footer: {
      message: 'MIT License · <a href="/adapters/">适配器</a> · <a href="https://github.com/zhinjs/zhin">GitHub</a>',
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
