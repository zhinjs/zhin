# Built-in Font Files

This directory contains font files that are included with the `@zhin.js/satori` package.

## Included Fonts

### Poppins Fonts (SIL Open Font License 1.1)

- **Poppins-Regular.ttf** - Poppins Regular (400 weight) - ~157 KB
- **Poppins-Bold.ttf** - Poppins Bold (700 weight) - ~152 KB

### Noto Sans CJK Fonts (SIL Open Font License 1.1)

- **NotoSansSC-Regular.ttf** - Noto Sans Simplified Chinese (400 weight) - ~291 KB
- **NotoSansJP-Regular.ttf** - Noto Sans Japanese (400 weight) - ~291 KB
- **NotoSansKR-Regular.ttf** - Noto Sans Korean (400 weight) - ~291 KB

### Noto Color Emoji Font (SIL Open Font License 1.1)

- **NotoColorEmoji.ttf** - Noto Color Emoji (all emoji support) - ~10.1 MB

**Total Size**: ~11.3 MB

## License Information

### Poppins
- **License**: SIL Open Font License 1.1 (OFL)
- **Copyright**: Indian Type Foundry
- **Source**: https://fonts.google.com/specimen/Poppins
- **License URL**: https://openfontlicense.org

### Noto Sans CJK (SC, JP, KR)
- **License**: SIL Open Font License 1.1 (OFL)
- **Copyright**: Google
- **Source**: https://fonts.google.com/noto
- **License URL**: https://openfontlicense.org

### Noto Color Emoji
- **License**: SIL Open Font License 1.1 (OFL)
- **Copyright**: Google
- **Source**: https://github.com/googlefonts/noto-emoji
- **License URL**: https://openfontlicense.org

All fonts are licensed under the SIL Open Font License 1.1 (OFL) which is compatible with the MPL-2.0 license of this package.

## Usage

All fonts are built-in and ready to use:

```typescript
import { 
  getDefaultFonts,      // Poppins Regular + Bold
  getExtendedFonts,     // Poppins + Noto Sans SC
  getCJKFonts,          // Chinese + Japanese + Korean
  getCompleteFonts,     // All fonts including Emoji (recommended)
  getPoppinsRegular,
  getPoppinsBold,
  getNotoSansSC,
  getNotoSansJP,
  getNotoSansKR,
  getNotoColorEmoji,
} from '@zhin.js/satori';

// Get default fonts (Poppins Regular + Bold)
const fonts = getDefaultFonts();

// Get extended fonts (includes Poppins and Chinese support)
const extendedFonts = getExtendedFonts();

// Get CJK fonts (Chinese, Japanese, Korean)
const cjkFonts = getCJKFonts();

// Get complete fonts (all languages + emoji) - RECOMMENDED
const completeFonts = getCompleteFonts();

// Or get specific fonts
const poppins = getPoppinsRegular();
const chinese = getNotoSansSC();
const japanese = getNotoSansJP();
const korean = getNotoSansKR();
const emoji = getNotoColorEmoji();
```

No download or installation required!

## Adding More Fonts

To add additional fonts to this package:

1. **Verify the font license** is compatible with MPL-2.0:
   - ✅ Apache License 2.0
   - ✅ MIT License
   - ✅ BSD Licenses
   - ✅ SIL Open Font License (OFL)
   - ✅ Public Domain / CC0

2. **Place the font file** (`.ttf`, `.otf`, etc.) in this directory

3. **Update `src/fonts.ts`** to add a loading function:
   ```typescript
   export function getMyFont(): BuiltinFont | null {
     return loadFont('MyFont.ttf', 'My Font', 400, 'normal')
   }
   ```

4. **Document the license** in this file and in the NOTICE file

5. **Rebuild the package**: `pnpm build`

6. **Commit to git**: Font files are tracked in the repository

## License Compliance

All fonts in this directory must have:
- ✅ Clear, documented license
- ✅ License compatible with MPL-2.0
- ✅ Proper attribution in NOTICE file
- ✅ Permission for redistribution

**Never include fonts with**:
- ❌ Unknown or unclear licenses
- ❌ "Free for personal use only" restrictions
- ❌ Incompatible copyleft licenses (e.g., GPL)
- ❌ Proprietary/commercial licenses without permission

## Package Distribution

The fonts are included in the npm package, so users get them automatically when installing `@zhin.js/satori`.

When publishing:
- Fonts are included via `package.json` `files` field
- Total package size: ~490 KB (code + fonts)
- Users download fonts only once during installation

## References

- **Roboto Font**: https://fonts.google.com/specimen/Roboto
- **Apache License 2.0**: https://www.apache.org/licenses/LICENSE-2.0
- **MPL-2.0 License**: https://www.mozilla.org/en-US/MPL/2.0/
- **Font License Compatibility**: See LICENSE_COMPLIANCE.md
