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
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhinjs/zhin' },
      { icon: 'discord', link: 'https://discord.gg/CMge4ZeK4n' },
      {
        icon: {
          svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M433.754 420.445c-11.526 1.393-44.86-52.741-44.86-52.741 0 31.345-16.136 72.247-51.051 101.786 16.842 5.192 54.843 19.167 45.803 34.421-7.316 12.343-125.51 7.881-159.632 4.037-34.122 3.844-152.316 8.306-159.632-4.037-9.045-15.25 28.918-29.214 45.783-34.415-34.92-29.539-51.059-70.445-51.059-101.792 0 0-33.334 54.134-44.859 52.741-5.37-.65-12.424-29.644 9.347-99.704 10.261-33.024 21.995-60.478 40.144-105.779C60.683 98.063 108.982.006 224 0c113.737.006 163.156 96.133 160.264 214.963 18.118 45.223 29.912 72.85 40.144 105.778 21.768 70.06 14.716 99.053 9.346 99.704z"></path</svg>`,
        },
        link: 'https://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=vGiaVXLVoNAlDKHTej7GOzQV1Q6U5jiK&authKey=J%2FtBMx99f%2FkPs%2FF3P3Z7bQyISLMB5%2FuTRSI9oVRKCPo5J4Gq4dtOK4XzQLUaAV4r&noverify=0&group_code=129043431',
      },
    ],
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
            { text: `安装到 安卓手机`, link: '/guide/android' },
            { text: `安装到 Windows 电脑`, link: '/guide/windows' },
            { text: `安装到 Linux / Mac`, link: '/guide/linux' },
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
    lastUpdatedText: '上次更新时间',
    docFooter: {
      prev: '上一节',
      next: '下一节',
    },
  },
});
