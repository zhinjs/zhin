# @zhin.js/plugin-calendar

## 0.1.2

### Patch Changes

- a3a7b53: Authorize Google / Outlook calendars from chat: master-only `calendar auth|status|logout` commands, OAuth callback route on the zhin HTTP host, refresh tokens stored in the plugin database (env `refresh_token` stays as fallback), clear re-auth prompts and a one-time notification on `invalid_grant`. The auth CLI ships as the optional `zhin-calendar-auth` bin.
- a3a7b53: Add `@zhin.js/plugin-calendar` with CalDAV / Google / Microsoft backends and Agent tools `list_events`, `find_free_time`, `create_event` plus skill `calendar-scheduling`.
- a3a7b53: Google/Microsoft calendar OAuth refresh_token flow, token manager, and auth CLI.
- Updated dependencies [4778587]
- Updated dependencies [681abf3]
  - @zhin.js/host-http@1.1.5
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5
