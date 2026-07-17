# @zhin.js/next-isolate

下一代 Zhin Runtime 的可选 Node 隔离适配器。它为每个 `runtime: isolated` Plugin generation 创建独立 Worker 或 child process，并只通过 structured-clone RPC 与 Host 通信。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 为什么独立成包

`@zhin.js/next-runtime` 只定义 `IsolatedPluginRuntimePort`，不强制默认 IM 安装携带隔离实现。需要故障或并发隔离的 Root 显式安装本包；trusted Plugin 的启动路径和生产闭包不变。

本包没有第三方运行时依赖，只使用 Node 的 `worker_threads`、`child_process` 和 IPC。它不依赖 Vite、编译器、CSS 工具或 native/wasm 模块。

## 使用

```ts
import { NodeIsolatedPluginRuntime } from '@zhin.js/next-isolate';
import { RootRuntime } from '@zhin.js/next-runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules,
  environment,
  isolation: new NodeIsolatedPluginRuntime({
    mode: 'worker',
    hostMethods: {
      audit(input, { owner }) {
        return auditLog.write({ owner, input });
      },
    },
  }),
});
```

child Plugin manifest 显式选择隔离：

```json
{
  "name": "@acme/reports",
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "runtime": "isolated",
    "entry": "./plugin.js"
  }
}
```

Root Plugin 负责整个进程生命周期，因此不能使用 `runtime: isolated`。

## Plugin 通道

隔离 Plugin 只能要求 `isolatedChannelToken` 和 `runtimeEnvironmentToken`。Host Scope、数据库、EnvStore 与自定义 Token 不会隐式复制到隔离侧；需要的数据应进入 owner config，操作应成为显式 allowlist RPC。

```ts
import { definePlugin } from '@zhin.js/plugin-runtime';
import { isolatedChannelToken } from '@zhin.js/next-isolate';

export default definePlugin({
  name: 'reports',
  requires: [isolatedChannelToken],
  setup({ resources, config }) {
    const channel = resources.use(isolatedChannelToken);
    return channel.expose('render', async (input) => ({
      report: await render(input, config.get()),
    }));
  },
});
```

Host 从对应 owner 的 Resource snapshot 取得 `isolatedPluginToken`，再调用 `handle.call()`。输入、输出、事件与 config 都必须可 structured clone；函数、socket、数据库连接等对象会在发送前被拒绝。

## 代际切换

适配器参与 Runtime generation handoff：

1. `prepare` 创建候选 isolate、import entry 并校验 definition，但不执行 setup。
2. `quiescePrevious` 停止旧 handle 接收新调用，并等待所有已接收 RPC 完成。
3. `activateNext` 在候选 isolate 内执行 setup；失败会清理候选并恢复旧 handle。
4. Runtime 原子提交 snapshot 后，`openNext` 才开放新 handle。
5. 旧 generation 的最后一个 lease 释放后，Scope disposer 终止旧 isolate。

RPC 超时会把整个实例标记为 failed 并终止 transport，因为远端工作可能仍在运行，不能把超时伪装成安全 drain。Worker/进程意外退出会拒绝全部 pending RPC，并通过 `onCrash` 上报；当前 generation 内不静默重启。

## 隔离边界

这是故障和并发隔离，不是安全沙箱。Worker 与 child process 仍拥有启动用户授予 Node 进程的文件、网络和系统权限。运行不可信代码需要在 Host 外再叠加容器、OS account、permission model 或其他真正的 sandbox。

普通 Feature definition 含函数、Endpoint 和闭包，不能安全 structured clone。因此 isolated Plugin 当前不能 mount Host Feature provider。未来跨边界 Feature 必须提供显式 codec/代理契约，不能序列化任意函数来绕过边界。

## 开发验证

```bash
pnpm --filter @zhin.js/next-isolate test
pnpm --filter @zhin.js/next-isolate build
pnpm --filter @zhin.js/next-isolate check:size
```

## 相关文档

- [隔离 Plugin Runtime ADR](../../../docs/adr/0049-isolated-plugin-runtime.md)
- [Next Runtime](../runtime/README.md)
- [Greenfield Bootstrap 状态](../../../docs/architecture/target-implementation/greenfield-bootstrap.md)
