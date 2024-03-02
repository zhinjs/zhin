// ## Interfaces

/**
 * Info associated with nodes by the ecosystem.
 *
 * This space is guaranteed to never be specified by unist or specifications
 * implementing unist.
 * But you can use it in utilities and plugins to store data.
 *
 * This type can be augmented to register custom data.
 * For example:
 *
 * ```ts
 * declare module 'unist' {
 *   interface Data {
 *     // `someNode.data.myId` is typed as `number | undefined`
 *     myId?: number | undefined
 *   }
 * }
 * ```
 */
interface Data$1 {}

/**
 * One place in a source file.
 */
interface Point {
    /**
     * Line in a source file (1-indexed integer).
     */
    line: number;

    /**
     * Column in a source file (1-indexed integer).
     */
    column: number;
    /**
     * Character in a source file (0-indexed integer).
     */
    offset?: number | undefined;
}

/**
 * Position of a node in a source document.
 *
 * A position is a range between two points.
 */
interface Position {
    /**
     * Place of the first character of the parsed source region.
     */
    start: Point;

    /**
     * Place of the first character after the parsed source region.
     */
    end: Point;
}

/**
 * Abstract unist node.
 *
 * The syntactic unit in unist syntax trees are called nodes.
 *
 * This interface is supposed to be extended.
 * If you can use {@link Literal} or {@link Parent}, you should.
 * But for example in markdown, a `thematicBreak` (`***`), is neither literal
 * nor parent, but still a node.
 */
interface Node$1 {
    /**
     * Node type.
     */
    type: string;

    /**
     * Info from the ecosystem.
     */
    data?: Data$1 | undefined;

    /**
     * Position of a node in a source document.
     *
     * Nodes that are generated (not in the original source document) must not
     * have a position.
     */
    position?: Position | undefined;
}

// ## Interfaces

/**
 * Info associated with hast nodes by the ecosystem.
 *
 * This space is guaranteed to never be specified by unist or hast.
 * But you can use it in utilities and plugins to store data.
 *
 * This type can be augmented to register custom data.
 * For example:
 *
 * ```ts
 * declare module 'hast' {
 *   interface Data {
 *     // `someNode.data.myId` is typed as `number | undefined`
 *     myId?: number | undefined
 *   }
 * }
 * ```
 */
interface Data extends Data$1 {}

/**
 * Info associated with an element.
 */
interface Properties {
    [PropertyName: string]: boolean | number | string | null | undefined | Array<string | number>;
}

// ## Content maps

/**
 * Union of registered hast nodes that can occur in {@link Element}.
 *
 * To register mote custom hast nodes, add them to {@link ElementContentMap}.
 * They will be automatically added here.
 */
type ElementContent = ElementContentMap[keyof ElementContentMap];

/**
 * Registry of all hast nodes that can occur as children of {@link Element}.
 *
 * For a union of all {@link Element} children, see {@link ElementContent}.
 */
interface ElementContentMap {
    comment: Comment;
    element: Element;
    text: Text;
}

/**
 * Union of registered hast nodes that can occur in {@link Root}.
 *
 * To register custom hast nodes, add them to {@link RootContentMap}.
 * They will be automatically added here.
 */
type RootContent = RootContentMap[keyof RootContentMap];

/**
 * Registry of all hast nodes that can occur as children of {@link Root}.
 *
 * > 👉 **Note**: {@link Root} does not need to be an entire document.
 * > it can also be a fragment.
 *
 * For a union of all {@link Root} children, see {@link RootContent}.
 */
interface RootContentMap {
    comment: Comment;
    doctype: Doctype;
    element: Element;
    text: Text;
}

// ## Abstract nodes

/**
 * Abstract hast node.
 *
 * This interface is supposed to be extended.
 * If you can use {@link Literal} or {@link Parent}, you should.
 * But for example in HTML, a `Doctype` is neither literal nor parent, but
 * still a node.
 *
 * To register custom hast nodes, add them to {@link RootContentMap} and other
 * places where relevant (such as {@link ElementContentMap}).
 *
 * For a union of all registered hast nodes, see {@link Nodes}.
 */
interface Node extends Node$1 {
    /**
     * Info from the ecosystem.
     */
    data?: Data | undefined;
}

/**
 * Abstract hast node that contains the smallest possible value.
 *
 * This interface is supposed to be extended if you make custom hast nodes.
 *
 * For a union of all registered hast literals, see {@link Literals}.
 */
interface Literal extends Node {
    /**
     * Plain-text value.
     */
    value: string;
}

/**
 * Abstract hast node that contains other hast nodes (*children*).
 *
 * This interface is supposed to be extended if you make custom hast nodes.
 *
 * For a union of all registered hast parents, see {@link Parents}.
 */
