/**
 * Icon rules of @zhin.js/console-ui (ADR 0063 D30, zhinjs/console#125): lucide icons only, one
 * stroke width everywhere, 16px inside controls and 18px in navigation. Icons sit directly on the
 * surface; lists, ⌘K and toolbars never put them in a tinted square.
 */
export const CONSOLE_ICON_STROKE_WIDTH = 1.75

/** Icon sizes in px: `control` inside buttons, inputs, menus and badges; `nav` in navigation. */
export const CONSOLE_ICON_SIZE = Object.freeze({ control: 16, nav: 18 } as const)
