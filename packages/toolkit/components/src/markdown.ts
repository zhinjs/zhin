import { Lexer, type Token, type Tokens, type TokensList } from "marked";
import { decodeHTML, decodeHTMLStrict } from "entities";
import { jsx, type JSXElement, type JSXRenderable } from "@zhin.js/jsx";
import { Checkbox } from "./controls.js";
import { CodeBlock } from "./code-block.js";
import { List, ListItem } from "./list.js";
import { Table, TableCell, TableRow } from "./table.js";
import { themeOf, type ComponentTheme } from "./theme.js";
import { cssLength, customizeRoot, themedDiv } from "./styles.js";
import type { MarkdownProps } from "./markdown-props.js";

const MAX_SOURCE_LENGTH = 100_000;
const MAX_TOKEN_DEPTH = 24;
const MAX_TOKEN_COUNT = 10_000;

/** Bound parser recursion before deeply nested input can exhaust the JS stack. */
class MarkdownLexer extends Lexer {
  private parsingDepth = 0;

  private withinDepth<T>(read: () => T): T {
    if (this.parsingDepth >= MAX_TOKEN_DEPTH) {
      throw new RangeError(
        `Markdown exceeds maximum token depth ${MAX_TOKEN_DEPTH} during parsing`
      );
    }
    this.parsingDepth++;
    try {
      return read();
    } finally {
      this.parsingDepth--;
    }
  }

  override blockTokens(
    source: string,
    tokens?: TokensList,
    clipped?: boolean
  ): TokensList;
  override blockTokens(
    source: string,
    tokens?: Token[],
    clipped?: boolean
  ): Token[];
  override blockTokens(
    source: string,
    tokens?: Token[],
    clipped?: boolean
  ): Token[] {
    return this.withinDepth(() => super.blockTokens(source, tokens, clipped));
  }

  override inlineTokens(source: string, tokens?: Token[]): Token[] {
    return this.withinDepth(() => super.inlineTokens(source, tokens));
  }
}

