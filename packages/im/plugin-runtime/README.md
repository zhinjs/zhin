# @zhin.js/plugin-runtime

Zhin Plugin-first 架构的零生产依赖底座。它定义 Plugin tree、Scope、Capability Slot、
不可变 RuntimeSnapshot、generation lease、handoff 与 RootController，不理解 IM、Agent、
配置格式、文件发现或构建工具。

```ts
import {
  createToken,
  definePlugin,
  RootController,
} from '@zhin.js/plugin-runtime';
```

`PluginSetupContext.addFeature(feature, localName, definition)` 是约定目录之外的内存
Capability 写入口。它仍由上层 Runtime 交给对应 Feature provider 校验和投影；Feature
通过 `authoring.setupMethod` 和 module augmentation 提供强类型 `addCommand`、
`addComponent`、`addTool` 等别名。底座只保存通用注册记录，不理解 IM。

## 生命周期

```text
prepare shadow state -> validate -> handoff -> atomic commit
  -> new work leases new snapshot -> old generation drains -> dispose
```

局部 HMR 只缩小 prepare/setup/dispose 范围；每次 commit 始终发布完整一致的 snapshot。
长期 socket、worker 或 admission loop 必须参加 generation handoff，不能成为模块级副作用。

本包没有生产依赖。YAML、AJV、watcher、IM 与 AI 都属于上层 adapter 或 Runtime。

## 可选管理员任务端口

`PluginTaskProvider` 与 `pluginTaskProviderToken` 定义插件自己的管理员任务服务：插件通过 `provide()` 发布，Host 从当前运行代的所属 Scope 读取，不额外建立调度器。聊天发送者的个人任务不进入这个端口。

任务快照包含真实任务、`revision` 与有界持久 `receipts`。创建或修改提交客户端操作 UUID 和原 `expectedRevision`；同一操作必须按相同内容幂等核对，不同内容复用 ID 或过期版本均应拒绝。回执确认的是持久命令，不是外部消息投递。未拿到响应时先只读核对，不能自动重发。服务必须携带 `generationAdmissionSource` 并参与实例退役。

`PluginTaskError.message` 是可以向管理员展示的业务说明，不应含凭据或原始异常。Host 自己的输入、权限与运行代校验使用固定说明，普通异常不直接暴露。任务使用已有 `DeliveryTarget` 保留完整账号、会话、父容器与话题；`actions` 只列实际支持的操作，`unknown` 状态不能被包装成可安全重试。

验证：`pnpm --filter @zhin.js/plugin-runtime test && pnpm --filter @zhin.js/plugin-runtime build`。

详细契约见 [Kernel 与 Generation](../../../docs/architecture/target-implementation/kernel-and-generation.md)。
