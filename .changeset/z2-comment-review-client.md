---
"@zhin.js/client": patch
---

Add `createCommentReviewPage(spec)` (plus `ReviewResourceList` and the `CommentReviewSpec` / `ReviewContext` types): one shared comment-review Console page built only on the `@zhin.js/client/ui` kit, for adapters that draft replies for human approval. It resolves the PluginId, keeps the last good status as stale on refresh failure, sends discard through an inline `ConfirmButton`, keeps error notices until dismissed, and shows overflow as text ("超出 N 字"). The legacy `ac-*` review styles are removed from `adapterConsoleStyles`.
