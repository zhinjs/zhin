import { createRequire } from 'module'
import {defineConfig} from "vitepress";
const require = createRequire(import.meta.url)
const pkg = require('../../package.json')
export default defineConfig({
    head: [['meta', { name: 'theme-color', content: '#3c8772' }]],
    title: '知音(Zhin)',
    titleTemplate: ':title - 知音(Zhin)',
    description: '轻量、优雅的开发机器人',
    cleanUrls: true,
    lang: 'zn-CH',
    appearance: true,
    base: '/docs/',
    lastUpdated: true,
    markdown: {
        headers: {
            level: [0, 0]
        },
    },
    outDir: './dist',
    srcDir: './src',
    ignoreDeadLinks: true,
    themeConfig: {
        nav: [
            { text: '入门', link: '/guide/index', activeMatch: '/guide/' },
            { text: '配置', link: '/config/common', activeMatch: '/config/' },
            // { text: 'API', link: '/api/zhin', activeMatch: '/api/' },
            // { text: '插件市场', link: '/market/', activeMatch: '/market/' },
            // { text: 'Playground', link: 'https://playground.zhin.icu', activeMatch: '/playground/' },
            {
                text: pkg.version,
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
        editLink: {
            pattern: 'https://github.com/zhinjs/zhin/edit/main/docs/:path',
            text: '修正文档',
        },
        socialLinks: [
            { icon: 'github', link: 'https://github.com/zhinjs/zhin' }
        ],
        lastUpdatedText: '上次更新时间',
        docFooter: {
            prev: '上一节',
            next: '下一节'
        },
        sidebar: {
            '/guide/':[
                {
                    text:'介绍',
                    collapsible:true,
                    items:[
                        {text:`索引`,link:'/guide/index'},
                        {text:`准备工作`,link:'/guide/prepare'},
                        {text:`试试水`,link:'/guide/start'},
                        {text:`了解配置`,link:'/guide/config'},
                        {text:`写个复读🐔`,link:'/guide/repeater'},
                    ]
                },
                {
                    text:'教学',
                    collapsible:true,
                    items:[
                        {text:`指令`,link:'/guide/command'},
                        {text:`可交互输入`,link:'/guide/prompt'},
                        {text:`调用机器人API`,link:'/guide/bot'},
                        {text:`组件`,link:'/guide/component'},
                    ]
                },
                {
                    text:'部署',
                    link:'/guide/deploy',
                },
            ],
            '/api/':[
                {
                    text:'核心功能',
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
                        {text:`onebot`,link:'/config/adapter-onebot'},
                    ]
                },
                {
                    text:'内置插件',
                    link:'/config/built-plugin',
                },
            ]
        }
    }
})