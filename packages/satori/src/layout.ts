/**
 * This module is used to calculate the layout of the current sub-tree.
 */

import type { Node as YogaNode } from 'yoga-wasm-web'
import { Node } from './utils/dom.js'
import getYoga from './yoga/index.js'
import {
  buildXMLString,
} from './utils.js'
import { SVGNodeToImage } from './handler/preprocess.js'
import computeStyle from './handler/compute.js'
import FontLoader from './font.js'
import buildTextNodes from './text/index.js'
import rect from './builder/rect.js'
import { Locale, normalizeLocale } from './language.js'
import { SerializedStyle } from './handler/expand.js'

// Block-level elements that should be displayed vertically
// const BLOCK_ELEMENTS = new Set([
//   'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
//   'section', 'article', 'aside', 'nav', 'header', 'footer',
//   'main', 'form', 'fieldset', 'table', 'ul', 'ol', 'dl',
//   'blockquote', 'figure', 'figcaption', 'address', 'pre'
// ])

export interface LayoutContext {
  id: string
  parentStyle: SerializedStyle
  inheritedStyle: SerializedStyle
  isInheritingTransform?: boolean
  parent: YogaNode
  font: FontLoader
  embedFont: boolean
  debug?: boolean
  graphemeImages?: Record<string, string>
  canLoadAdditionalAssets?: boolean
  locale?: Locale
  onNodeDetected?: (node: SatoriNode) => void
  getComputedStyle: (element: Element) => Record<string, string>
  // Parent element dimensions and position for percentage calculations
  parentDimensions: {
    width: number
    height: number
    position: string
    left: number
    top: number
    right: number
    bottom: number
  }
}

// Helper function to find the nearest positioned ancestor
function findPositionedAncestor(element: Element, getComputedStyle: (element: Element) => Record<string, string>): Element | null {
  let current = element.parentElement
  while (current) {
    const style = getComputedStyle(current)
    if (style.position !== 'static') {
      return current
    }
    current = current.parentElement
  }
  return null
}

// Helper function to parse viewport units
function parseViewportUnits(value: string | number | undefined, viewportWidth: number, viewportHeight: number): number {
  if (typeof value === 'number') return value
  if (!value || typeof value !== 'string') return 0

  const match = value.match(/^(-?\d*\.?\d+)(vh|vw|vmin|vmax)$/)
  if (!match) return parseFloat(value) || 0

  const [, num, unit] = match
  const percentage = parseFloat(num)

  switch (unit) {
    case 'vh':
      return (percentage / 100) * viewportHeight
    case 'vw':
      return (percentage / 100) * viewportWidth
    case 'vmin':
      return (percentage / 100) * Math.min(viewportWidth, viewportHeight)
    case 'vmax':
      return (percentage / 100) * Math.max(viewportWidth, viewportHeight)
    default:
      return parseFloat(value) || 0
  }
}

// Helper function to parse dimension value
function parseDimension(value: string | number | undefined, context: LayoutContext): number {
  if (typeof value === 'number') return value
  if (!value || typeof value !== 'string') return 0

  // Check for viewport units
  if (value.endsWith('vh') || value.endsWith('vw') || value.endsWith('vmin') || value.endsWith('vmax')) {
    const viewportWidth = context.inheritedStyle._viewportWidth as number
    const viewportHeight = context.inheritedStyle._viewportHeight as number
    return parseViewportUnits(value, viewportWidth, viewportHeight)
  }

  return parseFloat(value) || 0
}

// Helper function to convert percentage to pixels
function percentageToPixels(value: string | number | undefined, base: number, context: LayoutContext): number {
  if (typeof value === 'number') return value
  if (!value || typeof value !== 'string') return 0

  // Check for viewport units first
  if (value.endsWith('vh') || value.endsWith('vw') || value.endsWith('vmin') || value.endsWith('vmax')) {
    const viewportWidth = context.inheritedStyle._viewportWidth as number
    const viewportHeight = context.inheritedStyle._viewportHeight as number
    return parseViewportUnits(value, viewportWidth, viewportHeight)
  }

  if (value.endsWith('%')) {
    const percentage = parseFloat(value)
    return (percentage / 100) * base
  }
  return parseFloat(value) || 0
}

export interface SatoriNode {
  // Layout information.
  left: number
  top: number
  width: number
  height: number
  type: string
  key?: string | number
  props: Record<string, any>
  textContent?: string
}

export default async function* layout(
  element: Element | Text | null,
  context: LayoutContext
): AsyncGenerator<
  { word: string; locale?: string }[],
  string,
  [number, number]
