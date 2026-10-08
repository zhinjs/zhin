---
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-line": patch
---

Stop synthesizing message IDs after outbound API calls. Missing real platform IDs now report an unknown delivery outcome and must not be retried automatically. DingTalk webhook success responses without a message ID therefore remain unconfirmed under the current receipt contract.

LINE reply and push use their actual sentMessages IDs. Reply HTTP 400 errors no longer trigger automatic push fallback: rejected or partially successful replies could otherwise duplicate a message. Locally expired cached reply tokens still select push before a reply request is made.
