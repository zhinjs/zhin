---
title: 结构化决策
description: 为多个判断模型创建 Profile，按用途选择真实 Choice、Score 与 Noul 服务。
---

# 结构化决策

结构化决策模型处理有明确候选和评判标准的问题，例如工具／Skill 推荐、记忆排序、Agent 选择、审批辅助和旁听判断。它只返回推理证据，不扩大权限；实际激活、审批和执行仍由业务模块负责。

## 配置多个模型

安装对应 Driver 插件，例如 `@zhin.js/service-typesafe`，然后在 Console 创建 Service、Account 和 `decision` Profile。与聊天模型共用同一个目录和持久化机制，不再绑定全局唯一的决策 owner。

TypeSafe 导入提案示例：

```yaml
# ai.plan.yml
version: 1
services:
  decisions:
    driver: typesafe
    models:
      your-decision-model:
        id: your-decision-model
        kinds: [decision]
        protocol: typesafe-system-one
accounts:
  first:
    service: decisions
    auth:
      method: api-key
      source: env://TYPESAFE_API_KEY
profiles:
  fast:
    account: first
    model: your-decision-model
    parameters:
      timeoutMs: 3000
  careful:
    account: first
    model: your-decision-model
    parameters:
      timeoutMs: 5000
purposes:
  decisions:
    tools:
      profile: fast
      mode: shadow
    approval:
      profile: careful
      mode: active
```

示例模型 ID 必须替换为服务实际支持的值。Driver 的当前安装实例必须可唯一识别；同名 Driver 来自不同插件时，预览要求指定 `{ id, owner, contractVersion }`，不会选择最新一个。

## 各用途独立工作

六个用途是 `skills`、`tools`、`memory`、`agents`、`approval` 和 `ambient`，分别选择 Profile 和原有用途策略：

- `off` 不调用模型。
- `shadow` 记录建议，业务沿用原判断方式。
- `active` 将建议交给该业务的应用流程。

阈值、候选数、超时等仍由相应用途策略校验，不因 Profile 切换放宽权限。合法“不选”与服务失败不同；应用成功由业务确认后记录，不能在模型回答时提前记为成功。旁听结构化决策与 `ambient` Language Profile 分开：后者负责已有的语言判断路径。

## 普通插件调用

```ts
const models = context.use(aiInferenceClientToken);
const profiles = await models.list({ kind: 'decision' });
const selected = profiles.find(profile => profile.label === 'Careful');
if (!selected) throw new Error('Decision Profile unavailable');
const evidence = await models.evaluate({
  profile: selected.reference,
  state: { topic: 'synthetic task' },
  questions: {
    relevant: { type: 'choice', criteria: { read: 'Read existing facts', search: 'Find missing facts' } },
  },
});
```

问题 schema 须遵守所用 Driver 的真实合同。`evaluate` 不自动冒充上述六用途，也不返回 `applied`／`off` 状态。Choice、Score 和 Noul 使用供应商的真实结果，聊天模型生成 JSON 不足以声明自己具备此合同。

调用失败不切换到未选中的模型／账号。个人配额或其他提交前准入拒绝不会被 TypeSafe SDK 当作网络错误自动重试。已提交请求的结果未知与明确未提交分别记录；不以一次 HTTP 成功或 mock 结果证明真实供应商接受。
