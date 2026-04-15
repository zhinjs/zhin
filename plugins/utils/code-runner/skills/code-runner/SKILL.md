---
name: code-runner
description: 在线代码执行：支持 Python、JavaScript、TypeScript、Go、Rust、Java、C/C++、Ruby、PHP 等语言的沙箱运行。
keywords:
  - code
  - run
  - 运行
  - 代码
  - execute
  - sandbox
  - python
  - javascript
  - 编程
tags:
  - code-runner
  - development
  - sandbox
tools:
  - run_code
---

## 工具概览

| 工具 | 说明 |
|------|------|
| `run_code` | 执行代码片段（语言 + 代码） |

## 执行规则

- 代码长度限制 10000 字符
- 执行超时 30 秒
- 支持语言：python, javascript, typescript, go, rust, java, c, cpp, ruby, php
- 通过 glot.io API 隔离执行，不影响本地环境
