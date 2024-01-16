import {defineConfigWithTheme} from "vitepress";

export default defineConfigWithTheme({
    title: '知音(Zhin)',
    titleTemplate: ':title - 知音(Zhin)',
    base: '/zhin',
    head: [['meta', {name: 'theme-color', content: '#3c8772'}]],
    srcDir: './src',
    outDir: './dist',
    description: '轻量、优雅的开发机器人',
    lang: 'zh-CN',
    lastUpdated: true,
    ignoreDeadLinks: true,
    themeConfig: {
        search:{
            provider:'algolia',
            options:{
                appId: 'JJ7HNQWQ9J',
                apiKey: 'be3cc799b1d0dd165a4bd11a006690b8',
                indexName: 'zhin',
                locales:{
                    zh:{
                        placeholder:'搜索文档',
                        translations:{
                            button: {
                                buttonText: '搜索文档',
                                buttonAriaLabel: '搜索文档'
                            },
                            modal:{
                                searchBox: {
                                    resetButtonTitle: '清除查询条件',
                                    resetButtonAriaLabel: '清除查询条件',
                                    cancelButtonText: '取消',
                                    cancelButtonAriaLabel: '取消'
                                },
                                startScreen: {
                                    recentSearchesTitle: '搜索历史',
                                    noRecentSearchesText: '没有搜索历史',
                                    saveRecentSearchButtonTitle: '保存至搜索历史',
                                    removeRecentSearchButtonTitle: '从搜索历史中移除',
                                    favoriteSearchesTitle: '收藏',
                                    removeFavoriteSearchButtonTitle: '从收藏中移除'
                                },
                                errorScreen: {
                                    titleText: '无法获取结果',
                                    helpText: '你可能需要检查你的网络连接'
                                },
                                footer: {
                                    selectText: '选择',
                                    navigateText: '切换',
                                    closeText: '关闭',
                                    searchByText: '搜索提供者'
                                },
                                noResultsScreen: {
                                    noResultsText: '无法找到相关结果',
                                    suggestedQueryText: '你可以尝试查询',
                                    reportMissingResultsText: '你认为该查询应该有结果？',
                                    reportMissingResultsLinkText: '点击反馈'
                                }
                            }
                        }
                    }
                }
            }
        },
        nav: [
            {text: '开始', link: '/guide/start', activeMatch: '/guide/'},
            {text: '配置', link: '/config/common', activeMatch: '/config/'},
            { text: 'API', link: '/api/zhin', activeMatch: '/api/' },
            // { text: '插件市场', link: '/market/', activeMatch: '/market/' },
            // { text: 'Playground', link: 'https://playground.zhin.icu', activeMatch: '/playground/' },
            {
                text: require('../../package.json').version,
                items: [
                    {
                        text: 'Changelog',
                        link: 'https://github.com/zhinjs/zhin/blob/main/CHANGELOG.md'
                    },
                    {
                        text: '贡献',
                        link: 'https://github.com/zhinjs/zhin/blob/main/.github/contributing.md'
                    }
                ]
            }
        ],
        sidebar: {
            '/guide/': [
                {
                    text: '介绍',
                    collapsible: true,
                    items: [
                        {text: `准备工作`, link: '/guide/prepare'},
                        {text: `安装`, link: '/guide/start'},
                        {text: `HelloWorld`, link: '/guide/repeater'},
                    ]
                },
                {
                    text: '深入了解',
                    collapsible: true,
                    items: [
                        {text: `插件 - Plugin`, link: '/guide/plugin'},
                        {text: `指令 - Command`, link: '/guide/command'},
                        {text: `可交互输入 - Prompt`, link: '/guide/prompt'},
                        {text: `组件 - Component`, link: '/guide/component'},
                        {text: `Bot API`, link: '/guide/bot'},
                        {text: `装饰器（实验性）`, link: "/guide/decorator"},
                    ]
                },
                {
                    text: '部署',
                    link: '/guide/deploy',
                },
            ],
            '/api/': [
                {text: `目录`, link: '/api/'},
                {
                    text: '核心模块',
                    collapsible: true,
                    items: [
                        {text: `知音`, link: '/api/zhin'},
                        {text: `服务`, link: '/api/service'},
                        {text: `适配器`, link: '/api/adapter'},
                        {text: `机器人`, link: '/api/bot'},
                        {text: `指令`, link: '/api/command'},
                        {text: `上下文`, link: '/api/context'},
                        {text: `会话`, link: '/api/session'},
                    ]
                },
                {
                    text: '消息定义',
                    link: '/api/message',
                },
                {
                    text: '内置服务',
                    collapsible: true,
                    items: [
                        {text: `server`, link: '/api/service-server'},
                        {text: `router`, link: '/api/service-router'},
                        {text: `koa`, link: '/api/service-koa'},
                    ]
                },
                {
                    text: `事件系统`,
                    collapsible: true,
                    items: [
                        {text: `事件地图`, link: '/api/event/map'},
                    ]
                },
            ],
            '/config': [
                {
                    text: '通用配置',
                    link: '/config/common',
                },
                {
                    text: '适配器',
                    collapsible: true,
                    items: [
                        {text: `icqq`, link: '/config/adapter-icqq'},
                        {text:`onebot`,link:'/config/adapter-onebot'},
                    ]
                },
                {
                    text: '内置插件',
                    link: '/config/built-plugin',
                },
            ]
        },
        footer: {
            message: 'Released under the <a href="https://github.com/zhinjs/zhin/blob/master/LICENSE">MIT License</a>.',
            copyright: 'Copyright © 2022-2023 <a href="https://github.com/lc-cn">凉菜</a>'
        },
        editLink: {
            pattern: 'https://github.com/zhinjs/zhin/edit/master/docs/src/:path',
            text: '修正文档',
        },
        socialLinks: [
            {icon: 'github', link: 'https://github.com/zhinjs/zhin'}
        ],
        lastUpdatedText: '上次更新时间',
        docFooter: {
            prev: '上一节',
            next: '下一节'
        }
    }
})
