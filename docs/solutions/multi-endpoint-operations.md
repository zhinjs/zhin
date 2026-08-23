---
title: 多 Endpoint 运营
---

# 用多个账号运营同一套业务

适合需要跨平台、同平台多账号或测试与生产隔离的团队。交付结果是一套业务能力、多条独立连接，以及能定位到具体 Endpoint 的运维链路。

## 设计边界

Adapter 定义平台协议，Endpoint 表示一个具体账号或连接。命令、组件和中间件属于插件 generation，不复制到每个账号，也不读取平台私有 SDK。

## 实施步骤

1. 在 Sandbox 验证命令与消息输出。
2. 运行 `npx zhin setup --adapters`，为每个真实平台安装适配器。
3. 为账号创建独立 Endpoint 配置；凭据只放环境变量。
4. 启动后在 Console 的“会话与频道”逐个发送测试消息。
5. 在“运行时能力”确认每个 Endpoint 的 `operations`，不要假定同一适配器的所有连接模式能力相同。
6. 在“日志”按级别和连接上下文排查，在“系统概览”确认 Host 与推送状态。

## 验收清单

- 关闭任一 Endpoint 不影响其他账号。
- 相同命令在 Sandbox 与目标平台产生等价业务结果。
- 不支持撤回、reaction 等操作时，界面按能力降级而不是调用私有 SDK。
- 生产 HTTP Host 设置 token，平台密钥不出现在配置仓库或 Console Demo。

下一步查看[适配器选择](/adapters/)与[Console 管理路径](/paths/console)。
