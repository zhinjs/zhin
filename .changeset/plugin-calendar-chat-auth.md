---
"@zhin.js/plugin-calendar": minor
---

Authorize Google / Outlook calendars from chat: master-only `calendar auth|status|logout` commands, OAuth callback route on the zhin HTTP host, refresh tokens stored in the plugin database (env `refresh_token` stays as fallback), clear re-auth prompts and a one-time notification on `invalid_grant`. The auth CLI ships as the optional `zhin-calendar-auth` bin.