interface Parent extends Node {
    /**
     * List of children.
     */
    children: RootContent[];
}

// ## Concrete nodes

/**
 * HTML comment.
 */
interface Comment extends Literal {
    /**
     * Node type of HTML comments in hast.
     */
    type: "comment";
    /**
     * Data associated with the comment.
     */
    data?: CommentData | undefined;
}

/**
 * Info associated with hast comments by the ecosystem.
 */
interface CommentData extends Data {}

/**
 * HTML document type.
 */
interface Doctype extends Node$1 {
    /**
     * Node type of HTML document types in hast.
     */
    type: "doctype";
    /**
     * Data associated with the doctype.
     */
    data?: DoctypeData | undefined;
}

/**
 * Info associated with hast doctypes by the ecosystem.
 */
interface DoctypeData extends Data {}

/**
 * HTML element.
 */
interface Element extends Parent {
    /**
     * Node type of elements.
     */
    type: "element";
    /**
     * Tag name (such as `'body'`) of the element.
     */
    tagName: string;
    /**
     * Info associated with the element.
     */
    properties: Properties;
    /**
     * Children of element.
     */
    children: ElementContent[];
    /**
     * When the `tagName` field is `'template'`, a `content` field can be
     * present.
     */
    content?: Root | undefined;
    /**
     * Data associated with the element.
     */
    data?: ElementData | undefined;
}

/**
 * Info associated with hast elements by the ecosystem.
 */
interface ElementData extends Data {}

/**
 * Document fragment or a whole document.
 *
 * Should be used as the root of a tree and must not be used as a child.
 *
 * Can also be used as the value for the content field on a `'template'` element.
 */
interface Root extends Parent {
    /**
     * Node type of hast root.
     */
    type: "root";
    /**
     * Children of root.
     */
    children: RootContent[];
    /**
     * Data associated with the hast root.
     */
    data?: RootData | undefined;
}

/**
 * Info associated with hast root nodes by the ecosystem.
 */
interface RootData extends Data {}

/**
 * HTML character data (plain text).
 */
interface Text extends Literal {
    /**
     * Node type of HTML character data (plain text) in hast.
     */
    type: "text";
    /**
     * Data associated with the text.
     */
    data?: TextData | undefined;
}

/**
 * Info associated with hast texts by the ecosystem.
 */
interface TextData extends Data {}

/**
 * A union of given const enum values.
*/
type OrMask<T extends number> = number;

interface IOnigLib {
    createOnigScanner(sources: string[]): OnigScanner;
    createOnigString(str: string): OnigString;
}
interface IOnigCaptureIndex {
    start: number;
    end: number;
    length: number;
}
interface IOnigMatch {
    index: number;
    captureIndices: IOnigCaptureIndex[];
}
declare const enum FindOption {
    None = 0,
    /**
     * equivalent of ONIG_OPTION_NOT_BEGIN_STRING: (str) isn't considered as begin of string (* fail \A)
     */
    NotBeginString = 1,
    /**
     * equivalent of ONIG_OPTION_NOT_END_STRING: (end) isn't considered as end of string (* fail \z, \Z)
     */
    NotEndString = 2,
    /**
     * equivalent of ONIG_OPTION_NOT_BEGIN_POSITION: (start) isn't considered as start position of search (* fail \G)
     */
    NotBeginPosition = 4,
    /**
     * used for debugging purposes.
     */
    DebugCall = 8
}
interface OnigScanner {
    findNextMatchSync(string: string | OnigString, startPosition: number, options: OrMask<FindOption>): IOnigMatch | null;
    dispose?(): void;
}
interface OnigString {
    readonly content: string;
    dispose?(): void;
}

declare const ruleIdSymbol: unique symbol;
type RuleId = {
    __brand: typeof ruleIdSymbol;
};

/**
 * Identifiers with a binary dot operator.
 * Examples: `baz` or `foo.bar`
*/
type ScopeName = string;
/**
 * An expression language of ScopePathStr with a binary comma (to indicate alternatives) operator.
 * Examples: `foo.bar boo.baz,quick quack`
*/
type ScopePattern = string;
/**
 * A TextMate theme.
 */
interface IRawTheme {
    readonly name?: string;
    readonly settings: IRawThemeSetting[];
}
/**
 * A single theme setting.
 */
interface IRawThemeSetting {
    readonly name?: string;
    readonly scope?: ScopePattern | ScopePattern[];
    readonly settings: {
        readonly fontStyle?: string;
        readonly foreground?: string;
        readonly background?: string;
    };
}

