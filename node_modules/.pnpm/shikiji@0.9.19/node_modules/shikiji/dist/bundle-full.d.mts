import { R as Root } from './types/index.d.mjs';
import * as shikiji_core from 'shikiji-core';
import { HighlighterGeneric } from 'shikiji-core';
export * from 'shikiji-core';
import { BundledLanguage } from './langs.mjs';
export { bundledLanguages, bundledLanguagesAlias, bundledLanguagesBase, bundledLanguagesInfo } from './langs.mjs';
import { BundledTheme } from './themes.mjs';
export { bundledThemes, bundledThemesInfo } from './themes.mjs';
export * from 'shikiji-core/wasm';

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;
/**
 * Initiate a highlighter instance and load the specified languages and themes.
 * Later it can be used synchronously to highlight code.
 *
 * Importing this function will bundle all languages and themes.
 * @see https://shikiji.netlify.app/guide/bundles#shikiji-bundle-full
 *
 * For granular control over the bundle, check:
 * @see https://shikiji.netlify.app/guide/install#fine-grained-bundle
 */
declare const getHighlighter: shikiji_core.GetHighlighterFactory<BundledLanguage, BundledTheme>;
declare const codeToHtml: (code: string, options: shikiji_core.CodeToHastOptions<BundledLanguage, BundledTheme>) => Promise<string>;
declare const codeToHast: (code: string, options: shikiji_core.CodeToHastOptions<BundledLanguage, BundledTheme>) => Promise<Root>;
declare const codeToThemedTokens: (code: string, options: shikiji_core.RequireKeys<shikiji_core.CodeToThemedTokensOptions<BundledLanguage, BundledTheme>, "lang" | "theme">) => Promise<shikiji_core.ThemedToken[][]>;
declare const codeToTokensWithThemes: (code: string, options: shikiji_core.RequireKeys<shikiji_core.CodeToTokensWithThemesOptions<BundledLanguage, BundledTheme>, "lang" | "themes">) => Promise<shikiji_core.ThemedTokenWithVariants[][]>;
declare const getSingletonHighlighter: () => Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>;

export { BundledLanguage, BundledTheme, type Highlighter, codeToHast, codeToHtml, codeToThemedTokens, codeToTokensWithThemes, getHighlighter, getSingletonHighlighter };
