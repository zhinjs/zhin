---
"@zhin.js/satori": minor
---

feat: add built-in font utilities API

Exposes new font utility types and functions from @zhin.js/satori package:
- BuiltinFont interface for type-safe font definitions
- Font getter functions (getRobotoRegular, getRobotoBold, getNotoSans*, etc.)
- Note: These functions throw errors in this build as no fonts are bundled
