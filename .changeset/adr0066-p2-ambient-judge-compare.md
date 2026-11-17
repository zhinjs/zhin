---
"@zhin.js/agent": minor
"zhin.js": minor
---

插话判断的「仅评估」改为可选的对照模型，一致率按「过门槛后会不会开口」比较（ADR 0066 P2）。

- `purposes.ambient.compare` 选一个 Profile（语言或决策模型都可以）：主判断（经过备用链）照常决定；对照模型对同一份输入同时判一次，只记录、从不影响结果。两边都等结束再返回，共用同一个 15 秒预算；对照模型没有备用链，失败只记 `compare_failed`，不写全局跳过表。`mode: shadow` 时对照模型照常运行。开了对照模型，每次判断的模型调用翻倍（只发生在通过冷却、限次和判断间隔之后的判断上）。
- `@zhin.js/agent` 新增 `CompareEngagementJudge`（取代废弃的 `ShadowEngagementJudge`）与类型 `EngagementCompareResult` / `EngagementCompareReport` / `CompareEngagementJudgeOptions`，判断结果新增 `compare`；`AgentAssistantStatusPort` 新增可选 `recordAmbientCompare()`，`recordAmbientShadow()` 废弃期内保留。日志 `ambient_compare`；`ambient_decision` 审计 payload 新增 `compare`（`engage` / `quiet` / `failed`）以及 `compareJudge` / `compareJudgeKind` / `compareJudgeProfile` / `compareJudgeModel` / `compareJudgeMs` / `compareJudgeUsage` / `compareJudgeError`，不含理由原文。
- `zhin.js`：Console 群聊插话状态（`plugin.root.ambient` RPC）新增 `compare`：最近 24 小时一致次数、「主判断插话、对照不插」次数、「主判断不插、对照插话」次数、对照失败次数，并按给出结论的链成员（主项 / 第 N 个备用）分别列出；只有两边都给出结果才计入一致率。`decisionShadow` 废弃期内保留，填同样的数据（加上旧的陪跑记录），数值口径与旧版不同。新增导出类型 `AmbientCompareStatus` / `AmbientCompareCounts`。
