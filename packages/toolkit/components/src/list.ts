import {
  Fragment,
  isJsxElement,
  jsx,
  type JSXElement,
  type JSXRenderable,
} from "@zhin.js/jsx";
import { customizeRoot, themedColumn, themedDiv } from "./styles.js";
import {
  displayProps,
  themeOf,
  sourceElementType,
  cloneSourceElement,
  ThemeProvider,
} from "./theme.js";
import type { ListProps, ListItemProps } from "./list-props.js";

// A per-tree default survives ThemeProvider's lazy wrappers without DOM attributes.
const inheritedOrdinal = Symbol("zhin.components.list-ordinal");

export function List(props: ListProps): JSXElement {
  const theme = themeOf(props);
  const { ordered = false, start = 1, items, children } = displayProps(props);
  if (ordered && !Number.isSafeInteger(start))
    throw new RangeError("List start must be a safe finite integer");
  let position = start;
  const ordinal = (): number => {
    if (!Number.isSafeInteger(position))
      throw new RangeError("List numbering exceeds the safe integer range");
    return position++;
  };
  const path = new WeakSet<object>();
  const composed = (node: JSXRenderable, depth = 0): JSXRenderable => {
    if (depth > 100)
      throw new RangeError("List children exceed maximum depth 100");
    if (Array.isArray(node)) {
      if (path.has(node)) throw new TypeError("Circular List children");
      path.add(node);
      try {
        return node.map((value) => composed(value, depth + 1));
      } finally {
        path.delete(node);
      }
    }
    // ThemeProvider can wrap an element's type, so inspect its original source.
    // Unknown components stay lazy and never consume an automatic item number.
    if (isJsxElement(node)) {
      const type = sourceElementType(node);
      if (type === ListItem)
        return ordered
          ? cloneSourceElement(node, { [inheritedOrdinal]: ordinal() })
          : node;
      if (type === Fragment || type === ThemeProvider)
        return cloneSourceElement(node, {
          children: composed(node.props.children, depth + 1),
        });
    }
    return node;
  };
  const content = [
    items?.map((value) =>
      jsx(ListItem, {
        ...(ordered ? { [inheritedOrdinal]: ordinal() } : {}),
        children: value,
      })
    ),
    composed(children),
  ];
  const list = themedColumn(
    theme,
    content,
    `width:100%;margin:0;padding:0;color:${theme.palette.textSecondary}`
  );
  return customizeRoot(
    jsx(list.type, { ...list.props, role: "list" }),
    props,
    theme,
    "List"
  );
}

export function ListItem(props: ListItemProps): JSXElement {
  const theme = themeOf(props);
  const values = displayProps(props);
  const ordinal = (props as { [inheritedOrdinal]?: number })[inheritedOrdinal];
  const marker = values.marker !== undefined ? values.marker
    : ordinal !== undefined ? [ordinal, theme.text.rankSeparator]
    : theme.text.listMarker;
  const hasMarker = marker != null && typeof marker !== "boolean";
  const item = themedDiv(
    theme,
    `display:flex;flex-direction:row;align-items:flex-start;gap:${theme.spacing.sm}px;margin:${theme.spacing.xs}px 0;min-width:0`,
    [
      hasMarker
        ? themedDiv(
            theme,
            `display:flex;justify-content:flex-end;min-width:${theme.spacing.lg}px;flex-shrink:0;color:${theme.palette.accentMem}`,
            marker
          )
        : null,
      themedColumn(theme, values.children, "flex:1;min-width:0"),
    ]
  );
  return customizeRoot(
    jsx(item.type, { ...item.props, role: "listitem" }),
    props,
    theme,
    "ListItem"
  );
}
