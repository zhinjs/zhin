# @zhin.js/adapter-juejin

## 0.1.2

### Patch Changes

- 22bd14a: The Console comment-review page is now a thin spec over `createCommentReviewPage`; the local RPC client and duplicated page components are removed. Discard uses an inline confirmation, error notices stay until dismissed, and a failed refresh is shown as stale data.
- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
- Updated dependencies [4427e72]
- Updated dependencies [22bd14a]
  - @zhin.js/core@1.1.57
  - @zhin.js/client@1.1.25
  - @zhin.js/page@1.1.15
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/adapter@1.1.29
  - @zhin.js/feature-kit@1.1.13

## 0.1.1

### Patch Changes

- 7256bd8: #971 B3: new Experimental Juejin (掘金) comment-reply adapter implementing the ADR 0035 contract. Polls the public `interact_api/v1/comment/list` for an explicit whitelist of your own articles (blank = no polling; first poll is a baseline, comments deduped by id, own comments filtered by login uid or the author flag). Each comment thread is a `channel` conversation `article:<articleId>:<rootCommentId>` with parent `article:<articleId>`. `sendMode` is `review` (default) or `off` — no `auto`; `send` only queues drafts (`approval_pending`, `not_sent`) and only replies to existing comments, never top-level. Approval (Console page, `juejin-draft send`, or `approveDraft`) posts `interact_api/v1/reply/publish` with a minimum send interval; HTTP 403/429, non-JSON responses and rate-limit/captcha/risk messages trip a circuit breaker, and an unparseable write result keeps the draft flagged as possibly posted instead of retrying. The cookie is env-injected only and never persisted; drafts live in `data/juejin/<id>/drafts.json` at mode 600. The plain-HTTP write path is not yet verified live — see the README checklist.
- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [4fe49b5]
- Updated dependencies [cce07db]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/adapter@1.1.28
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/client@1.1.24
  - @zhin.js/page@1.1.14
