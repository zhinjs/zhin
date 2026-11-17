---
title: 升级：插话判断合并
description: ADR 0066 升级说明——「旁听」用途和「旁听参与判断」合成一项插话判断 purposes.ambient；旧配置的自动迁移表、行为变化、回退命令与废弃期
---

# 升级：插话判断合并（ADR 0066）

本版本起，群里没人叫机器人时要不要插话，只由一项「插话判断」（`purposes.ambient`）决定（[ADR 0066](../adr/0066-ambient-judge-merge.md)）。原来的用途「旁听」和决策「旁听参与判断」合成这一项：一个模型选择（普通语言模型或决策模型都可以），一条可以混排两类模型的备用链，可选的对照模型，一个门槛和一个「只观察」开关。配置写法见 [AI 配置：插话判断](../ai/index.md#插话判断)。

## 自动迁移

升级后实例第一次加载模型配置时自动迁移一次：按下表算出 `purposes.ambient`，删除旧字段，用一个事务写回，同时保存迁移前完整的用途配置，供回退使用。`zhin.config.yml` 里的 `ai.trigger.ambient.minConfidence` / `mode` 在这时读入一次（不改文件）。

记 `L` = 原「旁听」语言模型及其备用，`D` = 原决策「旁听参与判断」，`T` = `zhin.config.yml` 的 `ai.trigger.ambient`：

| 旧配置 | `profile` | `fallbacks` | `compare` | `minConfidence` | `mode` | `timeoutMs` |
|---|---|---|---|---|---|---|
| 没有 `D`，或 `D` 为「关闭」 | `L` 的主项（没有则跟随聊天） | `L` 的备用链 | — | `T.minConfidence` | `T.mode` | — |
| `D` 为「启用」 | `D` 的 Profile | **`L` 的主项排第一**，后接 `L` 的备用链（`L` 跟随聊天时为空） | — | 两道旧门槛中较大的值 | `T.mode` | `D.timeoutMs` |
| `D` 为「仅评估」 | `L` 的主项 | `L` 的备用链 | `D` 的 Profile | `T.minConfidence` | `T.mode` | `D.timeoutMs` |

- **唯一的行为变化**：原来决策「启用」并单独配置了旁听语言模型的部署，决策模型失败（超时、网络错误、5xx、回答无效、配额用完等）时由这个语言模型接手判断，以前是直接不插话。不想要就在「插话判断」里把它从备用链删掉。原「旁听」跟随聊天时，不会把聊天模型自动加成备用。
- 门槛取两道旧门槛中较大的值，正好等于以前两道门槛叠加的效果，迁移后不会多插话。
- 「仅评估」变成对照模型：主判断和插话行为不变；它原来的 `minConfidence` 只影响陪跑记录，迁移时丢弃。一致率改按「经过门槛后会不会开口」统计，数值会和旧的不同。
- 决策「关闭」的 Profile 本来就不被调用，不迁移（Profile 本身保留）。

迁移后第一次运行 `zhin doctor` 会显示一条记录：迁移了什么、每个值来自哪里、丢弃了什么及原因、迁移时间和回退命令；之后不再显示，`zhin doctor --verbose` 可以再看。实例日志里同样有一行 `ambient_judge_migrated`。

迁移失败（例如引用的 Profile 已不属于 Host、写入冲突重试 3 次仍失败）时不写数据库：实例按同一张表在内存里换算后运行，插话行为与迁移成功时相同；日志记 `ambient_judge_migration_failed`，`zhin doctor` 报错并给出要修正的位置。修好后下次加载自动重试。

## 回退与降级

旧版本读不了含 `purposes.ambient` 的模型配置。**降级前先运行：**

```bash
zhin ai purposes revert ambient-judge
```

它只在 `purposes.ambient` 自迁移后没有被修改过时，把插话判断恢复为迁移前的旧写法（其他用途保持现状）；改过则拒绝并说明。迁移时读入、之后被 `zhin doctor --fix` 删掉的 `ai.trigger.ambient.minConfidence` / `mode` 会先写回配置文件；写不回时不回退，并提示手工加回哪几项。回退后当前版本仍按旧写法换算运行，行为不变，也不会自动再迁移；在 Console「插话判断」保存一次即改回新写法。迁移记录始终保留迁移前的配置，需要时可以人工恢复。

## 废弃期

本 minor 和下一个 minor 内：

- 导入（`ai.plan.yml`、Console、脚本）里的 `purposes.decisions.ambient` 仍被接受，按上表与同一份导入里的 `purposes.ambient` 合并转换，导入结果带警告；`mode: off` 或 `null` 按旧语义撤销决策模型（恢复原来的旁听语言模型，并去掉原「仅评估」的对照模型）。字符串写法 `purposes.ambient: <profile>` 只替换语言模型，保留「只观察」、对照模型和门槛。之后报 `invalid-plan`（路径 `purposes.decisions.ambient`）。导出只写新形状。
- `zhin.config.yml` 的 `ai.trigger.ambient.minConfidence` / `mode`：迁移时读入一次，之后不再单独生效。迁移之后再写这两个键（例如旧版 Console 的「只观察」开关），实例下次加载时会把新值转到插话判断，并记一行 `ambient_trigger_write_converted`，不会静默失效。`zhin doctor` 只有在运行中实例的迁移记录确认已迁移时，才提示它们不再生效并允许 `--fix` 删除（其他键和注释保留）；实例没运行、还没迁移、迁移失败或已回退时它们仍然生效，只给警告，`--fix` 不删。废弃期结束后对已迁移的键报错，启动仍只警告。
- 自我变更和聊天里的 `config set` 不能再写这两个键。

存储里的旧字段一直会被自动迁移，不随废弃期结束失效。
