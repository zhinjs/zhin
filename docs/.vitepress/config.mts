import { defineConfigWithTheme } from 'vitepress';

const pkg = require('../../zhin/package.json');
export default defineConfigWithTheme({
  title: '知音(Zhin)',
  titleTemplate: ':title - 知音(Zhin)',
  head: [['meta', { name: 'theme-color', content: '#3c8772' }]],
  srcDir: './src',
  outDir: './dist',
  description: '轻量、优雅的开发机器人',
  lang: 'zh-CN',
  lastUpdated: true,
  ignoreDeadLinks: true,
  themeConfig: {
    search: {
      provider: 'algolia',
      options: {
        appId: 'JJ7HNQWQ9J',
        apiKey: 'be3cc799b1d0dd165a4bd11a006690b8',
        indexName: 'zhin',
        locales: {
          zh: {
            placeholder: '搜索文档',
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档',
              },
              modal: {
                searchBox: {
                  resetButtonTitle: '清除查询条件',
                  resetButtonAriaLabel: '清除查询条件',
                  cancelButtonText: '取消',
                  cancelButtonAriaLabel: '取消',
                },
                startScreen: {
                  recentSearchesTitle: '搜索历史',
                  noRecentSearchesText: '没有搜索历史',
                  saveRecentSearchButtonTitle: '保存至搜索历史',
                  removeRecentSearchButtonTitle: '从搜索历史中移除',
                  favoriteSearchesTitle: '收藏',
                  removeFavoriteSearchButtonTitle: '从收藏中移除',
                },
                errorScreen: {
                  titleText: '无法获取结果',
                  helpText: '你可能需要检查你的网络连接',
                },
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭',
                  searchByText: '搜索提供者',
                },
                noResultsScreen: {
                  noResultsText: '无法找到相关结果',
                  suggestedQueryText: '你可以尝试查询',
                  reportMissingResultsText: '你认为该查询应该有结果？',
                  reportMissingResultsLinkText: '点击反馈',
                },
              },
            },
          },
        },
      },
    },
    nav: [
      { text: '开始', link: '/guide/intro', activeMatch: '/guide/' },
      { text: '进阶', link: '/advance/plugin', activeMatch: '/advance/' },
      { text: '开发', link: '/dev/intro', activeMatch: '/dev/' },
      { text: '插件商店', link: '/store', activeMatch: '/store' },
      // { text: 'Playground', link: 'https://playground.zhin.icu', activeMatch: '/playground/' },
      {
        text: pkg.version,
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/zhinjs/zhin/blob/main/CHANGELOG.md',
          },
          {
            text: '贡献成员',
            link: 'https://github.com/zhinjs/zhin/graphs/contributors',
          },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '介绍',
          link: '/guide/intro',
        },
        {
          text: '安装',
          collapsible: true,
          items: [
            { text: `Android Phone`, link: '/guide/android' },
            { text: `Windows PC`, link: '/guide/windows' },
            { text: `Linux`, link: '/guide/linux' },
          ],
        },
        {
          text: '接入平台',
          collapsible: true,
          items: [
            { text: `QQ`, link: '/guide/qq' },
            { text: `Icqq`, link: '/guide/icqq' },
            { text: `Discord`, link: '/guide/discord' },
            { text: `钉钉`, link: '/guide/dingtalk' },
            { text: `微信(Web)`, link: '/guide/web-wechat' },
            { text: `OneBot 11/12`, link: '/guide/onebot' },
            { text: `Email`, link: '/guide/email' },
          ],
        },
        {
          text: '配置文件',
          link: '/guide/config',
        },
      ],
      '/advance/': [
        {
          text: '插件开发',
          link: '/advance/plugin',
        },
        {
          text: '核心模块',
          collapsible: true,
          items: [
            { text: `服务`, link: '/advance/service' },
            { text: `适配器`, link: '/advance/adapter' },
            { text: `中间件`, link: '/advance/middleware' },
            { text: `指令`, link: '/advance/command' },
          ],
        },
        {
          text: '消息',
          link: '/advance/message',
        },
      ],
    },
    footer: {
      message: 'Released under the <a href="https://github.com/zhinjs/zhin/blob/main/LICENSE">MIT License</a>.',
      copyright: 'Copyright © 2022-2025 <a href="https://github.com/lc-cn">凉菜</a>',
    },
    editLink: {
      pattern: 'https://github.com/zhinjs/zhin/edit/main/docs/src/:path',
      text: '修正文档',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/zhinjs/zhin' }],
    lastUpdatedText: '上次更新时间',
    docFooter: {
      prev: '上一节',
      next: '下一节',
    },
  },
});
