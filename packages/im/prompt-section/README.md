# @zhin.js/prompt-section

Generation-owned Agent Prompt Section Feature。插件根目录的
`prompt-sections/<name>/index.ts` 默认导出 `defineAgentPromptSection(...)`，并作为
immutable capability slot 进入当前 generation。

Prompt Section 只贡献模型上下文，不授予 Tool、文件、网络、审批或 Workroom 权限。
`PromptSectionIndex.visible(owner, profile)` 按 Plugin owner 继承链解析，并固定到当前
generation；HMR 原子发布新 projection，在途 Turn 继续使用旧 snapshot。

平台插件可声明 `platforms` 与 `scopes: ['private' | 'group' | 'channel']`；Agent 在每轮入站按可信平台和场景筛选。未声明不限制；声明的场景列表必须非空且无重复，不使用用户消息正文推断权限。
