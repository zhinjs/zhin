import {defineConfigWithTheme} from "vitepress";
export default defineConfigWithTheme({
    title: '知音(Zhin)',
    titleTemplate: ':title - 知音(Zhin)',
    base: '/',
    head: [['meta', { name: 'theme-color', content: '#3c8772' }]],
    srcDir: './src',
    outDir: './dist',
    description: '轻量、优雅的开发机器人',
    lang: 'zh-CN',
    lastUpdated: true,
    ignoreDeadLinks: true,
    themeConfig: {
        nav: [
            { text: '开始', link: '/guide/index', activeMatch: '/guide/' },
            { text: '配置', link: '/config/common', activeMatch: '/config/' },
            // { text: 'API', link: '/api/zhin', activeMatch: '/api/' },
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
            '/guide/':[
                {
                    text:'介绍',
                    collapsible:true,
                    items:[
                        {text:`索引`,link:'/guide/index'},
                        {text:`准备工作`,link:'/guide/prepare'},
                        {text:`安装`,link:'/guide/start'},
                        {text:`HelloWorld`,link:'/guide/repeater'},
                    ]
                },
                {
                    text:'深入了解',
                    collapsible:true,
                    items:[
                        {text:`指令(Command)`,link:'/guide/command'},
                        {text:`可交互输入(Prompt)`,link:'/guide/prompt'},
                        {text:`组件(Component)`,link:'/guide/component'},
                        {text:`调用机器人API`,link:'/guide/bot'},
                    ]
                },
                {
                    text:'部署',
                    link:'/guide/deploy',
                },
            ],
            '/api/':[
                {text:`目录`,link:'/api/'},
                {
                    text:'核心模块',
                    collapsible:true,
                    items:[
                        {text:`知音`,link:'/api/zhin'},
                        {text:`服务`,link:'/api/service'},
                        {text:`适配器`,link:'/api/adapter'},
                        {text:`机器人`,link:'/api/bot'},
                        {text:`指令`,link:'/api/command'},
                        {text:`上下文`,link:'/api/context'},
                        {text:`会话`,link:'/api/session'},
                    ]
                },
                {
                    text:'渲染',
                    collapsible:true,
                    items:[
                        {text:`消息段`,link:'/api/render-segment'},
                        {text:`消息元素`,link:'/api/render-element'},
                        {text:`组件`,link:'/api/render-component'},
                        {text:`指令模板`,link:'/api/render-template'},
                    ]
                },
                {
                    text:'内置服务',
                    collapsible:true,
                    items:[
                        {text:`server`,link:'/api/service-server'},
                        {text:`router`,link:'/api/service-router'},
                        {text:`koa`,link:'/api/service-koa'},
                    ]
                },
            ],
            '/config':[
                {
                    text:'通用配置',
                    link:'/config/common',
                },
                {
                    text:'适配器',
                    collapsible:true,
                    items:[
                        {text:`icqq`,link:'/config/adapter-icqq'},
                        // {text:`oneBot`,link:'/config/adapter-oneBot'},
                    ]
                },
                {
                    text:'内置插件',
                    link:'/config/built-plugin',
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
            { icon: 'github', link: 'https://github.com/zhinjs/zhin' }
        ],
        lastUpdatedText: '上次更新时间',
        docFooter: {
            prev: '上一节',
            next: '下一节'
        }
    }
})
