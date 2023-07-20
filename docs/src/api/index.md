# 核心模块

## [知音(Zhin)](/api/zhin)

- 框架的统筹管理者，[适配器](#适配器--adapter-)、[服务](#服务--service-)的载体

## [适配器(Adapter)](/api/adapter)

- 连接[知音](#知音--zhin-)和机器人的桥梁（上传下达）
- 适配对应平台机器人连接到知音
- [机器人](#机器人--bot-)的载体

## [机器人(Bot)](/api/bot)

- 将对应平台推送的内容封装成[会话](#会话--session-)，并提交给上一级(适配器)

## [会话(Session)](/api/session)

- 描述平台推送内容、发出该内容的机器人、所使用的适配器的对象
- 提供一系列快捷功能

## [上下文(Context)](/api/context)

- [中间件](#中间件--middleware-)、[指令](#指令--command-)、[组件](#组件--component-)的
  载体

## [插件(Plugin)](/api/plugin)

- 使用[知音](#知音--zhin-) 开发自定义功能的**入口**
- 访问[上下文](#上下文--context-)的**入口**

# 普通开发者该关心的

## [服务(Service)](/api/service)

- 为[知音](#知音--zhin-)添加的**任何**[上下文](#上下文--context-)都可以访问的属
  性

## [指令(Command)](/api/command)

- 处理消息[会话](#会话--session-)的特殊对象

## [组件(Component)](/api/component)

- 处理消息[会话](#会话--session-)的特殊对象

## [中间件(Middleware)](/api/middleware)

- 处理消息[会话](#会话--session-)的回调函数，处理顺序与`Koa`的洋葱模型相同
