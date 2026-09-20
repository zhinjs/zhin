# 实现分支参考

这个参考文件用于在标准插件工作流里判断应该走哪条实现路径，而不是把所有需求都套成同一种结构。

## 分支 1：最小插件

适用情况：

- 只新增 1 到 2 个命令
- 只加一个轻量中间件
- 没有数据库和 Web 页面
- 只有一个能力，且 helper 很少

建议做法：

- 保留最小 `plugin.ts`，能力仍放到对应命名目录，例如 `commands/ping/index.ts`
- 没有共享业务逻辑时不必额外创建 `services/`
- 使用 [最小插件骨架](../assets/minimal-plugin-template.ts) 作为起点

避免：

- 为了“标准化”平铺 5 到 6 个空目录
- 只因为未来可能扩展就过早抽服务层

## 分支 2：模块化插件

适用情况：

- 同时有多个命令或多个消息处理点
- 已经出现重复逻辑
- 有数据库、HTTP Host、多个 Resource 依赖
- 需要拆出服务层来承载业务规则

建议做法：

- 入口文件只负责装配
- 命令、中间件、服务按职责拆分
- 优先保持依赖方向单向：入口 -> 服务/命令，而不是互相引用
- 使用 [模块化插件入口骨架](../assets/modular-plugin-entry-template.ts) 起步
- 数据能力从 [数据库服务骨架](../assets/database-service-template.ts) 起步；HTTP 路由通过 `httpHostToken` 在 `setup()` 中注册并登记 disposer
- 涉及数据持久化时，先补模型定义，参考 [数据建模参考](./database-modeling.md) 与 [模型定义骨架](../assets/model-definition-template.ts)

避免：

- 让命令文件直接维护过多数据库或配置细节
- 在多个能力里重复解析 Host；应由 owner 在 `setup()` 中 provide Resource

## 分支 3：带控制台前端的插件

适用情况：

- 需要在控制台展示设置页或监控页
- 需要通过 `pages/<name>/index.tsx` 贡献 Remote Console 页面
- 服务端逻辑与页面交互需要明确分层

建议做法：

- 页面默认导出 React 组件，并命名导出 `meta = definePage(...)`
- 服务端数据通过 Console RPC/Host 能力提供，生命周期归 owner 管理
- 如果还需要命令和数据库，继续沿用模块化插件结构
- 页面结构参考 `docs/authoring/console-pages.md` 与 [控制台前端入口骨架](../assets/plugin-web-entry-template.tsx)

避免：

- 把 React 页面逻辑塞回服务端入口
- 用前端页面状态代替插件服务状态

## 分支 4：更像适配器而不是插件

出现以下特征时，不应继续走本 skill：

- 需要接平台协议、实现平台 Client 或 Endpoint 生命周期
- 需要处理平台原始消息到标准消息的转换
- 需要接平台网关、连接生命周期、发送或撤回协议

改用：

- `adapter-developer` agent

## 快速判断法

按顺序问自己：

1. 这个需求是否只需要少量命令或一个中间件。
2. 是否已经出现多个 Resource、数据库、HTTP Host 或重复逻辑。
3. 是否需要控制台页面。
4. 是否已经触及平台协议和 Endpoint 生命周期。

命中第 1 条：优先最小插件。

命中第 2 条：优先模块化插件。

命中第 3 条：在模块化插件基础上增加前端入口。

命中第 4 条：停止使用本 skill，切到适配器工作流。
