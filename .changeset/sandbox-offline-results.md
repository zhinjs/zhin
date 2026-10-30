---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Recover completed Sandbox output from the existing journal with separate scoped delivery facts. Preserve confirmed, partial and unknown delivery, including interrupted final projection, without resending output or changing journal retention. Read results in pages of fifty; media recovery stores authorized URL references rather than bytes.
