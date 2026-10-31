---
title: "适配器开发"
description: "为 Zhin 还不支持的平台编写适配器：最小实现、连接与清理、收发消息、多账号，原生 Client 与框架钩子的职责"
---

# 适配器开发

适配器把一个聊天平台接入 Zhin。**只有当你要接入的平台还没有官方适配器时，才需要读这一页**；已支持的平台见 [平台适配器](../adapters/index.md)。

适配器只做三件事：

1. 创建平台 SDK 的客户端（Client）；
2. 把平台事件转换成 Zhin 的统一消息；
3. 把 Zhin 要发出的消息转换成平台 API 调用。

热重载、账号身份、版本切换和资源清理都由框架负责。

## Adapter API 2 的版本边界

本批仍以 npm patch 发布，但包含明确的插件接口变更。首批目标版本为
`zhin.js 1.1.19`、`@zhin.js/core 1.1.54`、`@zhin.js/adapter 1.1.26`、
`@zhin.js/feature-kit 1.1.10`（发布前以正式发布清单为准）。旧接口支持到这些版本之前；
新插件需要同时满足这组 npm 依赖下限，并声明 Adapter Feature API：

```json
{ "features": [{ "package": "@zhin.js/adapter", "api": "^2.0.0" }] }
```

这里的 `api` 位于 `package.json#zhin.features`。它与 npm 包版本、`zhin.engine` 是不同的
契约。新 Provider 的 `featureApi` 是 `2.0.0`：旧的显式 `api: ^1.0.0` 会被拒绝，新插件在
旧 API-1 Provider 上也会被拒绝。未声明 `api` 的历史包保持原有行为，不代表已经确认兼容。
自定义插件需要重新编译、更新 peer/dev 下限，并验证实际安装组合；完整说明见
[版本兼容与迁移](../operations/upgrades.md#adapter-api-2)。

## 最小实现

在插件里创建 `adapters/<平台名>/index.ts`，默认导出 `defineAdapter()`：

```ts
// adapters/terminal/index.ts
import { Adapter, defineAdapter } from 'zhin.js/adapter';
import { TerminalEndpoint } from './endpoint.js';

interface TerminalConfig {
  readonly terminal?: { readonly interactive?: boolean; readonly prompt?: string };
}

class TerminalAdapter extends Adapter<TerminalEndpoint, TerminalConfig, { readonly line: string }> {
  protected createEndpoint(config: TerminalConfig): TerminalEndpoint {
    return new TerminalEndpoint({
      input: process.stdin, output: process.stdout, error: process.stderr,
      interactive: config.terminal?.interactive ?? true,
      prompt: config.terminal?.prompt ?? 'zhin> ',
    });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly terminal: TerminalAdapter; }
}

export default defineAdapter<TerminalConfig>({
  capabilities: ['inbound', 'outbound'],
  createAdapter: () => new TerminalAdapter(),
});
```

适配器包需直接依赖 `@zhin.js/feature-kit`，类型增补只写在该模块；自定义发布包可用 peer 加开发依赖，官方适配器的精确内部 dependencies 同样有效。`zhin.js/adapter` 仍提供 Adapter API；业务 Command 加载一次适配器声明后，只需填写平台名。

`TerminalEndpoint` 继承真正拥有终端 IO 的 `TerminalClient`，并 `implements Endpoint`；完整定义见 [终端示例](https://github.com/zhinjs/zhin/blob/main/examples/minimal-bot/adapters/terminal/index.ts)。平台有 SDK 时继承真实 SDK Client；没有 SDK 时，Client 应真正拥有协议 IO、请求和取消，不能只是回调 Endpoint 的空壳。

| 部分 | 作用 |
| --- | --- |
| `capabilities` | 声明收、发或两者；直播弹幕另加 `liveDanmaku`，需同时声明 `inbound` |
| `createAdapter(context)` | 创建所属插件的 Adapter，接收配置和注入依赖 |
| `Adapter.createEndpoint(config, execution)` | 只在账号启动时构造真实 Endpoint；execution 固定 canonical identity、instance 和取消信号 |
| `Endpoint` | 只有结构 interface，框架不提供公开可继承基类 |
| `[endpointSpec]` | 通过 `createEndpointSpecification(this, hooks)` 绑定框架钩子，不覆盖原生 SDK API |
| `events.message()` | 上报规范化消息，框架补全账号身份；发送者只能来自真实用户身份 |
| specification 的 `send()` | 转换并发送消息，返回确认的消息 id 或有序 `{ parts }` 证据 |

## 常见需求

### 让 Bot 能收到这个平台的消息

把适配器所在的插件挂载到 Bot 上，并在 `zhin.config.yml` 里填写配置：

```yaml
configVersion: 2
plugins:
  terminal: '@example/adapter-terminal'
terminal:
  terminal:
    interactive: true
```

启动后在 Console 的"聊天账号"里确认账号在线、消息能收到。完整的挂载方式见 [第一个插件 · 挂载到你的 Bot](../getting-started/first-plugin.md)。

### 一个适配器挂多个账号

不需要改代码。在配置里写 `endpoints` 数组，每一项会创建一个独立的账号连接，所属 Adapter 的 `createEndpoint(config, execution)` 拿到合并后的单账号配置。规则见 [端点生命周期 · 一个适配器挂多个账号](./endpoint-lifecycle.md#一个适配器挂多个账号)。

### 只允许当前版本持有的监听器

将需要独占的监听器订阅放在 specification 的 `open` 钩子，在 `close` 中解除，`stop` 最终释放 IO。不要另建全局 live Endpoint Map。已经接纳的完整回调由 `events.run` 跟踪，关闭边界见下文。

### WebSocket / SSE 长连接、心跳与重连

不要自己写重连状态机，使用 [`createEndpointLifecycle`](./endpoint-lifecycle.md)。

### 平台特有的消息格式

`share`、音频、卡片等平台特有结构，在 specification 的 `send()` 边界里转换成平台格式。插件发消息仍然统一走 `Message.$reply` 或 Host 的 `outboundHostToken`，不要另开发送通道。

### 在聊天里管理账号

用 `createEndpointCommands` 为适配器生成 `<适配器> endpoint list / add / remove` 命令，见 [命令 · 适配器的 endpoint 管理命令](./commands.md#适配器的-endpoint-管理命令)。

## 继承平台 Client 与账号所有权

平台统一定义 `Adapter<E, Config, Events>` 子类，由它创建与管理所有 Endpoint。Endpoint 继承实际 SDK Client，并通过 `endpointSpec` / `createEndpointSpecification` 注册框架钩子；不覆盖 SDK 的 `on`、`off`、`emit`。通过唯一增补入口 `@zhin.js/feature-kit` 的 `AdapterRegistry` 注册一次 Adapter 类型，Command 的字符串平台声明即可推导子类与 Endpoint。

新增账号只保存停用配置，不创建 SDK 对象；显式启动才连接。停止、更新、删除和替换都由所属 Adapter 控制。更新运行账号只重连该账号，旧操作固定到原 incarnation。`defineAdapter` 只接受 `createAdapter`；不要另建全局账号 Controller、Client token 或可写 Endpoint 目录。

SDK 的 `emit/on/off` 与原生方法保持原合同。通过 `AdapterRegistry` 的 `Adapter<Endpoint, Config, Events>` 泛型一次推断 Client 和 EventMap；公开导出重用同一个 registry，不另注册 Client descriptor 或 token。

对应的适配器类型声明须进入 TypeScript 编译项目。同项目的适配器目录会自然参与；跨包可在 `tsconfig` 的 `compilerOptions.types` 加载适配器包，或在项目入口导入一次包类型。之后每条 Command 只写 `adapter: 'icqq'`，无需导入具体 Adapter 类；运行时加载插件不会自动改变编辑器的类型项目。

## 完整接纳一次 SDK 回调

在 SDK listener 入口用 `events.run(async () => { ... })` 包住整个异步回调，包括解析、原生事件转发和规范化消息提交，并等待或处理它返回的 Promise。只给最后一次 `events.message()` 加包装，不能覆盖此前仍在进行的解析或读取。

`close` 先关闭新的框架接纳，再调用平台关闭钩子，并等待已经接纳的回调及其规范化延续结束；`stop` 先退休该 incarnation 并取消信号，再排空操作租约、释放资源。平台请求也要响应这个信号。不要从本账号自己的入站回调同步等待其 `close/stop`，这会自等并被框架拒绝。

原生事件指 SDK 公开事件与它实际给出的对象：保留同一事件 payload，不删字段、不从规范化消息反推。它不等于原始 wire packet；SDK 没有公开的加密帧、HTTP bytes 或内部对象，不能宣称已经保真暴露。XML webhook、ParsedMail 等由平台自行解析的输入也应在原始事件路径保留实际原对象。

`events.message()` 负责规范化消息；`events.platform(name, event)` 保留平台原生事件。需要等实际准入和派发完成后再确认游标或 ACK 时，使用 `events.emitAccepted()`，失败不得推进游标。长连接重连与心跳仍用 `createEndpointLifecycle`，详见 [生命周期钩子](./endpoint-lifecycle.md#endpoint-的生命周期钩子)。

## 参考实现

- [`examples/minimal-bot/adapters/terminal/index.ts`](https://github.com/zhinjs/zhin/blob/main/examples/minimal-bot/adapters/terminal/index.ts)：把终端当作一个聊天平台，适合对照学习。
- [`plugins/adapters/napcat`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/napcat)：WebSocket / HTTP 多种连接方式，使用 `createEndpointLifecycle`。

## 下一步

- [端点生命周期](./endpoint-lifecycle.md)：长连接、心跳、重连与多账号。
- [消息流](../concepts/message-flow.md)：消息在框架里的完整路径。
- [插件完整交付](./plugin-delivery.md)：用 adapter harness 测试并发布适配器。

## AI 能力与场景说明

适配器拥有平台能力声明，Agent 不应维护另一份平台操作清单：

- Tool 的 `description`、`inputSchema`、`platforms / scopes / permissions` 描述一个操作。
- `agents/<platform>/skills/<name>/SKILL.md` 按用途和场景组织操作，正文仅在加载后披露。
- `prompt-sections/<name>/index.ts` 承载必要的共同约定，使用 `platforms` 和 `scopes` 限定，不重复罗列 Skill/Tool 清单。
- `segments.supported` 声明出站段，`segments.model[type]` 提供模型扩展字段、平台 `hint` 和可选 `scopes`。场景不匹配时，模型既看不到该段 Schema，也看不到其提示；这不授予发送权限，也不改变手写消息的发送策略。

以下声明表示模型只在群聊获得 share 卡片能力；其他场景仍保留通用文本和已有降级能力。不要根据名称推测平台支持，声明需与实际发送实现一致。

```ts
segments: {
  supported: ['text', 'share'],
  model: {
    share: {
      scopes: ['group'],
      hint: 'Use a real URL and title from the user or tool results.',
    },
  },
}
```

`text` 始终保留为通用回退；若为它声明场景，只限制扩展字段和提示。