interface IRawGrammar extends ILocatable {
    repository: IRawRepository;
    readonly scopeName: ScopeName;
    readonly patterns: IRawRule[];
    readonly injections?: {
        [expression: string]: IRawRule;
    };
    readonly injectionSelector?: string;
    readonly fileTypes?: string[];
    readonly name?: string;
    readonly firstLineMatch?: string;
}
/**
 * Allowed values:
 * * Scope Name, e.g. `source.ts`
 * * Top level scope reference, e.g. `source.ts#entity.name.class`
 * * Relative scope reference, e.g. `#entity.name.class`
 * * self, e.g. `$self`
 * * base, e.g. `$base`
 */
type IncludeString = string;
type RegExpString = string;
interface IRawRepositoryMap {
    [name: string]: IRawRule;
    $self: IRawRule;
    $base: IRawRule;
}
type IRawRepository = IRawRepositoryMap & ILocatable;
interface IRawRule extends ILocatable {
    id?: RuleId;
    readonly include?: IncludeString;
    readonly name?: ScopeName;
    readonly contentName?: ScopeName;
    readonly match?: RegExpString;
    readonly captures?: IRawCaptures;
    readonly begin?: RegExpString;
    readonly beginCaptures?: IRawCaptures;
    readonly end?: RegExpString;
    readonly endCaptures?: IRawCaptures;
    readonly while?: RegExpString;
    readonly whileCaptures?: IRawCaptures;
    readonly patterns?: IRawRule[];
    readonly repository?: IRawRepository;
    readonly applyEndPatternLast?: boolean;
}
type IRawCaptures = IRawCapturesMap & ILocatable;
interface IRawCapturesMap {
    [captureId: string]: IRawRule;
}
interface ILocation {
    readonly filename: string;
    readonly line: number;
    readonly char: number;
}
interface ILocatable {
    readonly $vscodeTextmateLocation?: ILocation;
}

declare const enum StandardTokenType {
    Other = 0,
    Comment = 1,
    String = 2,
    RegEx = 3
}

/**
 * A registry helper that can locate grammar file paths given scope names.
 */
interface RegistryOptions {
    onigLib: Promise<IOnigLib>;
    theme?: IRawTheme;
    colorMap?: string[];
    loadGrammar(scopeName: ScopeName): Promise<IRawGrammar | undefined | null>;
    getInjections?(scopeName: ScopeName): ScopeName[] | undefined;
}
/**
 * A map from scope name to a language id. Please do not use language id 0.
 */
interface IEmbeddedLanguagesMap {
    [scopeName: string]: number;
}
/**
 * A map from selectors to token types.
 */
interface ITokenTypeMap {
    [selector: string]: StandardTokenType;
}
interface IGrammarConfiguration {
    embeddedLanguages?: IEmbeddedLanguagesMap;
    tokenTypes?: ITokenTypeMap;
    balancedBracketSelectors?: string[];
    unbalancedBracketSelectors?: string[];
}
/**
 * The registry that will hold all grammars.
 */
declare class Registry {
    private readonly _options;
    private readonly _syncRegistry;
    private readonly _ensureGrammarCache;
    constructor(options: RegistryOptions);
    dispose(): void;
    /**
     * Change the theme. Once called, no previous `ruleStack` should be used anymore.
     */
    setTheme(theme: IRawTheme, colorMap?: string[]): void;
    /**
     * Returns a lookup array for color ids.
     */
    getColorMap(): string[];
    /**
     * Load the grammar for `scopeName` and all referenced included grammars asynchronously.
     * Please do not use language id 0.
     */
    loadGrammarWithEmbeddedLanguages(initialScopeName: ScopeName, initialLanguage: number, embeddedLanguages: IEmbeddedLanguagesMap): Promise<IGrammar | null>;
    /**
     * Load the grammar for `scopeName` and all referenced included grammars asynchronously.
     * Please do not use language id 0.
     */
    loadGrammarWithConfiguration(initialScopeName: ScopeName, initialLanguage: number, configuration: IGrammarConfiguration): Promise<IGrammar | null>;
    /**
     * Load the grammar for `scopeName` and all referenced included grammars asynchronously.
     */
    loadGrammar(initialScopeName: ScopeName): Promise<IGrammar | null>;
    private _loadGrammar;
    private _loadSingleGrammar;
    private _doLoadSingleGrammar;
    /**
     * Adds a rawGrammar.
     */
    addGrammar(rawGrammar: IRawGrammar, injections?: string[], initialLanguage?: number, embeddedLanguages?: IEmbeddedLanguagesMap | null): Promise<IGrammar>;
    /**
     * Get the grammar for `scopeName`. The grammar must first be created via `loadGrammar` or `addGrammar`.
     */
    private _grammarForScopeName;
}
/**
 * A grammar
 */
