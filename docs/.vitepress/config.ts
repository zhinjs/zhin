import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: "Zhin.js",
  description: "AI 驱动的 TypeScript 机器人框架",
  
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
    /^https?:\/\/github\.com/,
  ],
  
  themeConfig: {
    nav: [
      { text: '架构概览', link: '/architecture-overview' },
      { text: '快速开始', link: '/getting-started/' },
      { text: '核心基础', link: '/essentials/' },
      { text: 'AI 智能', link: '/advanced/ai' },
      { text: '高级特性', link: '/advanced/' },
      { text: 'API 参考', link: '/api/' },
      { text: '插件市场', link: '/plugins/' },
      { text: '技能商店', link: '/skills/' },
      { text: '演练场', link: '/playground' },
      { text: '贡献', link: '/contributing' }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: '快速开始',
          items: [
            { text: '安装与启动', link: '/getting-started/' },
            { text: 'Docker 部署', link: '/getting-started/docker' }
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
      
      '/advanced/ai': [
        {
          text: 'AI 智能',
          items: [
            { text: 'AI 模块', link: '/advanced/ai' },
            { text: '工具与技能', link: '/advanced/tools-skills' },
            { text: 'Feature 系统', link: '/advanced/features' }
          ]
        }
      ],
      '/advanced/tools-skills': [
        {
          text: 'AI 智能',
          items: [
            { text: 'AI 模块', link: '/advanced/ai' },
            { text: '工具与技能', link: '/advanced/tools-skills' },
            { text: 'Feature 系统', link: '/advanced/features' }
          ]
        }
      ],
      '/advanced/features': [
        {
          text: 'AI 智能',
          items: [
            { text: 'AI 模块', link: '/advanced/ai' },
            { text: '工具与技能', link: '/advanced/tools-skills' },
            { text: 'Feature 系统', link: '/advanced/features' }
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
      ],

      '/skills/': [
        {
          text: '技能商店',
          items: [
            { text: '技能商店', link: '/skills/' }
          ]
        }
      ],

      '/contributing': [
        {
          text: '贡献指南',
          items: [
            { text: '总览', link: '/contributing' },
            { text: '仓库结构与模块化约定', link: '/contributing/repo-structure' }
          ]
        }
      ],
      '/contributing/': [
        {
          text: '贡献指南',
          items: [
            { text: '总览', link: '/contributing' },
            { text: '仓库结构与模块化约定', link: '/contributing/repo-structure' }
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
