---
title: "官方适配器资料配置归属审计"
description: "配置按需生效首批适配器声明的源码依据与限制。"
sidebar: false
---

# 官方适配器资料配置归属审计

日期：2026-11-03。实施基线：`b708d40f154d3558eb90ef2a419b9a623c28ae3c`。对应 [配置按需生效方案](./configuration-live-update.md) C 切片与 [#1139](https://github.com/zhinjs/zhin/issues/1139)。

本轮逐一检查 `plugins/adapters/*/plugin.ts` 的 setup、被调用的 Console factory，以及生产代码是否消费 `config.nickname/profile`。22 个官方插件的 setup 均不根据资料字段建立业务状态，故增加纯声明：

```ts
configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] }
```

该结论对应上述实施基线。之后新增或尚未声明资料更新能力的适配器仍沿原有局部重载，不能仅凭“官方”身份推定支持原地更新。

| 插件 | setup 的实际行为 | 资料变更保留 setup 的依据 |
| --- | --- | --- |
| sandbox | 无 setup | 没有 setup 捕获 |
| icqq、napcat、onebot11 | 创建 Console RPC、注册平台权限检查 | 权限检查不从资料配置创建状态；Console 的受信操作从当次所属 Adapter 投影读取账号 |
| discord、telegram、slack、kook、dingtalk、lark、wecom | 创建 Console RPC、注册各平台权限检查 | 同上，未发现 nickname/profile 的 setup 消费 |
| email、milky、onebot12、satori、line、wechat-mp、weixin-ilink、bilibili-live | 创建 Console RPC | factory 只保存查询函数；传入的 resources 在这些 factory 中不用于资料初始化 |
| qq | 创建扫码绑定状态、Console RPC、平台权限检查，释放时取消扫码 | 扫码状态不依赖配置资料；资料变更不应撤销进行中的绑定 |
| github | Console RPC、注册 OAuth/订阅表结构 | 表结构与资料字段无关，不应因为昵称变化重新定义 |
| bilibili | 创建通知函数与 Console RPC | 通知函数捕获出站服务，不捕获资料配置 |

## 不能从声明推导出的能力

- `endpoints` 是允许进一步检查的前缀，不是无条件接受整个数组。Adapter 比较账号顺序、身份、连接字段与 slot 定义；只有纯资料差异才能保留 transport。
- 连接创建默认值仍是一次性输入；资料默认值按当前 snapshot 继承。已有账号库 desired 记录仍优先于文件启动种子。
- 多 Feature owner 的 Command 等索引必须按新 snapshot 重新投影，不能为避免重连而让它们读取旧 config。SDK transport 所属投影保留原 `GenerationAssets` 资产生命周期。
- `context.config.get()` 是 setup 时捕获的视图。现有 Console factory 的此 getter 仅作没有受信 runtime 操作视图时的只读 fallback；真实 Host RPC 的账号数据沿 `ownedConsoleAdapter` / `configurationView` 读取。不能将这个 getter 宣称为动态全局配置源。
- 不向未知第三方插件添加此声明。第三方若根据资料字段在 setup 构造业务状态，仍应重载，不得照抄声明后接受不一致状态。
- 资料更新不写真实平台昵称、头像或其他账号资料。平台 observed facts 仍优先，配置变化后显示平台原昵称并不表示配置更新失败。

## 本轮验证

- Adapter 包 20 个测试文件、305 个测试通过；包含纯资料 CAS、原门面不变、无重连、继承恢复、未知提交不重试、静态账号投影和统一发送入口。
- `config-profile-first-party.test.ts` 使用真实 ICQQ plugin definition/setup、真实 Adapter/Command Features 和假 SDK transport；声明存在时昵称更新保留同一 Client、连接次数和 setup 次数，Command 读取新配置，旧租约仍读旧配置；撤去声明时维持原有重载行为。
- 类型、定向 lint 与文档检查结果记录在任务验收中。以上是本地源码/合成验证，没有登录真实平台，没有调用真实 SDK 服务，也不代表 CI、发布或部署验收。
