import { jsx, type JSXElement, type JSXStyle } from '@zhin.js/jsx';
import {
  bundledLanguages, bundledLanguagesAlias, bundledThemes, codeToTokens,
  type BundledLanguage, type BundledTheme, type ThemedToken,
} from 'shiki';
import { themeOf, displayProps } from './theme.js';
import { cssLength, customizeRoot, mergeStyles, styleObject, themedDiv } from './styles.js';
import type { CodeBlockProps } from './code-block-props.js';

function tokenStyle(token: ThemedToken, inheritedColor: boolean, wrap: boolean): JSXStyle {
  const font = token.fontStyle ?? 0;
  // A tab has intrinsic advance but no word to break. Constraining a pure
  // whitespace token below that advance would lose its intended indentation.
  const wrapsText = wrap && /\S/.test(token.content);
  return {
    whiteSpace: wrapsText ? 'pre-wrap' : 'pre',
    flexShrink: 0,
    ...(wrapsText ? { maxWidth: '100%', wordBreak: 'break-all' } : {}),
    color: inheritedColor ? 'inherit' : token.color,
    backgroundColor: token.bgColor,
    ...(font & 1 ? { fontStyle: 'italic' } : {}),
    ...(font & 2 ? { fontWeight: 700 } : {}),
    ...((font & 12) ? { textDecoration: [font & 4 ? 'underline' : '', font & 8 ? 'line-through' : ''].filter(Boolean).join(' ') } : {}),
  };
}

/** Highlight tokens become escaped JSX text; no generated HTML is injected. */
export async function CodeBlock(input: CodeBlockProps): Promise<JSXElement> {
  const theme = themeOf(input), props = displayProps(input);
  if (typeof props.source !== 'string') throw new TypeError('CodeBlock source must be a string');
  if (props.source.length > 100_000) throw new RangeError('CodeBlock source exceeds 100000 characters');
  const requestedLanguage = props.language?.trim().toLowerCase() || 'text';
  const language = Object.hasOwn(bundledLanguages, requestedLanguage) || Object.hasOwn(bundledLanguagesAlias, requestedLanguage)
    || ['text', 'plaintext', 'ansi'].includes(requestedLanguage)
    ? requestedLanguage : 'text';
  const requestedTheme = props.themeName ?? theme.code.theme;
  if (!Object.hasOwn(bundledThemes, requestedTheme)) throw new RangeError(`Unknown CodeBlock theme: ${requestedTheme}`);
  const highlighted = await codeToTokens(props.source, {
    lang: language as BundledLanguage | 'text' | 'plaintext' | 'ansi',
    theme: requestedTheme as BundledTheme,
  });
  const wrap = props.wrap ?? true;
  const lineNumbers = props.lineNumbers ?? true;
  const rootOverride = styleObject(mergeStyles(theme.components.CodeBlock, props.custom?.style));
  // An explicit root foreground intentionally makes the whole block monochrome.
  const inheritedColor = rootOverride.color != null;
  const effectiveFontSize = typeof rootOverride.fontSize === 'number' ? rootOverride.fontSize
    : typeof rootOverride.fontSize === 'string' && /^\d+(?:\.\d+)?px$/.test(rootOverride.fontSize)
      ? Number.parseFloat(rootOverride.fontSize) : theme.code.fontSize;
  const numberWidth = String(highlighted.tokens.length).length * effectiveFontSize * 0.7;
  const lines = highlighted.tokens.map((tokens, index) => themedDiv(theme, {
    display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
    gap: lineNumbers ? theme.spacing.md : 0, minHeight: `${effectiveFontSize * 1.6}px`,
  }, [
    lineNumbers ? jsx('span', {
      'data-code-line-number': index + 1,
      style: { display: 'flex', justifyContent: 'flex-end', flexShrink: 0, width: numberWidth,
        opacity: 0.45, userSelect: 'none' },
      children: index + 1,
    }) : null,
    // Tokens retain their intrinsic width. A long token wraps within the line,
    // while short tokens retain readable widths.
    jsx('div', {
      style: { display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap',
        flexGrow: 1, flexShrink: 1, minWidth: 0 },
      children: tokens.length ? tokens.map(token => jsx('span', {
        style: tokenStyle(token, inheritedColor, wrap), children: token.content,
      })) : '\u00a0',
    }),
  ]));
  return customizeRoot(themedDiv(theme, {
    display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%',
    margin: `${theme.spacing.xs}px 0`, overflow: 'hidden',
    background: highlighted.bg ?? theme.palette.surface,
    color: highlighted.fg ?? theme.palette.textSecondary,
    fontFamily: theme.code.fontFamily, fontSize: theme.code.fontSize, lineHeight: 1.6,
    border: `${cssLength(theme.border.width)} ${theme.border.style} ${theme.palette.border}`,
    borderRadius: cssLength(theme.radii.surface), boxShadow: theme.palette.shadowSm,
  }, [
    themedDiv(theme, {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm,
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      borderBottom: `${cssLength(theme.border.width)} ${theme.border.style} ${theme.palette.border}`,
      fontFamily: rootOverride.fontFamily ?? theme.typography.fontFamily,
      fontSize: rootOverride.fontSize ?? theme.typography.sizes.small,
    }, [
      themedDiv(theme, { display: 'flex', flexGrow: 1, flexShrink: 1, fontWeight: theme.typography.weights.strong },
        props.title === undefined ? theme.text.codeTitle : props.title),
      jsx('span', { style: { opacity: 0.65, flexShrink: 0, maxWidth: '100%', wordBreak: 'break-all' }, children: requestedLanguage }),
    ]),
    themedDiv(theme, {
      display: 'flex', flexDirection: 'column', minWidth: 0,
      padding: `${theme.spacing.md}px`, overflowX: wrap ? 'hidden' : 'auto',
    }, lines),
  ]), props, theme, 'CodeBlock');
}
