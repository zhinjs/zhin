import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Zhin.js",
  description: "新时代 TypeScript 机器人框架",
  
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
    /^https?:\/\/github\.com/,
  ],
  
  themeConfig: {
    nav: [
      { text: '快速开始', link: '/getting-started/' },
      { text: '核心基础', link: '/essentials/' },
      { text: '高级特性', link: '/advanced/' },
      { text: 'API 参考', link: '/api/' },
      { text: '插件市场', link: '/plugins/' }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: '快速开始',
          items: [
            { text: '安装与启动', link: '/getting-started/' }
          ]
        }
      ],
      
      '/essentials/': [
        {
          text: '核心基础',
          items: [
            { text: '核心概念', link: '/essentials/' },
            { text: '配置文件', link: '/essentials/configuration' },
            { text: '命令系统', link: '/essentials/commands' },
            { text: '插件系统', link: '/essentials/plugins' },
            { text: '中间件', link: '/essentials/middleware' },
            { text: '适配器', link: '/essentials/adapters' }
          ]
        }
      ],
      
      '/advanced/': [
        {
          text: '高级特性',
          items: [
            { text: '概述', link: '/advanced/' },
            { text: '组件系统', link: '/advanced/components' },
            { text: '定时任务', link: '/advanced/cron' },
            { text: '数据库', link: '/advanced/database' },
            { text: '热重载', link: '/advanced/hot-reload' }
          ]
        }
      ],
      
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: 'API 总览', link: '/api/' }
          ]
        }
      ]
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
  }
})
