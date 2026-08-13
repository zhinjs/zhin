---
"@zhin.js/agent": patch
---

Delete the classic Plugin/Message-based `ask_user` implementation and its global pending-session middleware.

Interactive clarification now has one authority: the generation-owned `ask_user` ToolFeature and turn-scoped QuestionPort. Security approval remains a separate, explicit ApprovalPort and fails closed when the ingress does not provide one. AIService no longer accepts a Plugin to inject interactive tools, classic built-in aggregation no longer publishes `ask_user`, and post-tool owner prompting no longer bypasses the approval boundary.

BREAKING CHANGE: `AskUserBuiltinTool`, `AskUserSessionService`, `createAskUserTool`, `AIService.setPlugin`, `ImApprovalAdapter`, `SessionInteractionPort`, and owner hard-orchestration exports are removed. Hosts must provide QuestionPort for ordinary questions and ApprovalPort for security decisions.
