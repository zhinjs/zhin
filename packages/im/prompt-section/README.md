# @zhin.js/prompt-section

Generation-owned Agent Prompt Section Feature。插件根目录的
`agent/prompt-sections/**/*.ts` 默认导出 `defineAgentPromptSection(...)`，并作为
immutable capability slot 进入当前 generation。

Prompt Section 只贡献模型上下文，不授予 Tool、文件、网络、审批或 Workroom 权限。
`PromptSectionIndex.visible(owner, profile)` 按 Plugin owner 继承链解析，并固定到当前
generation；HMR 原子发布新 projection，在途 Turn 继续使用旧 snapshot。
