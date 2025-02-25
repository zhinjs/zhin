---
layout: home
editLint: false
title: 知音 (Zhin)
titleTemplate: :title - 知音 (Zhin)

hero:
  name: 知音 (Zhin)
  text: 一个基于 NodeJS的多平台机器人开发框架
  tagline: 轻量、优雅、热更、统一
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/intro
    - theme: alt
      text: 插件商店
      link: /store
    - theme: alt
      text: GitHub
      link: https://github.com/zhinjs/zhin

features:
  - title: 轻量
    icon: 🪡
    details: 精简内部功能，仅内置系统级的常用插件和适配器，其他功能均通过插件来实现
  - title: 优雅
    icon: 🎨
    details: 知音的内部实现尽可能符合大众开发思维，无论是阅读源码，还是开发插件，都能事半功倍
  - title: 热更
    icon: 🔥
    details: 知音内置热更插件，让开发者在开发时避免频繁重启进程，从而降低账号风险概率
  - title: 统一
    icon: 🌐
    details:
      知音通过适配器统一了机器人消息的收发以及事件规范，使得开发者可以只关注一种规范，即可完成机器人开发
---

## 快速开始
```sh
npm init -y # 初始化一个新的项目
npm install zhin # 安装 zhin
npx zhin init # 初始化 zhin
npx zhin # 启动 zhin
# ...
```
