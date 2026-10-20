# Console Runtime

Console Runtime 负责控制台页面的注册、服务端分发、浏览器加载和挂载基础设施。它存在的目的，是让插件能贡献 UI，而不需要拥有控制台壳层或共享浏览器依赖。

## 语言

**PageManager**:
服务端控制台运行时，拥有 entry 注册、资源路由和控制台启动过程。
_避免使用_：console server、web manager、page registry

**EntryStore**:
某个 PageManager 实例存放 Console Entry 的目录。
_避免使用_：global registry、entries map

**Console Entry**:
插件提供的客户端模块声明，包含开发和生产入口。
_避免使用_：route、page、web entry

**Register Host API**:
传给 Console Entry 的 `register` 函数的浏览器侧 API。
_避免使用_：app API、plugin API

**Host API Factory**:
由宿主提供 React、addRoute、addTool 后，生成 Register Host API 的共享构造函数。
_避免使用_：host glue、plugin API builder

**Console Host**:
加载 Console Entry 并暴露共享 React/运行时服务的浏览器壳层。
_避免使用_：app shell、dashboard、frontend

**Bootstrap Loader**:
负责拉取 Console Entry、动态导入模块并调用注册函数的客户端 helper。
_避免使用_：plugin loader、entry loader

**Canonical ESM**:
由控制台服务端提供、供浏览器插件共享的 ESM 依赖身份。
_避免使用_：import map、peer shim

## 关系

- 一个 **PageManager** 拥有一个 **EntryStore**。
- 一个 **EntryStore** 包含零个或多个 **Console Entry**。
- **Console Host** 使用 **Bootstrap Loader** 拉取并注册 **Console Entry**。
- 每个 **Console Entry** 在浏览器侧接收一个 **Register Host API**。
- **Host API Factory** 让不同 **Console Host** 共享同一份 **Register Host API** 形状，只保留认证和入口 URL 等宿主差异。
- **Canonical ESM** 让 **Console Host** 和插件模块之间的共享依赖身份保持稳定。

## 示例对话

> **开发者：** “适配器可以静态调用 `PageManager.addEntry` 吗？”
> **领域专家：** “不可以。应该使用 `web` 上下文里的实例。**PageManager** 拥有自己的 **EntryStore**，不再提供静态注册路径。”

## 已标记歧义

- “entry”“page”“route” 曾混用。已决议：**Console Entry** 是模块声明；route 是之后通过 **Register Host API** 注册的浏览器路由。
- “global PageManager” 描述的是旧静态状态。已决议：**PageManager** 实例拥有相互隔离的 **EntryStore**。

