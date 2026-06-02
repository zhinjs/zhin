# Built-in Font Files

This directory contains font files that are included with the `@zhin.js/satori` package.

## Included Fonts

### Poppins Fonts (SIL Open Font License 1.1)

- **Poppins-Regular.ttf** - Poppins Regular (400 weight) - ~157 KB
- **Poppins-Bold.ttf** - Poppins Bold (700 weight) - ~152 KB

### Noto Sans CJK Fonts (SIL Open Font License 1.1)

These are **SubsetOTF** static fonts from [googlefonts/noto-cjk](https://github.com/googlefonts/noto-cjk) (`Sans/SubsetOTF/{SC,JP,KR}/`). They work with Satori’s bundled OpenType parser; **do not** replace them with Google Fonts **variable** `.ttf` here — those can crash Satori’s `fvar` parsing.

- **NotoSansSC-Regular.otf** — Simplified Chinese — ~8 MB  
- **NotoSansJP-Regular.otf** — Japanese — ~4.3 MB  
- **NotoSansKR-Regular.otf** — Korean — ~4.4 MB  

> **Important**: If these files are accidentally replaced by an HTML page (e.g. wrong `curl` URL or Git LFS misconfiguration), `file *.otf` will show `HTML document` and **CJK will render as tofu**. Re-fetch with `pnpm fetch-noto-cjk` from `packages/satori`.

### Noto Color Emoji Font (SIL Open Font License 1.1)

- **NotoColorEmoji.ttf** — ~10.1 MB，**仅作保留/其它用途**。Satori 的 `fonts` 选项需要轮廓字体（TTF/OTF+CFF），该文件为 **CBDT 彩色位图**，传入 Satori 会报错；插件里 Emoji 应通过 **`loadAdditionalAsset`（如 Twemoji）** 渲染。

**Approximate total (fonts on disk)**: ~37 MB（含 Color Emoji 文件；Satori 实际加载的是 Poppins + Noto CJK SubsetOTF）

## License Information

### Poppins
- **License**: SIL Open Font License 1.1 (OFL)
- **Copyright**: Indian Type Foundry
- **Source**: https://fonts.google.com/specimen/Poppins
- **License URL**: https://openfontlicense.org

### Noto Sans CJK (SC, JP, KR)
- **License**: SIL Open Font License 1.1 (OFL)
- **Copyright**: Google
- **Source**: https://github.com/googlefonts/noto-cjk (SubsetOTF)
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

// 拉丁 + 全 CJK（不含可传给 Satori 的 Color Emoji 字体）
const completeFonts = getCompleteFonts();

// Or get specific fonts
const poppins = getPoppinsRegular();
const chinese = getNotoSansSC();
const japanese = getNotoSansJP();
const korean = getNotoSansKR();
const emoji = getNotoColorEmoji();
```

No extra download is required for normal installs; to **refresh** Noto CJK files after a bad copy:

```bash
cd packages/satori && pnpm fetch-noto-cjk
```

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
- Users download fonts once during installation

## References

- **Noto**: https://fonts.google.com/noto
- **Apache License 2.0**: https://www.apache.org/licenses/LICENSE-2.0
- **MPL-2.0 License**: https://www.mozilla.org/en-US/MPL/2.0/
- **Font License Compatibility**: See LICENSE_COMPLIANCE.md
