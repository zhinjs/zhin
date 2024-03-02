import { ShikijiTransformer, ShikijiTransformerContext } from 'shikiji';
import { Element } from 'hast';

interface TransformerRenderWhitespaceOptions {
    /**
     * Class for tab
     *
     * @default 'tab'
     */
    classTab?: string;
    /**
     * Class for space
     *
     * @default 'space'
     */
    classSpace?: string;
    /**
     * Position of rendered whitespace
     * @default all position
     */
    position?: 'all' | 'boundary' | 'trailing';
}
/**
 * Render whitespaces as separate tokens.
 * Apply with CSS, it can be used to render tabs and spaces visually.
 */
declare function transformerRenderWhitespace(options?: TransformerRenderWhitespaceOptions): ShikijiTransformer;

/**
 * Remove line breaks between lines.
 * Useful when you override `display: block` to `.line` in CSS.
 */
declare function transformerRemoveLineBreak(): ShikijiTransformer;

interface TransformerCompactLineOption {
    /**
     * 1-based line number.
     */
    line: number;
    classes?: string[];
}
/**
 * Transformer for `shiki`'s legacy `lineOptions`
 */
declare function transformerCompactLineOptions(lineOptions?: TransformerCompactLineOption[]): ShikijiTransformer;

interface TransformerNotationFocusOptions {
    /**
     * Class for focused lines
     */
    classActiveLine?: string;
    /**
     * Class added to the root element when the code has focused lines
     */
    classActivePre?: string;
}
/**
 * Allow using `[!code focus]` notation in code to mark focused lines.
 */
declare function transformerNotationFocus(options?: TransformerNotationFocusOptions): ShikijiTransformer;

interface TransformerNotationHighlightOptions {
    /**
     * Class for highlighted lines
     */
    classActiveLine?: string;
    /**
     * Class added to the root element when the code has highlighted lines
     */
    classActivePre?: string;
}
/**
 * Allow using `[!code highlight]` notation in code to mark highlighted lines.
 */
declare function transformerNotationHighlight(options?: TransformerNotationHighlightOptions): ShikijiTransformer;

interface TransformerNotationDiffOptions {
    /**
     * Class for added lines
     */
    classLineAdd?: string;
    /**
     * Class for removed lines
     */
    classLineRemove?: string;
    /**
     * Class added to the <pre> element when the current code has diff
     */
    classActivePre?: string;
}
/**
 * Use `[!code ++]` and `[!code --]` to mark added and removed lines.
 */
declare function transformerNotationDiff(options?: TransformerNotationDiffOptions): ShikijiTransformer;

interface TransformerNotationErrorLevelOptions {
    classMap?: Record<string, string | string[]>;
    /**
     * Class added to the <pre> element when the current code has diff
     */
    classActivePre?: string;
}
/**
 * Allow using `[!code error]` `[!code warning]` notation in code to mark highlighted lines.
 */
declare function transformerNotationErrorLevel(options?: TransformerNotationErrorLevelOptions): ShikijiTransformer;

declare function createCommentNotationTransformer(name: string, regex: RegExp, onMatch: (this: ShikijiTransformerContext, match: string[], line: Element, commentNode: Element, lines: Element[], index: number) => boolean): ShikijiTransformer;

export { type TransformerCompactLineOption, type TransformerNotationDiffOptions, type TransformerNotationErrorLevelOptions, type TransformerNotationFocusOptions, type TransformerNotationHighlightOptions, type TransformerRenderWhitespaceOptions, createCommentNotationTransformer, transformerCompactLineOptions, transformerNotationDiff, transformerNotationErrorLevel, transformerNotationFocus, transformerNotationHighlight, transformerRemoveLineBreak, transformerRenderWhitespace };