interface IGrammar {
    /**
     * Tokenize `lineText` using previous line state `prevState`.
     */
    tokenizeLine(lineText: string, prevState: StateStack | null, timeLimit?: number): ITokenizeLineResult;
    /**
     * Tokenize `lineText` using previous line state `prevState`.
     * The result contains the tokens in binary format, resolved with the following information:
     *  - language
     *  - token type (regex, string, comment, other)
     *  - font style
     *  - foreground color
     *  - background color
     * e.g. for getting the languageId: `(metadata & MetadataConsts.LANGUAGEID_MASK) >>> MetadataConsts.LANGUAGEID_OFFSET`
     */
    tokenizeLine2(lineText: string, prevState: StateStack | null, timeLimit?: number): ITokenizeLineResult2;
}
interface ITokenizeLineResult {
    readonly tokens: IToken[];
    /**
     * The `prevState` to be passed on to the next line tokenization.
     */
    readonly ruleStack: StateStack;
    /**
     * Did tokenization stop early due to reaching the time limit.
     */
    readonly stoppedEarly: boolean;
}
interface ITokenizeLineResult2 {
    /**
     * The tokens in binary format. Each token occupies two array indices. For token i:
     *  - at offset 2*i => startIndex
     *  - at offset 2*i + 1 => metadata
     *
     */
    readonly tokens: Uint32Array;
    /**
     * The `prevState` to be passed on to the next line tokenization.
     */
    readonly ruleStack: StateStack;
    /**
     * Did tokenization stop early due to reaching the time limit.
     */
    readonly stoppedEarly: boolean;
}
interface IToken {
    startIndex: number;
    readonly endIndex: number;
    readonly scopes: string[];
}
/**
 * **IMPORTANT** - Immutable!
 */
interface StateStack {
    _stackElementBrand: void;
    readonly depth: number;
    clone(): StateStack;
    equals(other: StateStack): boolean;
}
declare const INITIAL: StateStack;

interface WebAssemblyInstantiator {
    (importObject: Record<string, Record<string, WebAssembly.ImportValue>> | undefined): Promise<WebAssemblyInstance>;
}
type WebAssemblyInstance = WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance | WebAssembly.Instance['exports'];
type OnigurumaLoadOptions = {
    instantiator: WebAssemblyInstantiator;
} | {
    default: WebAssemblyInstantiator;
} | {
    data: ArrayBufferView | ArrayBuffer | Response;
};
type Awaitable$1<T> = T | Promise<T>;
type LoadWasmOptionsPlain = OnigurumaLoadOptions | WebAssemblyInstantiator | ArrayBufferView | ArrayBuffer | Response;
type LoadWasmOptions = Awaitable$1<LoadWasmOptionsPlain> | (() => Awaitable$1<LoadWasmOptionsPlain>);
declare function loadWasm(options: LoadWasmOptions): Promise<void>;

declare enum FontStyle {
    NotSet = -1,
    None = 0,
    Italic = 1,
    Bold = 2,
    Underline = 4
}
type PlainTextLanguage = 'text' | 'plaintext' | 'txt';
type AnsiLanguage = 'ansi';
type SpecialLanguage = PlainTextLanguage | AnsiLanguage;
type Awaitable<T> = T | Promise<T>;
type MaybeGetter<T> = Awaitable<MaybeModule<T>> | (() => Awaitable<MaybeModule<T>>);
type MaybeModule<T> = T | {
    default: T;
};
type MaybeArray<T> = T | T[];
type RequireKeys<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
type ThemeInput = MaybeGetter<ThemeRegistrationAny>;
type LanguageInput = MaybeGetter<MaybeArray<LanguageRegistration>>;
interface Nothing {
}
/**
 * type StringLiteralUnion<'foo'> = 'foo' | string
 * This has auto completion whereas `'foo' | string` doesn't
 * Adapted from https://github.com/microsoft/TypeScript/issues/29729
 */
type StringLiteralUnion<T extends U, U = string> = T | (U & Nothing);
type ResolveBundleKey<T extends string> = [T] extends [never] ? string : T;
interface ShikiInternal {
    setTheme(name: string | ThemeRegistrationAny): {
        theme: ThemeRegistrationResolved;
        colorMap: string[];
    };
    getTheme(name: string | ThemeRegistrationAny): ThemeRegistrationResolved;
    getLangGrammar(name: string): IGrammar;
    getLoadedThemes(): string[];
    getLoadedLanguages(): string[];
    loadLanguage(...langs: LanguageInput[]): Promise<void>;
    loadTheme(...themes: ThemeInput[]): Promise<void>;
    getAlias(): Record<string, string>;
    updateAlias(alias: Record<string, string>): void;
}
/**
 * Generic instance interface of Shikiji
 */
