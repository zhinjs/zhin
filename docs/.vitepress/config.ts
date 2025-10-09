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
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '60秒体验', link: '/guide/quick-start' },
            { text: '核心创新', link: '/guide/innovations' },
            { text: '架构设计', link: '/guide/architecture' },
            { text: '最佳实践', link: '/guide/best-practices' }
          ]
        }
      ],
      '/plugin/': [
        {
          text: '插件开发',
          items: [
            { text: '插件概述', link: '/plugin/' }
          ]
        }
      ],
      '/adapter/': [
        {
          text: '适配器开发',
          items: [
            { text: '适配器概述', link: '/adapter/' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: 'API 概述', link: '/api/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' }
    ]
  }
})