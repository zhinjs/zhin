# 简介

::: warning
框架任然处于开发阶段，不建议在生产环境中使用
:::

<div class="badge-wrap">

[![CI](https://github.com/zhinjs/zhin/actions/workflows/ci.yml/badge.svg)](https://github.com/zhinjs/zhin/actions/workflows/ci.yml)

[![Deploy Pages](https://github.com/zhinjs/zhin/actions/workflows/docs.yml/badge.svg)](https://github.com/zhinjs/zhin/actions/workflows/docs.yml)

[![npm version](https://img.shields.io/npm/v/zhin/latest.svg)](https://www.npmjs.com/package/zhin)

[![dm](https://shields.io/npm/dm/zhin)](https://www.npmjs.com/package/zhin)

[![node engine](https://img.shields.io/node/v/zhin/latest.svg)](https://nodejs.org)

[![install size](https://pkg-size.dev/badge/install/6801977)](https://pkg-size.dev/zhin)

[![bundle size](https://pkg-size.dev/badge/bundle/1909710)](https://pkg-size.dev/zhin)

</div>

- 知音 (Zhin) 是一个基于 NodeJS 的多平台机器人开发框架，兼容 QQ、ICQQ、WeChat、Discord、OneBot(11/12)、钉钉等机器人平台。
- 知音的目标是提供一个轻量、优雅、热更、统一的机器人开发框架。
- 知音的内部实现尽可能符合大众开发思维，无论是阅读源码，还是开发插件，都能事半功倍。

## 特性
- **轻量**：精简内部功能，仅内置系统级的常用插件和适配器，其他功能均通过插件来实现
- **优雅**：知音的内部实现尽可能符合大众开发思维，无论是阅读源码，还是开发插件，都能事半功倍
- **热更**：知音内置热更插件，让开发者在开发时避免频繁重启进程，从而降低账号风险概率
- **统一**：知音通过适配器统一了机器人消息的收发以及事件规范，使得开发者可以只关注一种规范，即可完成机器人开发
- **多平台**：支持 QQ、ICQQ、WeChat、Discord、OneBot(11/12)、钉钉等机器人平台
- **插件化**：支持插件化开发，开发者可以通过插件来扩展知音的功能
## 安装
- 你希望在什么设备上使用知音？
1. [我想在 Windows 电脑上使用](/guide/windows)
2. [我想在 Linux / Macos 服务器上使用](/guide/linux)
3. [我想在 安卓 手机上使用](/guide/android)

## 接入平台
- 你希望接入什么平台？
- [QQ](/guide/qq)
- [ICQQ](/guide/icqq)
- [Discord](/guide/discord)
- [钉钉](/guide/dingtalk)
- [微信(Web)](/guide/wechat)
- [OneBot(11/12)](/guide/onebot)
- [邮箱](/guide/email)

## 插件
- 插件是知音的核心功能，通过插件，你可以扩展知音的功能。
- 你可以通过 npm 安装插件，也可以自己开发插件。
- [插件商店](/store)
- [插件开发](/advance/plugin)

## 配置文件
- 项目根目录下的 config 文件夹存放着zhin所用到的配置文件，其中 zhin.config.yml 是主配置文件，包含了机器人配置、插件配置、数据库配置、日志配置等基础配置。
- 你可以根据自己的需求修改配置文件，主配置文件更改后，zhin会自动重启以应用新的配置。
- 在该目录下创建其他配置文件，并在插件中通过 `useConfig('文件名')` 来使用。
- 主配置文件介绍，请前往 [配置文件](/guide/config) 查看。

## more
- [进阶](/advance/plugin)