interface HighlighterGeneric<BundledLangKeys extends string, BundledThemeKeys extends string> {
    /**
     * Get highlighted code in HTML string
     */
    codeToHtml(code: string, options: CodeToHastOptions<ResolveBundleKey<BundledLangKeys>, ResolveBundleKey<BundledThemeKeys>>): string;
    /**
     * Get highlighted code in HAST.
     * @see https://github.com/syntax-tree/hast
     */
    codeToHast(code: string, options: CodeToHastOptions<ResolveBundleKey<BundledLangKeys>, ResolveBundleKey<BundledThemeKeys>>): Root;
    /**
     * Get highlighted code in tokens.
     * @returns A 2D array of tokens, first dimension is lines, second dimension is tokens in a line.
     */
    codeToThemedTokens(code: string, options: CodeToThemedTokensOptions<ResolveBundleKey<BundledLangKeys>, ResolveBundleKey<BundledThemeKeys>>): ThemedToken[][];
    /**
     * Get highlighted code in tokens with multiple themes.
     *
     * Different from `codeToThemedTokens`, each token will have a `variants` property consisting of an object of color name to token styles.
     *
     * @returns A 2D array of tokens, first dimension is lines, second dimension is tokens in a line.
     */
    codeToTokensWithThemes(code: string, options: CodeToTokensWithThemesOptions<ResolveBundleKey<BundledLangKeys>, ResolveBundleKey<BundledThemeKeys>>): ThemedTokenWithVariants[][];
    /**
     * Load a theme to the highlighter, so later it can be used synchronously.
     */
    loadTheme(...themes: (ThemeInput | BundledThemeKeys)[]): Promise<void>;
    /**
     * Load a language to the highlighter, so later it can be used synchronously.
     */
    loadLanguage(...langs: (LanguageInput | BundledLangKeys | SpecialLanguage)[]): Promise<void>;
    /**
     * Get the registered theme object
     */
    getTheme(name: string | ThemeRegistrationAny): ThemeRegistrationResolved;
    /**
     * Get the registered language object
     */
    getLangGrammar(name: string | LanguageRegistration): IGrammar;
    /**
     * Set the current theme and get the resolved theme object and color map.
     * @internal
     */
    setTheme: ShikiInternal['setTheme'];
    /**
     * Get the names of loaded languages
     *
     * Special-handled languages like `text`, `plain` and `ansi` are not included.
     */
    getLoadedLanguages(): string[];
    /**
     * Get the names of loaded themes
     */
    getLoadedThemes(): string[];
    /**
     * Get internal context object
     * @internal
     * @deprecated
     */
    getInternalContext(): ShikiInternal;
}
interface HighlighterCoreOptions {
    /**
     * Theme names, or theme registration objects to be loaded upfront.
     */
    themes?: ThemeInput[];
    /**
     * Language names, or language registration objects to be loaded upfront.
     */
    langs?: LanguageInput[];
    /**
     * Alias of languages
     * @example { 'my-lang': 'javascript' }
     */
    langAlias?: Record<string, string>;
    /**
     * Load wasm file from a custom path or using a custom function.
     */
    loadWasm?: LoadWasmOptions;
}
interface BundledHighlighterOptions<L extends string, T extends string> {
    /**
     * Theme registation
     *
     * @default []
     */
    themes?: (ThemeInput | StringLiteralUnion<T>)[];
    /**
     * Language registation
     *
     * @default Object.keys(bundledThemes)
     */
    langs?: (LanguageInput | StringLiteralUnion<L> | SpecialLanguage)[];
    /**
     * Alias of languages
     * @example { 'my-lang': 'javascript' }
     */
    langAlias?: Record<string, StringLiteralUnion<L>>;
}
interface LanguageRegistration extends IRawGrammar {
    name: string;
    scopeName: string;
    displayName?: string;
    aliases?: string[];
    /**
     * A list of languages the current language embeds.
     * If manually specifying languages to load, make sure to load the embedded
     * languages for each parent language.
     */
    embeddedLangs?: string[];
    /**
     * A list of languages that embed the current language.
     * Unlike `embeddedLangs`, the embedded languages will not be loaded automatically.
     */
    embeddedLangsLazy?: string[];
    balancedBracketSelectors?: string[];
    unbalancedBracketSelectors?: string[];
    foldingStopMarker?: string;
    foldingStartMarker?: string;
    /**
     * Inject this language to other scopes.
     * Same as `injectTo` in VSCode's `contributes.grammars`.
     *
     * @see https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide#injection-grammars
     */
    injectTo?: string[];
}
interface CodeToThemedTokensOptions<Languages = string, Themes = string> extends TokenizeWithThemeOptions {
    lang?: Languages | SpecialLanguage;
    theme?: Themes | ThemeRegistrationAny;
}
interface CodeToHastOptionsCommon<Languages extends string = string> extends TransformerOptions, Pick<TokenizeWithThemeOptions, 'colorReplacements'> {
    lang: StringLiteralUnion<Languages | SpecialLanguage>;
    /**
     * Merge whitespace tokens to saving extra `<span>`.
     *
     * When set to true, it will merge whitespace tokens with the next token.
     * When set to false, it keep the output as-is.
     * When set to `never`, it will force to separate leading and trailing spaces from tokens.
     *
     * @default true
     */
    mergeWhitespaces?: boolean | 'never';
}
interface CodeToTokensWithThemesOptions<Languages = string, Themes = string> {
    lang?: Languages | SpecialLanguage;
    /**
     * A map of color names to themes.
     *
     * `light` and `dark` are required, and arbitrary color names can be added.
     *
     * @example
     * ```ts
     * themes: {
     *   light: 'vitesse-light',
     *   dark: 'vitesse-dark',
     *   soft: 'nord',
     *   // custom colors
     * }
     * ```
     */
    themes: Partial<Record<string, Themes | ThemeRegistrationAny>>;
}
interface CodeOptionsSingleTheme<Themes extends string = string> {
    theme: ThemeRegistrationAny | StringLiteralUnion<Themes>;
}
interface CodeOptionsMultipleThemes<Themes extends string = string> {
    /**
     * A map of color names to themes.
     * This allows you to specify multiple themes for the generated code.
     *
     * ```ts
     * highlighter.codeToHtml(code, {
     *   lang: 'js',
     *   themes: {
     *     light: 'vitesse-light',
     *     dark: 'vitesse-dark',
     *   }
     * })
     * ```
     *
     * Will generate:
     *
     * ```html
     * <span style="color:#111;--shiki-dark:#fff;">code</span>
     * ```
     *
     * @see https://github.com/antfu/shikiji#lightdark-dual-themes
     */
    themes: Partial<Record<string, ThemeRegistrationAny | StringLiteralUnion<Themes>>>;
    /**
     * The default theme applied to the code (via inline `color` style).
     * The rest of the themes are applied via CSS variables, and toggled by CSS overrides.
     *
     * For example, if `defaultColor` is `light`, then `light` theme is applied to the code,
     * and the `dark` theme and other custom themes are applied via CSS variables:
     *
     * ```html
     * <span style="color:#{light};--shiki-dark:#{dark};--shiki-custom:#{custom};">code</span>
     * ```
     *
     * When set to `false`, no default styles will be applied, and totally up to users to apply the styles:
     *
     * ```html
     * <span style="--shiki-light:#{light};--shiki-dark:#{dark};--shiki-custom:#{custom};">code</span>
     * ```
     *
     *
     * @default 'light'
     */
    defaultColor?: StringLiteralUnion<'light' | 'dark'> | false;
    /**
     * Prefix of CSS variables used to store the color of the other theme.
     *
     * @default '--shiki-'
     */
    cssVariablePrefix?: string;
}
type CodeOptionsThemes<Themes extends string = string> = CodeOptionsSingleTheme<Themes> | CodeOptionsMultipleThemes<Themes>;
interface CodeOptionsMeta {
    /**
     * Meta data passed to Shikiji, usually used by plugin integrations to pass the code block header.
     *
     * Key values in meta will be serialized to the attributes of the root `<pre>` element.
     *
     * Keys starting with `_` will be ignored.
     *
     * A special key `__raw` key will be used to pass the raw code block header (if the integration supports it).
     */
    meta?: {
        /**
         * Raw string of the code block header.
         */
        __raw?: string;
        [key: string]: any;
    };
}
interface TransformerOptions {
    /**
     * Transformers for the Shikiji pipeline.
     */
    transformers?: ShikijiTransformer[];
    /**
     * @deprecated use `transformers` instead
     */
    transforms?: ShikijiTransformer;
}
type CodeToHastOptions<Languages extends string = string, Themes extends string = string> = CodeToHastOptionsCommon<Languages> & CodeOptionsThemes<Themes> & CodeOptionsMeta;
interface ThemeRegistrationRaw extends IRawTheme, Partial<Omit<ThemeRegistration, 'name' | 'settings'>> {
}
interface ThemeRegistration extends Partial<ThemeRegistrationResolved> {
}
interface ThemeRegistrationResolved extends IRawTheme {
    /**
     * Theme name
     */
    name: string;
    /**
     * Display name
     *
     * @field shikiji custom property
     */
    displayName?: string;
    /**
     * Light/dark theme
     *
     * @field shikiji custom property
     */
    type: 'light' | 'dark';
    /**
     * Token rules
     */
    settings: IRawThemeSetting[];
    /**
     * Same as `settings`, will use as fallback if `settings` is not present.
     */
    tokenColors?: IRawThemeSetting[];
    /**
     * Default foreground color
     *
     * @field shikiji custom property
     */
    fg: string;
    /**
     * Background color
     *
     * @field shikiji custom property
     */
    bg: string;
    /**
     * A map of color names to new color values.
     *
     * The color key starts with '#' and should be lowercased.
     *
     * @field shikiji custom property
     */
    colorReplacements?: Record<string, string>;
    /**
     * Color map of VS Code options
     *
     * Will be used by shikiji on `lang: 'ansi'` to find ANSI colors, and to find the default foreground/background colors.
     */
    colors?: Record<string, string>;
    /**
     * JSON schema path
     *
     * @field not used by shikiji
     */
    $schema?: string;
    /**
     * Enable semantic highlighting
     *
     * @field not used by shikiji
     */
    semanticHighlighting?: boolean;
    /**
     * Tokens for semantic highlighting
     *
     * @field not used by shikiji
     */
    semanticTokenColors?: Record<string, string>;
}
type ThemeRegistrationAny = ThemeRegistrationRaw | ThemeRegistration | ThemeRegistrationResolved;
interface ShikijiTransformerContextMeta {
}
/**
 * Common transformer context for all transformers hooks
 */
