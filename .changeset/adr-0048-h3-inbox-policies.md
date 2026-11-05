---
"@zhin.js/harness": patch
---

ADR 0048 H3 (PR-1): mailbox inbox policies. `MailboxKey` gains `lane` (a mail's `lane`, default its engagement), and `BatchPolicy` is replaced by `InboxPolicy { onPost, ready, staleOf }` with an injectable clock and timer, queue TTL, `cancelSender`, and a turn control (`markDelivered` / `markActed` / `staleCheck`, admission facts) passed to the runner. `MailBody.human` gains optional `senderId` / `senderName` / `plainText` / `mergeable` / `live` / `isMaster` / `isStop` markers. New `createInboxPolicy` ports the admission, queue, merge-window, stale-reply and danmaku semantics of `TurnAdmissionGate`. It also adds the merged-turn helpers `participantsOf`, `firstHumanPrincipal` and `mergedAuthority`. The IM runtime is not switched over yet.
