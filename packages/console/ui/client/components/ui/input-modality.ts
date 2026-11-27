import type * as React from "react"
import { useCallback, useRef } from "react"

/**
 * Which input a menu or list is being used with (soft cards D40, menu focus): `keyboard` shows the
 * 2px focus ring on the focused item, `pointer` only the sunken fill. Radix moves the focus to the
 * item under the pointer by script, and browsers may count that as `:focus-visible`, so the CSS
 * cannot tell the two apart on its own. The content element carries `data-input`.
 */
export type MenuInput = "keyboard" | "pointer"

let lastInput: MenuInput = "keyboard"
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  // The input that opened the menu: recorded before the menu mounts (capture phase, document level).
  // Skipped without a DOM (server rendering, test doubles of `document`).
  document.addEventListener("pointerdown", () => { lastInput = "pointer" }, true)
  document.addEventListener("keydown", (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) lastInput = "keyboard"
  }, true)
}

/**
 * Props for a menu / listbox content element: `data-input` is set from the input that opened it
 * when the element mounts (Radix Select keeps its React tree while closed, so this is done on the
 * DOM node, not in state), then follows the pointer (moving over the content) and the keyboard (a
 * key inside it). The caller's own ref and handlers still run.
 */
export function useMenuInput<T extends HTMLElement>(
  forwardedRef: React.ForwardedRef<T>,
  { onPointerMove, onKeyDown }: {
    onPointerMove?: React.PointerEventHandler<T>
    onKeyDown?: React.KeyboardEventHandler<T>
  },
) {
  const forwarded = useRef(forwardedRef)
  forwarded.current = forwardedRef
  const ref = useCallback((node: T | null) => {
    if (node) node.dataset.input = lastInput
    const target = forwarded.current
    if (typeof target === "function") target(node)
    else if (target) target.current = node
  }, [])
  return {
    ref,
    onPointerMove: (event: React.PointerEvent<T>) => {
      onPointerMove?.(event)
      if (event.pointerType !== "touch") event.currentTarget.dataset.input = "pointer"
    },
    onKeyDown: (event: React.KeyboardEvent<T>) => {
      onKeyDown?.(event)
      event.currentTarget.dataset.input = "keyboard"
    },
  }
}
