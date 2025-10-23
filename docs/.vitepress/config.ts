import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Zhin.js",
  description: "新时代机器人框架",
  ignoreDeadLinks:[
    /^https?:\/\/localhost/,
  ],
  
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '指南', link: '/guide/' },
      { text: '插件', link: '/plugin/' },
      { text: '适配器', link: '/adapter/' },
      { text: 'API', link: '/api/' },
      { text: '示例', link: '/examples/' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '60秒体验', link: '/guide/quick-start' },
            { text: 'Schema 配置入门', link: '/guide/schema-quick-start' }
          ]
        },
        {
          text: '核心概念',
          items: [
            { text: '核心创新', link: '/guide/innovations' },
            { text: '架构设计', link: '/guide/architecture' },
            { text: 'Schema 系统', link: '/guide/schema-system' },
            { text: '配置热重载', link: '/guide/config-hot-reload' },
            { text: '配置热重载功能', link: '/guide/config-hot-reload-feature' },
            { text: '核心概念', link: '/guide/concepts' }
          ]
        },
        {
          text: '进阶指南',
          items: [
            { text: '最佳实践', link: '/guide/best-practices' },
            { text: '项目结构', link: '/guide/project-structure' },
            { text: 'JSX 支持', link: '/guide/jsx-support' },
            { text: '配置管理', link: '/guide/configuration' }
          ]
        }
      ],
      '/plugin/': [
        {
          text: '插件开发',
          items: [
            { text: '插件概述', link: '/plugin/' },
            { text: '插件开发指南', link: '/plugin/development' },
            { text: '组件开发', link: '/plugin/component-development' },
            { text: '中间件开发', link: '/plugin/middleware' },
            { text: '上下文系统', link: '/plugin/context' },
            { text: '生命周期', link: '/plugin/lifecycle' },
            { text: '定时任务', link: '/plugin/cron' }
          ]
        }
      ],
      '/adapter/': [
        {
          text: '适配器开发',
          items: [
            { text: '适配器概述', link: '/adapter/' },
            { text: 'Bot 接口', link: '/adapter/bot-interface' },
            { text: '适配器开发', link: '/adapter/development' },
            { text: '消息处理', link: '/adapter/message-handling' },
            { text: '事件处理', link: '/adapter/event-handling' },
            { text: '错误处理', link: '/adapter/error-handling' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: 'API 概述', link: '/api/' },
            { text: '核心 API', link: '/api/core' },
            { text: '插件 API', link: '/api/plugin' },
            { text: '适配器 API', link: '/api/adapter' },
            { text: '事件系统', link: '/api/events' },
            { text: '类型定义', link: '/api/types' }
          ]
        }
      ],
      '/examples/': [
        {
          text: '实用示例',
          items: [
            { text: '示例概述', link: '/examples/' },
            { text: '基础用法', link: '/examples/basic-usage' },
            { text: '高级用法', link: '/examples/advanced-usage' },
            { text: '实际应用', link: '/examples/real-world' }
          ]
        }
      ],
      '/official/': [
        {
          text: '官方资源',
          items: [
            { text: '官方资源概述', link: '/official/' },
            { text: '官方插件', link: '/official/plugins' },
            { text: '官方适配器', link: '/official/adapters' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' }
    ]
  }
})