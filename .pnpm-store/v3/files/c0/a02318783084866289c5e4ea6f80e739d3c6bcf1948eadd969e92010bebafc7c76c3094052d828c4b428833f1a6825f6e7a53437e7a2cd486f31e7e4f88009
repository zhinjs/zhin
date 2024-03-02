import { H as HighlighterGeneric, a as HighlighterCoreOptions, B as BundledHighlighterOptions, L as LanguageInput, T as ThemeInput, C as CodeToHastOptions, R as Root, b as RequireKeys, c as CodeToThemedTokensOptions, d as ThemedToken, e as CodeToTokensWithThemesOptions, f as ThemedTokenWithVariants, M as MaybeArray, E as Element, S as ShikiInternal, g as ThemeRegistrationResolved, h as TokenizeWithThemeOptions, i as ShikijiTransformerContextCommon, j as ThemeRegistrationAny } from './chunk-types.mjs';
export { A as AnsiLanguage, n as Awaitable, Z as BundledLanguageInfo, _ as BundledThemeInfo, x as CodeOptionsMeta, v as CodeOptionsMultipleThemes, u as CodeOptionsSingleTheme, w as CodeOptionsThemes, t as CodeToHastOptionsCommon, X as DynamicImportLanguageRegistration, Y as DynamicImportThemeRegistration, F as FontStyle, I as Grammar, O as HtmlRendererOptions, N as HtmlRendererOptionsCommon, I as IGrammar, k as IRawGrammar, s as LanguageRegistration, o as MaybeGetter, p as MaybeModule, P as PlainTextLanguage, k as RawGrammar, r as ResolveBundleKey, K as ShikijiTransformer, J as ShikijiTransformerContext, G as ShikijiTransformerContextMeta, m as SpecialLanguage, q as StringLiteralUnion, D as ThemeRegistration, z as ThemeRegistrationRaw, U as ThemedTokenExplanation, Q as ThemedTokenScopeExplanation, V as TokenBase, W as TokenStyles, y as TransformerOptions, l as loadWasm } from './chunk-types.mjs';

type HighlighterCore = HighlighterGeneric<never, never>;
/**
 * Create a Shikiji core highlighter instance, with no languages or themes bundled.
 * Wasm and each language and theme must be loaded manually.
 *
 * @see http://shikiji.netlify.app/guide/install#fine-grained-bundle
 */
declare function getHighlighterCore(options?: HighlighterCoreOptions): Promise<HighlighterCore>;

type GetHighlighterFactory<L extends string, T extends string> = (options?: BundledHighlighterOptions<L, T>) => Promise<HighlighterGeneric<L, T>>;
/**
 * Create a `getHighlighter` function with bundled themes and languages.
 *
 * @param bundledLanguages
 * @param bundledThemes
 * @param loadWasm
 */
declare function createdBundledHighlighter<BundledLangs extends string, BundledThemes extends string>(bundledLanguages: Record<BundledLangs, LanguageInput>, bundledThemes: Record<BundledThemes, ThemeInput>, loadWasm: HighlighterCoreOptions['loadWasm']): GetHighlighterFactory<BundledLangs, BundledThemes>;
interface ShorthandsBundle<L extends string, T extends string> {
    /**
     * Shorthand for `codeToHtml` with auto-loaded theme and language.
     * A singleton highlighter it maintained internally.
     *
     * Differences from `highlighter.codeToHtml()`, this function is async.
     */
    codeToHtml(code: string, options: CodeToHastOptions<L, T>): Promise<string>;
    /**
     * Shorthand for `codeToHtml` with auto-loaded theme and language.
     * A singleton highlighter it maintained internally.
     *
     * Differences from `highlighter.codeToHtml()`, this function is async.
     */
    codeToHast(code: string, options: CodeToHastOptions<L, T>): Promise<Root>;
    /**
     * Shorthand for `codeToThemedTokens` with auto-loaded theme and language.
     * A singleton highlighter it maintained internally.
     *
     * Differences from `highlighter.codeToThemedTokens()`, this function is async.
     */
    codeToThemedTokens(code: string, options: RequireKeys<CodeToThemedTokensOptions<L, T>, 'theme' | 'lang'>): Promise<ThemedToken[][]>;
    /**
     * Shorthand for `codeToTokensWithThemes` with auto-loaded theme and language.
     * A singleton highlighter it maintained internally.
     *
     * Differences from `highlighter.codeToTokensWithThemes()`, this function is async.
     */
    codeToTokensWithThemes(code: string, options: RequireKeys<CodeToTokensWithThemesOptions<L, T>, 'themes' | 'lang'>): Promise<ThemedTokenWithVariants[][]>;
    /**
     * Get internal singleton highlighter.
     *
     * @internal
     */
    getSingletonHighlighter(): Promise<HighlighterGeneric<L, T>>;
}
declare function createSingletonShorthands<L extends string, T extends string>(getHighlighter: GetHighlighterFactory<L, T>): ShorthandsBundle<L, T>;