> {
  const Yoga = await getYoga()
  const {
    id,
    inheritedStyle,
    parent,
    font,
    debug,
    locale,
    embedFont = true,
    graphemeImages,
    canLoadAdditionalAssets,
    getComputedStyle,
    parentDimensions,
  } = context

  // 1. Pre-process the node.
  if (!element) {
    yield
    yield
    return ''
  }

  // Handle text nodes
  if (element.nodeType === Node.TEXT_NODE) {
    const iter = buildTextNodes(element.textContent || '', context)
    yield (await iter.next()).value as { word: string; locale?: Locale }[]
    await iter.next()
    const offset = yield
    return (await iter.next(offset)).value as string
  }

  // Handle element nodes
  if (element.nodeType === Node.ELEMENT_NODE) {
    const elementNode = element as Element
    const node = Yoga.Node.create()
    parent.insertChild(node, parent.getChildCount())

    const elementStyle = getComputedStyle ? getComputedStyle(elementNode) : {}
    const tagName = elementNode.tagName.toLowerCase()

    // 过滤掉非法 textAlign
    if (elementStyle.textAlign === '-webkit-match-parent') {
      elementStyle.textAlign = 'left'
    }
    
    // Calculate dimensions based on parent
    const position = elementStyle.position || 'static'
    let referenceElement = position === 'absolute' ? findPositionedAncestor(elementNode, getComputedStyle) : elementNode.parentElement
    const referenceStyle = referenceElement ? getComputedStyle(referenceElement) : parentDimensions

    // Convert percentage values to pixels
    const dimensions = {
      width: typeof elementStyle.width === 'string' && 
        (elementStyle.width.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.width))
        ? percentageToPixels(elementStyle.width, parseDimension(referenceStyle.width, context), context)
        : parseDimension(elementStyle.width, context),
      height: typeof elementStyle.height === 'string' && 
        (elementStyle.height.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.height))
        ? percentageToPixels(elementStyle.height, parseDimension(referenceStyle.height, context), context)
        : parseDimension(elementStyle.height, context),
      left: typeof elementStyle.left === 'string' && 
        (elementStyle.left.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.left))
        ? percentageToPixels(elementStyle.left, parseDimension(referenceStyle.width, context), context)
        : parseDimension(elementStyle.left, context),
      top: typeof elementStyle.top === 'string' && 
        (elementStyle.top.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.top))
        ? percentageToPixels(elementStyle.top, parseDimension(referenceStyle.height, context), context)
        : parseDimension(elementStyle.top, context),
      right: typeof elementStyle.right === 'string' && 
        (elementStyle.right.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.right))
        ? percentageToPixels(elementStyle.right, parseDimension(referenceStyle.width, context), context)
        : parseDimension(elementStyle.right, context),
      bottom: typeof elementStyle.bottom === 'string' && 
        (elementStyle.bottom.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.bottom))
        ? percentageToPixels(elementStyle.bottom, parseDimension(referenceStyle.height, context), context)
        : parseDimension(elementStyle.bottom, context),
    }

    // Update element style with calculated values
    if (typeof elementStyle.width === 'string' && 
      (elementStyle.width.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.width))) {
      elementStyle.width = `${dimensions.width}px`
    }
    if (typeof elementStyle.height === 'string' && 
      (elementStyle.height.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.height))) {
      elementStyle.height = `${dimensions.height}px`
    }
    if (typeof elementStyle.left === 'string' && 
      (elementStyle.left.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.left))) {
      elementStyle.left = `${dimensions.left}px`
    }
    if (typeof elementStyle.top === 'string' && 
      (elementStyle.top.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.top))) {
      elementStyle.top = `${dimensions.top}px`
    }
    if (typeof elementStyle.right === 'string' && 
      (elementStyle.right.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.right))) {
      elementStyle.right = `${dimensions.right}px`
    }
    if (typeof elementStyle.bottom === 'string' && 
      (elementStyle.bottom.endsWith('%') || /v(h|w|min|max)$/.test(elementStyle.bottom))) {
      elementStyle.bottom = `${dimensions.bottom}px`
    }

    // // Set default display style based on element type
    // if (!elementStyle.display || elementStyle.display === '') {
    //   if (BLOCK_ELEMENTS.has(tagName)) {
    //     elementStyle.display = 'flex'
    //     node.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN)
    //   } else {
    //     elementStyle.display = 'flex'
    //     node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)
    //     node.setFlexWrap(Yoga.WRAP_WRAP)
    //   }
    // }

    const [computedStyle, newInheritableStyle] = await computeStyle(
      node,
      tagName,
      inheritedStyle,
      elementStyle,
      {
        ...Array.from(elementNode.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value
          return acc
        }, {}),
        style: elementStyle,
        tw: elementNode.getAttribute('tw'),
        lang: elementNode.getAttribute('lang') || locale
      }
    )

    // If the element is inheriting the parent `transform`, or applying its own.
    const isInheritingTransform = computedStyle.transform === inheritedStyle.transform
    if (!isInheritingTransform) {
      ;(computedStyle.transform as any).__parent = inheritedStyle.transform
    }

    // Handle overflow and clip-path
    if (
      computedStyle.overflow === 'hidden' ||
      (computedStyle.clipPath && computedStyle.clipPath !== 'none')
    ) {
      newInheritableStyle._inheritedClipPathId = `satori_cp-${id}`
      newInheritableStyle._inheritedMaskId = `satori_om-${id}`
    }

    if (computedStyle.maskImage) {
      newInheritableStyle._inheritedMaskId = `satori_mi-${id}`
    }

    if (computedStyle.backgroundClip === 'text') {
      const mutateRefValue = { value: '' } as any
      newInheritableStyle._inheritedBackgroundClipTextPath = mutateRefValue
      computedStyle._inheritedBackgroundClipTextPath = mutateRefValue
    }

    // Process children with updated parent dimensions
    const iterators: ReturnType<typeof layout>[] = []
    let i = 0
    const segmentsMissingFont: { word: string; locale?: string }[] = []

    for (const child of Array.from(elementNode.childNodes)) {
      const iter = layout(child as Element | Text, {
        id: id + '-' + i++,
        parentStyle: computedStyle,
        inheritedStyle: newInheritableStyle,
        isInheritingTransform: true,
        parent: node,
        font,
        embedFont,
        debug,
        graphemeImages,
        canLoadAdditionalAssets,
        locale: normalizeLocale(elementNode.getAttribute('lang') || locale),
        getComputedStyle,
        onNodeDetected: context.onNodeDetected,
        parentDimensions: {
          width: dimensions.width || parentDimensions.width,
          height: dimensions.height || parentDimensions.height,
          position: elementStyle.position || 'static',
          left: dimensions.left,
          top: dimensions.top,
          right: dimensions.right,
          bottom: dimensions.bottom,
        },
      })
      if (canLoadAdditionalAssets) {
        segmentsMissingFont.push(...(((await iter.next()).value as any) || []))
      } else {
        await iter.next()
      }
      iterators.push(iter)
    }
    yield segmentsMissingFont
    for (const iter of iterators) await iter.next()

    // Post-process the node
    const [x, y] = yield
    let { left, top, width, height } = node.getComputedLayout()
    left += x
    top += y

    let childrenRenderResult = ''
    let baseRenderResult = ''
    let depsRenderResult = ''

    // Emit event for the current node. We don't pass the children prop to the
    // event handler because everything is already flattened, unless it's a text
    // node.
    const attributes = Array.from(elementNode.attributes).reduce((acc, attr) => {
      acc[attr.name] = attr.value
      return acc
    }, {})

    context.onNodeDetected?.({
      left,
      top,
      width,
      height,
      type: elementNode.tagName.toLowerCase(),
      props: attributes,
      key: elementNode.getAttribute('key'),
      textContent: elementNode.textContent,
    })

    // Generate the rendered markup for the current node.
    if (elementNode.tagName.toLowerCase() === 'img') {
      const src = computedStyle.__src as string
      baseRenderResult = await rect(
        {
          id,
          left,
          top,
          width,
          height,
          src,
          isInheritingTransform,
          debug,
        },
        computedStyle,
        newInheritableStyle
      )
    } else if (elementNode.tagName.toLowerCase() === 'svg') {
      // When entering a <svg> node, we need to convert it to a <img> with the
      // SVG data URL embedded.
      const currentColor = computedStyle.color
      const src = await SVGNodeToImage(elementNode, currentColor)
      baseRenderResult = await rect(
        {
          id,
          left,
          top,
          width,
          height,
          src,
          isInheritingTransform,
          debug,
        },
        computedStyle,
        newInheritableStyle
      )
    } else {
      // Remove the display check since we now handle it automatically
      baseRenderResult = await rect(
        {
          id,
          left,
          top,
          width,
          height,
          isInheritingTransform,
          debug,
        },
        computedStyle,
        newInheritableStyle
      )
    }

    // Generate the rendered markup for the children.
    for (const iter of iterators) {
      childrenRenderResult += (await iter.next([left, top])).value
    }

    // An extra pass to generate the special background-clip shape collected from
    // children.
    if (computedStyle._inheritedBackgroundClipTextPath) {
      depsRenderResult += buildXMLString(
        'clipPath',
        {
          id: `satori_bct-${id}`,
          'clip-path': computedStyle._inheritedClipPathId
            ? `url(#${computedStyle._inheritedClipPathId})`
            : undefined,
        },
        (computedStyle._inheritedBackgroundClipTextPath as any).value
      )
    }

    return depsRenderResult + baseRenderResult + childrenRenderResult
  }

  // Handle other node types (comments, etc.)
  yield
  yield
  return ''
}
