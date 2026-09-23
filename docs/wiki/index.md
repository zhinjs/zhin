---
title: Zhin 知识索引
---

# 从问题开始

这里记的是使用 Zhin 时反复遇到的问题，以及当前可以核对的答案。第一次接触项目，先从“Bot 跑通”开始；已经有项目，就直接找正在卡住的环节。

## 开始使用

- [怎样确认第一个 Bot 真的跑通了？](./notes/first-run) 从创建项目走到 Sandbox 收到 `/hello` 回复。
- 配置项放在哪里，见[配置指南](/configuration/)；拿不准该走哪条路线，见[解决方案](/solutions/)。

## 开发插件

- [一个能力该写进约定目录，还是 `plugin.ts`？](./notes/plugin-entry) 按是否需要共享资源和生命周期来选。
- 具体文件名与目录结构，见[约定目录](/authoring/conventions)。

## 消息与适配器

- [消息从哪里进入，又从哪里发出？](./notes/message-path) 找到中间件、命令、回复各自所在的位置。
- 接入真实平台时，从[适配器索引](/adapters/)找到对应平台的配置与限制。

## AI 与工具

- [工具为什么看不到，或者一直在等审批？](./notes/tool-access) 分清安装、准入、发现与执行审批。
- 还没启用 AI 的项目，先看[AI 模块安装](/ai/)；IM Bot 本身不需要模型 Key。

## 运维

- [进程已经启动，怎样确认 Bot 真正可用？](./notes/production-ready) 分别检查存活、运行时就绪和平台收发。
- 具体部署与故障处理，见[生产部署](/operations/production)和[故障排查](/troubleshooting/)。

## 资料存档

[Cubic Wiki 的 29 篇原始文章、中文译文和已确认勘误](./archive)保留在原 URL。这批内容适合查找线索；运行时行为以当前文档和源码为准。