interface ShikijiTransformerContextCommon {
    meta: ShikijiTransformerContextMeta;
    options: CodeToHastOptions;
    codeToHast: (code: string, options: CodeToHastOptions) => Root;
}
/**
 * Transformer context for HAST related hooks
 */
interface ShikijiTransformerContext extends ShikijiTransformerContextCommon {
    readonly tokens: ThemedToken[][];
    readonly root: Root;
    readonly pre: Element;
    readonly code: Element;
    readonly lines: Element[];
}
interface ShikijiTransformer {
    /**
     * Name of the transformer
     */
    name?: string;
    /**
     * Transform the entire generated HAST tree. Return a new Node will replace the original one.
     */
    root?(this: ShikijiTransformerContext, hast: Root): Root | void;
    /**
     * Transform the `<pre>` element. Return a new Node will replace the original one.
     */
    pre?(this: ShikijiTransformerContext, hast: Element): Element | void;
    /**
     * Transform the `<code>` element. Return a new Node will replace the original one.
     */
    code?(this: ShikijiTransformerContext, hast: Element): Element | void;
    /**
     * Transform each line `<span class="line">` element.
     *
     * @param hast
     * @param line 1-based line number
     */
    line?(this: ShikijiTransformerContext, hast: Element, line: number): Element | void;
    /**
     * Transform each token `<span>` element.
     */
    token?(this: ShikijiTransformerContext, hast: Element, line: number, col: number, lineElement: Element): Element | void;
    /**
     * Transform the raw input code before passing to the highlighter.
     * This hook will only be called with `codeToHtml` or `codeToHast`.
     */
    preprocess?(this: ShikijiTransformerContextCommon, code: string, options: CodeToHastOptions): string | void;
    /**
     * Transform the generated HTML string before returning.
     * This hook will only be called with `codeToHtml`.
     */
    postprocess?(this: ShikijiTransformerContextCommon, html: string, options: CodeToHastOptions): string | void;
}
interface HtmlRendererOptionsCommon extends TransformerOptions {
    lang?: string;
    langId?: string;
    fg?: string;
    bg?: string;
    themeName?: string;
    /**
     * Custom style string to be applied to the root `<pre>` element.
     * When specified, `fg` and `bg` will be ignored.
     */
    rootStyle?: string;
}
type HtmlRendererOptions = HtmlRendererOptionsCommon & CodeToHastOptions;
interface ThemedTokenScopeExplanation {
    scopeName: string;
    themeMatches: any[];
}
interface ThemedTokenExplanation {
    content: string;
    scopes: ThemedTokenScopeExplanation[];
}
/**
 * A single token with color, and optionally with explanation.
 *
 * For example:
 *
 * ```json
 * {
 *   "content": "shiki",
 *   "color": "#D8DEE9",
 *   "explanation": [
 *     {
 *       "content": "shiki",
 *       "scopes": [
 *         {
 *           "scopeName": "source.js",
 *           "themeMatches": []
 *         },
 *         {
 *           "scopeName": "meta.objectliteral.js",
 *           "themeMatches": []
 *         },
 *         {
 *           "scopeName": "meta.object.member.js",
 *           "themeMatches": []
 *         },
 *         {
 *           "scopeName": "meta.array.literal.js",
 *           "themeMatches": []
 *         },
 *         {
 *           "scopeName": "variable.other.object.js",
 *           "themeMatches": [
 *             {
 *               "name": "Variable",
 *               "scope": "variable.other",
 *               "settings": {
 *                 "foreground": "#D8DEE9"
 *               }
 *             },
 *             {
 *               "name": "[JavaScript] Variable Other Object",
 *               "scope": "source.js variable.other.object",
 *               "settings": {
 *                 "foreground": "#D8DEE9"
 *               }
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
 */
