---
"@zhin.js/adapter": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
---

feat(adapters): notify masters when ICQQ or QQ goes offline and support ICQQ re-login

- Add an explicit `notify` target to ICQQ and QQ endpoint config: when the
  transport goes offline or login fails, send a short notice through another
  adapter instance's Endpoint via `OutboundHost`.
- ICQQ automatically retries login after `system.offline.kickoff` when
  `autoReconnect` is enabled, and exposes pending QR/slider/device challenges.
- Add `icqq login status|qr|confirm|code|retry` recovery commands. They can be
  invoked from the QQ conversation that received the notice; `qr` returns the
  login QR code as an image when the notifying platform supports it.
- `notify.id` also counts as the master identity for the related endpoint
  management commands, so recovery can happen from the notified conversation.
- Document the new config and commands in the ICQQ/QQ READMEs and generated
  configuration reference.
