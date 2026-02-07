# Built-in Font Files

This directory contains font files that are included with the `@zhin.js/satori` package.

## Included Fonts

### Roboto Fonts (Included ✅)
- `Roboto-Regular.ttf` - Roboto Regular (400 weight) - ~164 KB
- `Roboto-Bold.ttf` - Roboto Bold (700 weight) - ~163 KB

### Additional Fonts (Included ✅)
- `Habbo.ttf` - ~10 KB
- `MontserratSubrayada-Regular.ttf` - ~22 KB
- `playfair-display.ttf` - ~47 KB

### Special Character Fonts (Included ✅)
- `你好` - Chinese characters
- `こんにちは` - Japanese characters
- `안녕` - Korean characters
- `Χαίρετ` - Greek characters

## Usage

All fonts are built-in and ready to use:

```typescript
import { getDefaultFonts, getRobotoRegular } from '@zhin.js/satori';

// Get default fonts (Roboto Regular + Bold)
const fonts = getDefaultFonts();

// Or get specific fonts
const robotoRegular = getRobotoRegular();
const robotoBold = getRobotoBold();
```

No download or installation required!

## Adding More Fonts

To add additional fonts to this package:

1. Place the font file (`.ttf`, `.otf`, etc.) in this directory
2. Update `src/fonts.ts` to add a loading function
3. Rebuild the package: `pnpm build`
4. Commit to git - fonts are tracked in the repository

## License Information

### Roboto
- License: Apache License 2.0
- Copyright: Google
- Source: https://fonts.google.com/specimen/Roboto

### Other Fonts
Please verify the license for each font file before distribution.

## Package Size

Total font size: ~420 KB (for Roboto fonts)

The fonts are included in the npm package, so users get them automatically when installing `@zhin.js/satori`.