interface ThemedToken extends TokenStyles, TokenBase {
}
interface TokenBase {
    /**
     * The content of the token
     */
    content: string;
    /**
     * Explanation of
     *
     * - token text's matching scopes
     * - reason that token text is given a color (one matching scope matches a rule (scope -> color) in the theme)
     */
    explanation?: ThemedTokenExplanation[];
}
interface TokenStyles {
    /**
     * 6 or 8 digit hex code representation of the token's color
     */
    color?: string;
    /**
     * Font style of token. Can be None/Italic/Bold/Underline
     */
    fontStyle?: FontStyle;
    /**
     * Override with custom inline style for HTML renderer.
     * When specified, `color` and `fontStyle` will be ignored.
     */
    htmlStyle?: string;
}
interface ThemedTokenWithVariants extends TokenBase {
    /**
     * An object of color name to token styles
     */
    variants: Record<string, TokenStyles>;
}
type DynamicImportLanguageRegistration = () => Promise<{
    default: LanguageRegistration[];
}>;
type DynamicImportThemeRegistration = () => Promise<{
    default: ThemeRegistration;
}>;
interface BundledLanguageInfo {
    id: string;
    name: string;
    import: DynamicImportLanguageRegistration;
    aliases?: string[];
}
interface BundledThemeInfo {
    id: string;
    displayName: string;
    type: 'light' | 'dark';
    import: DynamicImportThemeRegistration;
}
interface TokenizeWithThemeOptions {
    /**
     * Include explanation of why a token is given a color.
     *
     * @default false
     */
    includeExplanation?: boolean;
    /**
     * A map of color names to new color values.
     *
     * The color key starts with '#' and should be lowercased.
     *
     * This will be merged with theme's `colorReplacements` if any.
     */
    colorReplacements?: Record<string, string>;
}

