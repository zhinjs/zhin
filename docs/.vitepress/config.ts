import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Zhin.js",
  description: "新一代 TypeScript 机器人框架",
  base: '/zhin/',
  
  themeConfig: {
    logo: '/logo.png',
    
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/quick-start' },
      { text: 'API', link: '/api/' },
      { text: '示例', link: '/examples/' },
      { text: 'GitHub', link: 'https://github.com/zhinjs/zhin' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '🚀 快速开始',
          items: [
            { text: '60秒体验', link: '/guide/quick-start' },
            { text: '安装和配置', link: '/guide/installation' },
            { text: '你的第一个机器人', link: '/guide/your-first-bot' }
          ]
        },
        {
          text: '📖 核心概念',
          items: [
            { text: '配置文件', link: '/guide/configuration' },
            { text: '适配器系统', link: '/guide/adapters' },
            { text: '插件系统', link: '/guide/plugins' },
            { text: '命令系统', link: '/guide/commands' },
            { text: '消息处理', link: '/guide/messages' },
            { text: '上下文依赖', link: '/guide/contexts' },
            { text: '数据库', link: '/guide/database' },
            { text: 'JSX 支持', link: '/guide/jsx' }
          ]
        },
        {
          text: '🔥 进阶特性',
          items: [
            { text: '热重载机制', link: '/guide/hot-reload' },
            { text: '中间件', link: '/guide/middleware' },
            { text: '组件系统', link: '/guide/components' },
            { text: '定时任务', link: '/guide/cron' },
            { text: 'Prompt 交互', link: '/guide/prompts' },
            { text: 'Web 控制台', link: '/guide/web-console' }
          ]
        },
        {
          text: '🏗️ 架构设计',
          items: [
            { text: '架构概览', link: '/guide/architecture' },
            { text: '依赖注入', link: '/guide/dependency-injection' },
            { text: '事件系统', link: '/guide/events' },
            { text: '最佳实践', link: '/guide/best-practices' }
          ]
        }
      ],
      
      '/plugin/': [
        {
          text: '📦 插件开发',
          items: [
            { text: '插件基础', link: '/plugin/' },
            { text: '快速入门', link: '/plugin/getting-started' },
            { text: '生命周期', link: '/plugin/lifecycle' },
            { text: '命令开发', link: '/plugin/commands' },
            { text: '组件开发', link: '/plugin/components' },
            { text: '中间件开发', link: '/plugin/middleware' },
            { text: '数据库使用', link: '/plugin/database' },
            { text: '上下文使用', link: '/plugin/contexts' },
            { text: '发布插件', link: '/plugin/publishing' }
          ]
        }
      ],
      
      '/adapter/': [
        {
          text: '🔌 适配器开发',
          items: [
            { text: '适配器基础', link: '/adapter/' },
            { text: '快速入门', link: '/adapter/getting-started' },
            { text: 'Bot 接口', link: '/adapter/bot-interface' },
            { text: '消息处理', link: '/adapter/message-handling' },
            { text: '事件处理', link: '/adapter/event-handling' },
            { text: '错误处理', link: '/adapter/error-handling' }
          ]
        }
      ],
      
      '/examples/': [
        {
          text: '💡 实战示例',
          items: [
            { text: '示例概览', link: '/examples/' },
            { text: '基础使用', link: '/examples/basic' },
            { text: '多平台机器人', link: '/examples/multi-platform' },
            { text: '数据库应用', link: '/examples/database' },
            { text: '定时任务', link: '/examples/cron-jobs' },
            { text: 'Web 集成', link: '/examples/web-integration' },
            { text: 'JSX 组件', link: '/examples/jsx-components' },
            { text: 'Prompt 交互', link: '/examples/prompts' }
          ]
        }
      ],
      
      '/api/': [
        {
          text: '📘 API 参考',
          items: [
            { text: 'API 概览', link: '/api/' },
            { text: 'App', link: '/api/app' },
            { text: 'Plugin', link: '/api/plugin' },
            { text: 'Bot', link: '/api/bot' },
            { text: 'Adapter', link: '/api/adapter' },
            { text: 'Command', link: '/api/command' },
            { text: 'Message', link: '/api/message' },
            { text: 'Database', link: '/api/database' },
            { text: 'Context', link: '/api/context' },
            { text: 'Types', link: '/api/types' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' }
    ],
    
    search: {
      provider: 'local'
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Zhin.js Contributors'
    }
  }
})
