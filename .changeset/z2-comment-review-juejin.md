---
"@zhin.js/adapter-juejin": patch
---

The Console comment-review page is now a thin spec over `createCommentReviewPage`; the local RPC client and duplicated page components are removed. Discard uses an inline confirmation, error notices stay until dismissed, and a failed refresh is shown as stale data.
