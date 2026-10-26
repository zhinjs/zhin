---
title: 行为定制实施计划
sidebar: false
---

# 行为定制实施计划

审计基线：`8a54a20ff5b5e3bea1c32e09eb127118fc5ceec6`（2026-10-26 main）。

交付跟踪：[Issue #979](https://github.com/zhinjs/zhin/issues/979)。

目标：插件作者只改目标行为，继续复用框架的权限、分页、平台适配和生命周期，不需要 fork、匹配内置文案或复制执行流程。

## 已确认的首轮范围

1. 命令反馈：定制参数错误、权限拒绝、冷却与繁忙的展示，不改变执行判定。
2. 菜单展示：替换布局，复用菜单条目计算、30 项分页、首尾按钮禁用和平台退化。
3. 渲染前展示偏好：按完整会话选择默认表达或文本表达，保留平台能力校验。
4. Root 显式选择策略。第三方可导出策略实现供 Root 组合；安装插件不自动获得全局覆盖权。
5. 未配置或返回 `undefined` 使用内置展示；策略抛错记录不含正文的诊断并回退内置展示。不重新执行业务、不重试已经尝试的投递，不新增专门的静默吞回复选项。

默认文案、权限、冷却、菜单可见性、投递目标和失败重试规则均不因安装此能力改变。策略影响当前操作持有的 generation，不能读取所谓“最新全局实例”。

## 已核实的问题与已有能力

| 用户需求 | 已有能力 | 当前缺口 | 首轮处理 |
| --- | --- | --- | --- |
| 把权限拒绝换成 JSX 卡片 | 分发结果已有 denied/invalid/limited；中间件能替换整条回复 | 结果在分发器内变成固定文本；中间件 continuation 不提供失败语义 | 专用只读反馈契约 |
| 换成自己的菜单排版 | menuStyle 已支持标题、副标题、强调色和背景图 | 固定布局；翻页按钮另走一条展示路径 | 只读页面模型与共同 presenter |
| 同账号不同群选择图文 | 适配器声明平台能力；出站中间件能替换最终载荷 | HTML 截图、Markdown 退化发生在出站中间件前 | 投影前解析展示偏好 |
| 最终文本加标识、移除 mention | 现有出站 replace/next 已支持 | 缺少按完整身份匹配的使用范例 | 补说明，复用现有机制 |
| 将不支持的 share 转成自定义链接 | 现有投影会严格拒绝不支持的段 | 拒绝发生在出站中间件前 | 后续语义变换候选，不顺带默认降级 |
| 给提醒增加企业工作日解析 | 提醒已有补问、确认、持久化与调度 | 自然时间解析没有公开替换契约 | 后续业务插件示范，另行确认 |

源码证据：

- [命令反馈生成](../../packages/im/core/src/plugin-runtime/im/message-dispatcher.ts)：结构化结果转换为固定文案。
- [入站结果与回复](../../packages/im/core/src/plugin-runtime/im/inbound-runtime.ts)：执行事实和实际内容作者需分别保留。
- [菜单计算](../../packages/im/command/src/command-index.ts)与[默认布局](../../packages/im/command/src/command-menu.ts)：已有 menuStyle；目录当前按 owner 列出，不等于按访问者权限过滤。
- [菜单分页](../../packages/im/core/src/plugin-runtime/im/command-menu-navigation.ts)：按钮直接 dispatch 后再展示，不经过 MessageDispatcher。
- [出站投递](../../packages/im/core/src/plugin-runtime/im/outbound-delivery-runtime.ts)与[平台投影](../../packages/im/core/src/plugin-runtime/im/outbound-projection.ts)：先投影后进入现有出站中间件。
- [Scope](../../packages/im/plugin-runtime/src/token.ts)：已有继承、重复绑定拒绝、封存和生命周期。默认实现不应预先占用供 Root 定制的资源键。

## 接口与所有权原则

采用业务含义明确的策略契约，继续使用现有 Resource 注册与 snapshot 读取。首轮不增加通用 hook 总线、任意方法 override、新调度器或新包。

- Root 在 `setup` 中通过 `context.resources.provide(token, implementation)` 选择实现；消费方从本次 snapshot 的 Root 资源读取。
- 默认实现是未定制时的路径，不在 Host 提前 provide，避免 Root 无法选择。
- 普通子插件提供同名资源不能自动覆盖其他实例或全局策略。跨实例生效必须由 Root 明确组合。
- 判定事实只读：展示实现不能改 matched/status、权限、冷却配额或平台能力声明。
- 内容作者由运行时决定。Root 选用的纯策略以 Root 为作者；被匹配命令仍保留自己的 owner。首轮不支持直接寻址 sibling 实例的私有 presenter/组件。
- 返回内容继续走一次统一发送链。策略契约不提供发送、重执行命令或修改投递目标的操作。
- 这些是可信插件的创作契约，不是 JavaScript 安全沙箱；不宣称能阻止任意用户代码自行产生副作用。
- 同一资源重复绑定沿用现有报错；需要组合多个条件时由 Root 选择函数明确组合，不新增隐式优先级。

对比：通用 hook 会引入短路、顺序和决定权的额外规则；任意 capability 装饰又需要同时解决路由、权限及执行 owner。首轮三个问题均有明确的业务位置，专用策略足以覆盖。

## 分工与交付顺序

| 切片 | 负责人 | 改动位置 | 交付与验收 |
| --- | --- | --- | --- |
| A 命令反馈 | Commands Agent | Core feedback、dispatcher、inbound | 只读反馈输入，文字/JSX 输出；执行事实与回复作者分离 |
| B 菜单展示 | Composition Agent | Command 页面数据、Core menu navigation/presenter | 首次与按钮翻页共用 presenter；默认布局和 menuStyle 保持 |
| C 展示偏好 | Delivery Agent | Core outbound presentation/projection/delivery/preview | 一次发送解析一次偏好；初次与 replace 后投影一致；纯文本不截图 |
| D 集成与交叉审查 | 主 Agent | 公共导出、文档、测试、changeset、PR | 三个接口的使用方式一致；构建包消费者和真实运行链验证 |

A、B、C 可并行修改各自文件。公共导出和跨切片调用点由主 Agent 统筹，避免同时修改同一文件。集成后再检查全部受影响入口；通过后在 issue 分支提交中文 PR，不在 main 提交，不自动合并、发版或创建持续跟进任务。

当前状态：三个切片已实现，源码与集成回归通过；提交后的 PR 审查及 CI 记录在 Issue 中更新。尚未发布，也未验证真实平台。

## 首轮接口草案

以下为本分支已实现的接口，尚未发布。使用说明与经过运行验收的示例见[定制内置展示](../authoring/behavior-customization.md)。

| 入口 | 接口职责 | 作者门面 |
| --- | --- | --- |
| `commandFeedbackToken` | invalid/denied/limited 的只读原因与场景 → SendContent 或 undefined，可异步 | `zhin.js/command` |
| `commandMenuPresentationToken` | 当前页条目、分页和文本退化信息 → SendContent 或 undefined，可异步 | `zhin.js/command` |
| `outboundPresentationToken` | 完整会话、requester 和 generation → default/text 偏好 | `zhin.js/middleware` |

展示偏好首版使用同步纯决策，便于发送与只读预览共用；`default` 沿用当前平台策略，`text` 选择文本表达，不允许伪造 native/direct 能力。它不执行任意中间件、截图或真实按钮注册。

菜单自定义只消费页面模型；导航按钮和其有效期继续由 Core 管理。每页 30 项及页码校验继续由 Command 管理。反馈策略不包含普通命令成功内容或独立的“正在处理中”提示。

## 集成验收

### 默认与隔离

- 不配置策略时，现有文案、菜单样式、分页、消息段和错误结果保持。
- Root 绑定生效；子实例同名资源不改变全局行为；安装策略包而未绑定不生效。
- 匹配完整 endpoint、kind、id、parent、thread，不能只按平台名或群号。
- 策略只拿到所需只读视图，不拿原始 Message 的发送方法或整个 snapshot。

### 命令与菜单

- denied、invalid、limited 定制后业务执行零次，执行状态/限流事实不变，最多一次自动回复。
- Root 的注册组件按 Root 作者解析，不借用被拒绝命令的组件权限。
- 首页、上一页、下一页均使用同一 presenter；保留自定义关键词/前缀/插件路径、30 项边界、首尾禁用。
- 保留现有 opaque continuation 与 `return next()` / `await next()` 行为。
- 策略未处理或抛错回默认；不重新 dispatch，不自动调用模型。

### 多平台发送

- 同一 endpoint 两个会话可选择不同偏好；纯文本模式 HTML renderer 调用次数为零。
- `envelope.replace(JSX)` 后仍使用同一次发送解析出的偏好；没有重复添加内容或重复执行策略。
- 不支持的段仍按现有规则拒绝；图片、Markdown、按钮不可用时遵循已有能力协商。
- 按钮仅对最终载荷激活；被替换的按钮不残留；预览不注册按钮、不发送。
- 最终投递最多一次，unknown 绝不自动重发。自定义策略失败回退只发生在投递前。

### 生命周期与证据

- 在途请求保持旧 snapshot，新请求使用已提交的新代；失败候选不污染旧代；移除绑定恢复默认。
- 异步反馈/菜单完成后沿用现有 operation 与交互有效性检查；在途旧代请求可以排空，generation 退役不等于取消已接纳的回复。不新造独立取消状态机。
- 以真实 dispatcher/inbound/outbound 集成边界和 PluginTestKit 的合成 endpoint 验证，不只测策略纯函数；单元测试 fake 不等于完整消息链。
- 补公共导出与发布包消费者类型验证、近邻文档、中英文使用说明以及 patch changeset。
- 区分源码审计、模拟端点集成、本地截图、CI 与真实平台；本轮未经另行授权不发送真实平台消息或调用真实模型。

## 留待后续决定的能力

- 菜单是否仅显示访问者当前有权执行的指令：这是可见性规则变化，首轮不改。
- 任意语义 Segment 变换：可解决 share→链接等需求，但要先明确执行次数、内容作者与最终审核顺序。
- 进度提示定制：它走独立 timer/reply 路径，需单独覆盖停止与取消。
- 提醒自然时间解析器：作为业务层 tweak-in 代表；企业日历、语言与失败退路需另行确认。
- Agent 的事件观察 Hook 与内部执行决策 Hook 分开评估，首轮不提升公开 Hook 的控制权限。

后续每新增一个契约，至少以默认实现和一个独立定制实现证明它解决实际差异，并提供不 fork 的可运行例子；不为了数量提前铺设 hook。