function safeHref(source: string): string | undefined {
  const href = decodeHTML(source).trim();
  if (!href) return undefined;
  for (const character of href) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || character === "\\") return undefined;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme && !/^(?:https?|mailto)$/i.test(scheme[1]!)) return undefined;
  // Network-path references require an explicit http(s) scheme.
  if (href.startsWith("//")) return undefined;
  // A colon in the first relative path segment is not a relative reference.
  if (!scheme && /^[^/?#]*:/.test(href)) return undefined;
  return href;
}

class MarkdownTree {
  private remaining = MAX_TOKEN_COUNT;
  constructor(private readonly theme: ComponentTheme) {}

  private check(depth: number): void {
    if (depth > MAX_TOKEN_DEPTH)
      throw new RangeError(
        `Markdown exceeds maximum token depth ${MAX_TOKEN_DEPTH}`
      );
    if (--this.remaining < 0)
      throw new RangeError(
        `Markdown exceeds maximum token count ${MAX_TOKEN_COUNT}`
      );
  }

  private inline(tokens: readonly Token[], depth: number): JSXRenderable[] {
    return tokens.map((token) => {
      this.check(depth);
      const theme = this.theme;
      switch (token.type) {
        case "text": {
          const text = token as Tokens.Text;
          return text.tokens
            ? this.inline(text.tokens, depth + 1)
            : decodeHTMLStrict(text.text).replace(/\n/g, " ");
        }
        case "escape":
          return (token as Tokens.Escape).text;
        case "html":
          return token.raw;
        case "strong":
          return jsx("strong", {
            style: { fontWeight: theme.typography.weights.strong },
            children: this.inline((token as Tokens.Strong).tokens, depth + 1),
          });
        case "em":
          return jsx("em", {
            style: { fontStyle: "italic" },
            children: this.inline((token as Tokens.Em).tokens, depth + 1),
          });
        case "del":
          return jsx("del", {
            style: { textDecoration: "line-through" },
            children: this.inline((token as Tokens.Del).tokens, depth + 1),
          });
        case "codespan":
          return jsx("code", {
            style: {
              fontFamily: theme.code.fontFamily,
              fontSize: theme.code.fontSize,
              background: theme.palette.surface,
              color: theme.palette.text,
            },
            children: (token as Tokens.Codespan).text,
          });
        case "br":
          return "\n";
        case "link": {
          const link = token as Tokens.Link;
          const children = this.inline(link.tokens, depth + 1);
          const href = safeHref(link.href);
          return href
            ? jsx("a", {
                href,
                ...(link.title ? { title: decodeHTMLStrict(link.title) } : {}),
                style: {
                  color: theme.palette.accentMem,
                  textDecoration: "underline",
                },
                children,
              })
            : children;
        }
        case "image":
          return decodeHTMLStrict((token as Tokens.Image).text);
        default:
          return token.raw;
      }
    });
  }

  private textBlock(children: JSXRenderable, tight: boolean): JSXElement {
    return themedDiv(
      this.theme,
      `display:flex;flex-wrap:wrap;align-items:baseline;white-space:pre-wrap;margin:${
        tight ? 0 : this.theme.spacing.xs
      }px 0`,
      children
    );
  }

  blocks(tokens: readonly Token[], depth = 0, tight = false): JSXRenderable[] {
    return tokens.map((token) => {
      this.check(depth);
      const theme = this.theme;
      switch (token.type) {
        case "space":
        case "def":
          return null;
        case "paragraph":
          return this.textBlock(
            this.inline((token as Tokens.Paragraph).tokens, depth + 1),
            tight
          );
        case "text": {
          const text = token as Tokens.Text;
          return this.textBlock(
            text.tokens
              ? this.inline(text.tokens, depth + 1)
              : decodeHTMLStrict(text.text),
            tight
          );
        }
        case "heading": {
          const heading = token as Tokens.Heading;
          const sizes = [
            theme.typography.sizes.title + theme.spacing.sm,
            theme.typography.sizes.title,
            theme.typography.sizes.body + theme.spacing.xs,
            theme.typography.sizes.body,
            theme.typography.sizes.small,
            theme.typography.sizes.caption,
          ];
          return jsx(`h${heading.depth}`, {
            style: {
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              fontSize: sizes[heading.depth - 1],
              fontWeight: theme.typography.weights.heading,
              lineHeight: theme.typography.lineHeight,
              color: theme.palette.text,
              margin: `${theme.spacing.sm * theme.spacing.scale}px 0`,
            },
            children: this.inline(heading.tokens, depth + 1),
          });
        }
        case "code": {
          const code = token as Tokens.Code;
          return jsx(CodeBlock, {
            source: code.text,
            language: code.lang?.split(/\s+/)[0],
          });
        }
        case "blockquote":
          return themedDiv(
            theme,
            `display:flex;flex-direction:column;margin:${
              theme.spacing.xs
            }px 0;padding:${theme.spacing.sm}px ${
              theme.spacing.md
            }px;border-left:${cssLength(theme.border.width)} ${
              theme.border.style
            } ${theme.palette.accentMem};background:${
              theme.palette.surface
            };border-radius:${cssLength(theme.radii.chart)}`,
            this.blocks((token as Tokens.Blockquote).tokens, depth + 1)
          );
        case "hr":
          return themedDiv(
            theme,
            `display:flex;height:${cssLength(
              theme.border.width
            )};width:100%;background:${theme.palette.divider};margin:${
              theme.spacing.sm
            }px 0`
          );
        case "html":
          return this.textBlock(token.raw, tight);
        case "list": {
          const list = token as Tokens.List;
          const start = list.start === "" ? 1 : list.start;
          return jsx(List, {
            ordered: list.ordered,
            start,
            children: list.items.map((item) => {
              this.check(depth + 1);
              const marker = item.task
                ? jsx(Checkbox, {
                    checked: item.checked,
                    custom: { style: { margin: 0 } },
                  })
                : undefined;
              return jsx(ListItem, {
                marker,
                children: this.blocks(item.tokens, depth + 2, !item.loose),
              });
            }),
          });
        }
        case "table": {
          const table = token as Tokens.Table;
          const row = (
            cells: readonly Tokens.TableCell[],
            header: boolean,
            separator: boolean
          ) =>
            jsx(TableRow, {
              header,
              separator,
              children: cells.map((cell, index) =>
                jsx(TableCell, {
                  header,
                  align: table.align[index] ?? "left",
                  children: this.textBlock(
                    this.inline(cell.tokens, depth + 2),
                    true
                  ),
                })
              ),
            });
          return jsx(Table, {
            children: [
              row(table.header, true, false),
              ...table.rows.map((cells) => row(cells, false, true)),
            ],
          });
        }
        default:
          return this.textBlock(token.raw, tight);
      }
    });
  }
}

/** Parse GFM into escaped JSX. HTML is literal text and images show only alt text. */
export function Markdown(props: MarkdownProps): JSXElement {
  const source = props.source ?? props.children;
  if (typeof source !== "string")
    throw new TypeError("Markdown requires a string source or string children");
  if (source.length > MAX_SOURCE_LENGTH)
    throw new RangeError(
      `Markdown exceeds maximum source length ${MAX_SOURCE_LENGTH}`
    );
  const theme = themeOf(props);
  // Every render owns its lexer; global marked extensions never participate.
  const tokens = new MarkdownLexer({ gfm: true }).lex(source);
  return customizeRoot(
    themedDiv(
      theme,
      `display:flex;flex-direction:column;width:100%;min-width:0;margin:${theme.spacing.xs}px 0;color:${theme.palette.textSecondary}`,
      new MarkdownTree(theme).blocks(tokens)
    ),
    props,
    theme,
    "Markdown"
  );
}
