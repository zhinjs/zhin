---
"@zhin.js/cli": patch
---

ADR 0038 R0-fix (#1133): mergeable group wakes (plain-text `@bot` from non-master members, merge window on) now wait in the shared scene Session, so two people `@`-ing the Bot in one group are answered by one merged turn again. Masters, DMs, prefix/commands, stop words, `clear`, media/quote/forward and `merge.enabled: false` keep their #1104 personal Session. A stop word also stops the sender's merged scene turn.
