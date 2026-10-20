---
title: 消息场景试验台
description: 在 Console 本地预览预期消息，导出场景并在独立可信测试项目运行真实 PluginTestKit 回归。
---

# 消息场景试验台

## 只是想看看消息会是什么样？

在 Console 打开「消息场景试验台」（`/scenario-lab`），填写来源、发送者、入站文本和作者预期输出。文字直接显示；Markdown 支持标题、段落、列表、引用、代码块和简单表格，超出子集的内容按源码显示。

页面不执行插件、组件或业务工具，不调用 Host 渲染接口，不发送或重放消息，也不注册按钮回调。HTML 只展示源码，不调用 Shotium；媒体显示占位，不读取本地文件或请求远程资源；按钮只展示禁用状态。

「纯文本端点」和「HTML / Markdown 保留」是**合成端点的测试能力配置**，不是某个平台的外观承诺。Markdown 的可读预览不证明平台原生渲染；HTML 源码也不代表已生成图片。最终转换和投递仍需在对应层次验证。

账号完整 ID、适配器标识、会话类型与 ID、父容器、话题都由你明确填写，示例身份不代表当前 Host 已登录的账号。页面不读取生产配置或保存草稿，离开前可导出 `scenario.json`；不要填写凭据。

## 为什么预期输出填了，还不能导出回归？

`preview` 用于查看**作者预期外观**；`assertions` 是作者单独填写的**最终派发与投递断言**，两者不会自动互相推断。

| 字段 | 用途 |
| --- | --- |
| `sourceTarget` | 完整来源身份：`endpoint.id`、`endpoint.adapter`、`kind`、`id`，以及可选 `parent`、`threadId` |
| `sender` | 测试发送者；省略 `roles` 与显式 `roles: []` 分别保留，均不证明真实平台角色 |
| `input` | 将来交给真实 `PluginTestKit.receive()` 的文本；页面内不派发 |
| `preview` | 作者填写的原生 JSON `Segment[]`，不接受 JSX 源码、函数、组件调用或 `raw` |
| `fixture` | 明确的合成账号别名与 `configVersion: 2` 独立测试配置 |
| `assertions.dispatchStatus` | 明确预期的 `executed`、`invalid`、`denied`、`unmatched` 或 `limited`；`limited` 需要支持此状态的 Runtime |
| `assertions.deliveries` | 每项为一条最终 payload（字符串或原生段数组）；`[]` 明确断言没有投递 |

只有补齐测试配置、账号映射、入站文本和明确断言，才能导出 `scenario.test.mjs` 与运行说明。缺少这些时仍可导出合法的场景 JSON，不会生成跳过测试、空断言或伪装为已通过的用例。

权限拒绝也可能产生回复，不能把 `denied` 自动等同于零投递。例如下方测试项目会回复 `没有权限执行此指令。`，拒绝场景应把这条最终 payload 写进断言。

## 怎样准备一个能实际运行的独立测试项目？

使用 Node.js `>=22.19.0`，新建一个**可信、没有生产配置与凭据**的目录。不要指向正在运行的 Bot 项目，也不要挂载真实适配器。

先写 `package.json`：

```json
{
  "name": "message-scenario-fixture",
  "private": true,
  "type": "module",
  "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts" }
}
```

在该目录安装实际依赖：

```bash
pnpm add zhin.js @zhin.js/command
pnpm add -D @zhin.js/testing @zhin.js/plugin-runtime @zhin.js/adapter tsx
```

`plugin.ts`：

```ts
import { definePlugin, Schema } from 'zhin.js';

export default definePlugin({
  name: 'scenario-fixture',
  config: Schema.object({ commandPrefix: Schema.string().default('') }),
});
```

`commands/hello/index.ts`：

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  permit: ['role(admin)'],
  execute: ({ input }) => [{
    type: 'text',
    data: { text: '你好，' + (input.sender?.name ?? input.sender?.id ?? '访客') },
  }],
});
```

在试验台填写以下场景，或将其作为 JSON 导入。独立测试配置只声明 `configVersion: 2`，没有生产插件挂载或凭据：

```json
{
  "schemaVersion": 1,
  "name": "完整来源身份与原生文本回复",
  "sourceTarget": {
    "endpoint": { "id": "root/source\u0000zhin.adapter\u0000example", "adapter": "example" },
    "kind": "channel",
    "id": "test-room",
    "parent": { "kind": "channel", "id": "test-workspace" },
    "threadId": "test-thread"
  },
  "sender": { "id": "test-author", "name": "测试成员", "roles": ["admin"] },
  "input": "hello",
  "preview": [{ "type": "text", "data": { "text": "你好，测试成员" } }],
  "profile": "text",
  "fixture": { "syntheticEndpoint": "scenario", "config": { "configVersion": 2 } },
  "assertions": {
    "dispatchStatus": "executed",
    "deliveries": [[{ "type": "text", "data": { "text": "你好，测试成员" } }]]
  }
}
```

分别下载 `scenario.json`、`scenario.test.mjs` 和 `README.md`，放在这个测试项目根目录。Linux/macOS 终端显式运行：

```bash
ZHIN_SCENARIO_FIXTURE_ROOT=/absolute/path/to/test-app node --conditions=development --import tsx --test scenario.test.mjs
```

PowerShell：

```powershell
$env:ZHIN_SCENARIO_FIXTURE_ROOT = 'C:\path\to\test-app'
node --conditions=development --import tsx --test scenario.test.mjs
```

必须提供测试项目的绝对路径；不会回退到当前目录或生产配置，也不会自动安装依赖或执行。套件和测试项目使用的 Feature Provider 必须来自同一个物理包实例；不要混用 Vite 加载的模块与原生 Node 加载的另一份 Provider。完整工具说明见[插件测试](./testing.md)。

## 来源账号会被真的调用吗？

不会。`sourceTarget.endpoint` 仅保留来源身份；导出的测试显式把它映射到 `fixture.syntheticEndpoint`。合成端点的完整身份由正式 `capabilityId(rootPluginId(), adapterFeatureId, alias)` 生成，不用生产账号 ID 冒认测试端点。

会话的 `kind`、`id`、`parent`、`threadId` 与发送者保留不变，缺少父容器或话题不代表通配。测试比较每条实际捕获的完整目标与最终 payload。首版导出的断言要求所有输出回到该来源会话的合成账号映射；主动跨会话发送需要另写测试。

`PluginTestKit` 会实际运行模块发现、命令解析、权限和发送链路，再由合成端点记录最终载荷。它**不是安全沙箱**：插件的 `import`、`setup()`、自定义逻辑仍能访问宿主文件、联网或启动真实适配器。独立目录和空凭据配置不能阻止任意代码访问宿主；请只运行可信 fixture，并自行提供独立测试数据和不含生产凭据的执行环境。此功能不提供远程隔离运行器。

## 通过后能证明什么？

导出文件不证明插件通过；实际运行通过，只证明这份测试项目、测试角色、能力配置和明确断言下的 Runtime 行为。它不证明真实平台登录、角色映射、图片效果或消息送达。

仓库的[集成验收脚本](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/testing/tests/run-scenario.mjs)运行的是 Console 实际导出的文件：验证成功回复、完整父容器与话题、空/省略角色的权限拒绝、未命中、前缀不匹配，以及故意写错输出时断言确实失败。浏览器预览、合成端点回归和实机发送分别记录证据，不把其中一层当成另一层。