declare function toArray<T>(x: MaybeArray<T>): T[];
/**
 * Check if the language is plaintext that is ignored by Shikiji.
 *
 * Hard-coded languages: `plaintext`, `txt`, `text`, `plain`.
 */
declare function isPlaintext(lang: string | null | undefined): boolean;
/**
 * Check if the language is specially handled by Shikiji.
 *
 * Hard-coded languages: `ansi` and plaintexts like `plaintext`, `txt`, `text`, `plain`.
 */
declare function isSpecialLang(lang: string): boolean;
/**
 * Utility to append class to a hast node
 *
 * If the `property.class` is a string, it will be splitted by space and converted to an array.
 */
declare function addClassToHast(node: Element, className: string | string[]): void;

/**
 * Get the minimal shiki context for rendering.
 */
declare function getShikiInternal(options?: HighlighterCoreOptions): Promise<ShikiInternal>;
/**
 * @deprecated Use `getShikiInternal` instead.
 */
declare const getShikiContext: typeof getShikiInternal;

declare function codeToThemedTokens(internal: ShikiInternal, code: string, options?: CodeToThemedTokensOptions): ThemedToken[][];

declare function tokenizeAnsiWithTheme(theme: ThemeRegistrationResolved, fileContents: string, options?: TokenizeWithThemeOptions): ThemedToken[][];

declare function codeToHast(internal: ShikiInternal, code: string, options: CodeToHastOptions, transformerContext?: ShikijiTransformerContextCommon): Root;

/**
 * Get highlighted code in HTML.
 */
declare function codeToHtml(internal: ShikiInternal, code: string, options: CodeToHastOptions): string;

/**
 * Get tokens with multiple themes
 */
declare function codeToTokensWithThemes(internal: ShikiInternal, code: string, options: CodeToTokensWithThemesOptions): ThemedTokenWithVariants[][];

/**
 * Normalize a textmate theme to shiki theme
 */
declare function normalizeTheme(rawTheme: ThemeRegistrationAny): ThemeRegistrationResolved;
/**
 * @deprecated Use `normalizeTheme` instead.
 */
declare const toShikiTheme: typeof normalizeTheme;

export { BundledHighlighterOptions, CodeToHastOptions, CodeToThemedTokensOptions, CodeToTokensWithThemesOptions, type GetHighlighterFactory, type HighlighterCore, HighlighterCoreOptions, HighlighterGeneric, LanguageInput, MaybeArray, RequireKeys, ShikiInternal, ShikijiTransformerContextCommon, type ShorthandsBundle, ThemeInput, ThemeRegistrationAny, ThemeRegistrationResolved, ThemedToken, ThemedTokenWithVariants, TokenizeWithThemeOptions, addClassToHast, codeToHast, codeToHtml, codeToThemedTokens, codeToTokensWithThemes, createSingletonShorthands, createdBundledHighlighter, getHighlighterCore, getShikiContext, getShikiInternal, isPlaintext, isSpecialLang, normalizeTheme, toArray, toShikiTheme, tokenizeAnsiWithTheme };
