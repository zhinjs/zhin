---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
---

新增探索纪律 harness：model harness 支持 `explorationBudget`（连续只读探索调用达到次数后在工具结果中注入提示，默认 8，0 关闭）与 `explorationGuidance`（系统提示加入"先规划、限定目标文件"）；内置 MiniMax M 系列预设（explorationBudget 5，开启 guidance，不改 maxIterations），均可通过 `ai.agent.modelHarness` 覆盖。