export { Registry as $, type AnsiLanguage as A, type BundledHighlighterOptions as B, type CodeToHastOptions as C, type ThemeRegistration as D, type Element as E, FontStyle as F, type ShikijiTransformerContextMeta as G, type HighlighterGeneric as H, type IGrammar as I, type ShikijiTransformerContext as J, type ShikijiTransformer as K, type LanguageInput as L, type MaybeArray as M, type HtmlRendererOptionsCommon as N, type HtmlRendererOptions as O, type PlainTextLanguage as P, type ThemedTokenScopeExplanation as Q, type Root as R, type ShikiInternal as S, type ThemeInput as T, type ThemedTokenExplanation as U, type TokenBase as V, type TokenStyles as W, type DynamicImportLanguageRegistration as X, type DynamicImportThemeRegistration as Y, type BundledLanguageInfo as Z, type BundledThemeInfo as _, type HighlighterCoreOptions as a, INITIAL as a0, type StateStack as a1, type IRawTheme as a2, type IGrammarConfiguration as a3, type IOnigLib as a4, type RegistryOptions as a5, type IRawThemeSetting as a6, type RequireKeys as b, type CodeToThemedTokensOptions as c, type ThemedToken as d, type CodeToTokensWithThemesOptions as e, type ThemedTokenWithVariants as f, type ThemeRegistrationResolved as g, type TokenizeWithThemeOptions as h, type ShikijiTransformerContextCommon as i, type ThemeRegistrationAny as j, type IRawGrammar as k, loadWasm as l, type SpecialLanguage as m, type Awaitable as n, type MaybeGetter as o, type MaybeModule as p, type StringLiteralUnion as q, type ResolveBundleKey as r, type LanguageRegistration as s, type CodeToHastOptionsCommon as t, type CodeOptionsSingleTheme as u, type CodeOptionsMultipleThemes as v, type CodeOptionsThemes as w, type CodeOptionsMeta as x, type TransformerOptions as y, type ThemeRegistrationRaw as z };
