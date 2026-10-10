import {
  jsx,
  isJsxElement,
  type JSXElement,
  type JSXRenderable,
  type JSXStyle,
} from "@zhin.js/jsx";
import {
  type ComponentName,
  type ComponentProps,
  type ComponentTheme,
} from "./theme.js";

type StyleObject = Record<string, string | number | null | undefined | false>;

/** Parses declaration boundaries without breaking quoted strings or CSS functions. */
export function styleObject(style?: JSXStyle): StyleObject {
  if (!style) return {};
  if (typeof style !== "string") {
    const result: StyleObject = {};
    for (const [key, value] of Object.entries(style)) {
      const property = camelName(key);
      delete result[property];
      result[property] = value;
    }
    return result;
  }
  // Remove comments outside strings before locating declaration boundaries.
  // Comments may contain quotes, parentheses, colons and semicolons.
  let css = "", comment = false, stringQuote = "";
  for (let i = 0; i < style.length; i++) {
    const c = style[i]!;
    if (comment) {
      if (c === "*" && style[i + 1] === "/") { comment = false; i++; }
    } else if (stringQuote) {
      css += c;
      if (c === "\\" && i + 1 < style.length) css += style[++i];
      else if (c === stringQuote) stringQuote = "";
    } else if (c === "/" && style[i + 1] === "*") {
      // Comments separate CSS tokens; deleting them must not join adjacent values.
      css += " ";
      comment = true;
      i++;
    }
    else {
      css += c;
      if (c === '"' || c === "'") stringQuote = c;
    }
  }
  const declarations: string[] = [];
  let start = 0,
    depth = 0,
    quote = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      declarations.push(css.slice(start, i));
      start = i + 1;
    }
  }
  declarations.push(css.slice(start));
  const result: StyleObject = {};
  for (const declaration of declarations) {
    const colon = declaration.indexOf(":");
    if (colon > 0) {
      const property = camelName(declaration.slice(0, colon).trim());
      if (!property) continue;
      delete result[property];
      result[property] = declaration.slice(colon + 1).trim();
    }
  }
  return result;
}

function camelName(name: string): string {
  return name.startsWith("--")
    ? name
    : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function mergeStyles(
  ...styles: readonly (JSXStyle | undefined)[]
): JSXStyle {
  const result: StyleObject = {};
  for (const style of styles) {
    for (const [key, value] of Object.entries(styleObject(style))) {
      // The serialized object is a declaration list. Reinsert repeated keys at
      // their final position so later shorthands can reset earlier longhands.
      delete result[key];
      result[key] = value;
    }
  }
  return result;
}

export function cssLength(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

/** Spacing scale adjusts component-owned CSS, leaving local styles untouched. */
export function componentStyle(
  style: JSXStyle,
  theme: ComponentTheme
): JSXStyle {
  const parsed = styleObject(style);
  for (const [key, value] of Object.entries(parsed)) {
    if (/^(?:padding|margin|gap|rowGap|columnGap)/.test(key) && typeof value === "number") {
      parsed[key] = value * theme.spacing.scale;
      continue;
    }
    if (
      /^(?:padding|margin|gap|rowGap|columnGap)/.test(key) &&
      typeof value === "string"
    ) {
      parsed[key] = value.replace(
        /(-?(?:\d*\.)?\d+)px/g,
        (_, n: string) => `${Number(n) * theme.spacing.scale}px`
      );
    }
  }
  return parsed;
}

export function themedDiv(
  theme: ComponentTheme,
  style: JSXStyle,
  children?: JSXRenderable
): JSXElement {
  return jsx("div", {
    style: mergeStyles(
      { boxSizing: "border-box" },
      componentStyle(style, theme)
    ),
    children,
  });
}
export function themedColumn(
  theme: ComponentTheme,
  children: JSXRenderable,
  style = ""
): JSXElement {
  return themedDiv(
    theme,
    `display:flex;flex-direction:column;${style}`,
    children
  );
}
export function themedLabel(
  theme: ComponentTheme,
  label: JSXRenderable,
  width: number
): JSXElement {
  return themedDiv(
    theme,
    `display:flex;width:${width}px;min-width:${width}px;max-width:${width}px;color:${theme.palette.textMuted};font-size:${theme.typography.sizes.body}px;line-height:${theme.typography.lineHeight};text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
    label
  );
}

/** Applies local overrides to the actual root, including a component delegated to another component. */
export function customizeRoot<T extends JSXRenderable>(
  node: T,
  props: ComponentProps,
  theme: ComponentTheme,
  name: ComponentName
): T {
  if (!isJsxElement(node)) return node;
  const override = mergeStyles(theme.components[name], props.custom?.style);
  if (typeof node.type === "function") {
    const childCustom = node.props.custom as ComponentProps["custom"];
    return jsx(node.type, {
      ...node.props,
      custom: {
        ...childCustom,
        style: mergeStyles(childCustom?.style, override),
      },
    }) as T;
  }
  return jsx(node.type, {
    ...node.props,
    style: mergeStyles(
      {
        boxSizing: "border-box",
        fontFamily: theme.typography.fontFamily,
        fontSize: theme.typography.sizes.body,
        lineHeight: theme.typography.lineHeight,
      },
      theme.style,
      node.props.style as JSXStyle,
      override
    ),
  }) as T;
}
