import { resolveImageData, cache } from './image.js'
import { midline, parseViewBox } from '../utils.js'
import { Node } from '../utils/dom.js'

// Based on
// https://raw.githubusercontent.com/facebook/react/master/packages/react-dom/src/shared/possibleStandardNames.js
const ATTRIBUTE_MAPPING = {
  accentHeight: 'accent-height',
  alignmentBaseline: 'alignment-baseline',
  arabicForm: 'arabic-form',
  baselineShift: 'baseline-shift',
  capHeight: 'cap-height',
  clipPath: 'clip-path',
  clipRule: 'clip-rule',
  colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters',
  colorProfile: 'color-profile',
  colorRendering: 'color-rendering',
  dominantBaseline: 'dominant-baseline',
  enableBackground: 'enable-background',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  floodColor: 'flood-color',
  floodOpacity: 'flood-opacity',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontSizeAdjust: 'font-size-adjust',
  fontStretch: 'font-stretch',
  fontStyle: 'font-style',
  fontVariant: 'font-variant',
  fontWeight: 'font-weight',
  glyphName: 'glyph-name',
  glyphOrientationHorizontal: 'glyph-orientation-horizontal',
  glyphOrientationVertical: 'glyph-orientation-vertical',
  horizAdvX: 'horiz-adv-x',
  horizOriginX: 'horiz-origin-x',
  href: 'href',
  imageRendering: 'image-rendering',
  letterSpacing: 'letter-spacing',
  lightingColor: 'lighting-color',
  markerEnd: 'marker-end',
  markerMid: 'marker-mid',
  markerStart: 'marker-start',
  overlinePosition: 'overline-position',
  overlineThickness: 'overline-thickness',
  paintOrder: 'paint-order',
  panose1: 'panose-1',
  pointerEvents: 'pointer-events',
  renderingIntent: 'rendering-intent',
  shapeRendering: 'shape-rendering',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  strikethroughPosition: 'strikethrough-position',
  strikethroughThickness: 'strikethrough-thickness',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width',
  textAnchor: 'text-anchor',
  textDecoration: 'text-decoration',
  textRendering: 'text-rendering',
  underlinePosition: 'underline-position',
  underlineThickness: 'underline-thickness',
  unicodeBidi: 'unicode-bidi',
  unicodeRange: 'unicode-range',
  unitsPerEm: 'units-per-em',
  vAlphabetic: 'v-alphabetic',
  vHanging: 'v-hanging',
  vIdeographic: 'v-ideographic',
  vMathematical: 'v-mathematical',
  vectorEffect: 'vector-effect',
  vertAdvY: 'vert-adv-y',
  vertOriginX: 'vert-origin-x',
  vertOriginY: 'vert-origin-y',
  wordSpacing: 'word-spacing',
  writingMode: 'writing-mode',
  xHeight: 'x-height',
  xlinkActuate: 'xlink:actuate',
  xlinkArcrole: 'xlink:arcrole',
  xlinkHref: 'xlink:href',
  xlinkRole: 'xlink:role',
  xlinkShow: 'xlink:show',
  xlinkTitle: 'xlink:title',
  xlinkType: 'xlink:type',
  xmlBase: 'xml:base',
  xmlLang: 'xml:lang',
  xmlSpace: 'xml:space',
  xmlnsXlink: 'xmlns:xlink',
} as const

// From https://github.com/yoksel/url-encoder/blob/master/src/js/script.js
const SVGSymbols = /[\r\n%#()<>?[\\\]^`{|}"']/g

function translateSVGNodeToSVGString(
  node: Element | Text | (Element | Text)[],
  inheritedColor: string
): string {
  if (!node) return ''
  if (Array.isArray(node)) {
    return node
      .map((n) => translateSVGNodeToSVGString(n, inheritedColor))
      .join('')
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const tagName = element.tagName.toLowerCase()
  
  if (tagName === 'text') {
    throw new Error(
      '<text> nodes are not currently supported, please convert them to <path>'
    )
  }

  const computedStyle = window.getComputedStyle(element)
  const currentColor = computedStyle.color || inheritedColor

  const attrs = Array.from(element.attributes)
    .map(attr => {
      let value = attr.value
      if (value.toLowerCase() === 'currentcolor') {
        value = currentColor
      }

      if (attr.name === 'href' && tagName === 'image') {
        return ` ${ATTRIBUTE_MAPPING[attr.name] || attr.name}="${cache.get(value)[0]}"`
      }
      return ` ${ATTRIBUTE_MAPPING[attr.name] || attr.name}="${value}"`
    })
    .join('')

  const styles = computedStyle
    ? ` style="${Object.entries(computedStyle)
        .filter(([k]) => computedStyle.getPropertyValue(k))
        .map(([k, v]) => `${midline(k)}:${v}`)
        .join(';')}"`
    : ''

  return `<${tagName}${attrs}${styles}>${Array.from(element.childNodes)
    .map(child => translateSVGNodeToSVGString(child as Element | Text, currentColor))
    .join('')}</${tagName}>`
}

/**
 * pre process node and resolve absolute link to img data for image element
 * @param node Element | Text
 * @returns
 */
export async function preProcessNode(node: Element | Text) {
  const set = new Set<string | ArrayBuffer>()
  const walk = (_node: Element | Text) => {
    if (!_node) return
    if (_node.nodeType !== Node.ELEMENT_NODE) return

    const element = _node as Element
    const tagName = element.tagName.toLowerCase()

    if (tagName === 'image') {
      const href = element.getAttribute('href')
      if (href && !set.has(href)) {
        set.add(href)
        }
    } else if (tagName === 'img') {
      const src = element.getAttribute('src')
      if (src && !set.has(src)) {
        set.add(src)
      }
    }

    Array.from(element.childNodes).forEach(child => walk(child as Element | Text))
  }

  walk(node)

  return Promise.all(Array.from(set).map((s) => resolveImageData(s)))
}

export async function SVGNodeToImage(
  node: Element,
  inheritedColor: string
): Promise<string> {
  const viewBox = node.getAttribute('viewBox') || node.getAttribute('viewbox')
  const width = node.getAttribute('width')
  const height = node.getAttribute('height')
  const className = node.getAttribute('class')
  const computedStyle = window.getComputedStyle(node)

  // Convert attributes to props-like object
  const props: Record<string, string> = Array.from(node.attributes).reduce((acc, attr) => {
    if (!['viewBox', 'viewbox', 'width', 'height', 'class', 'style'].includes(attr.name)) {
      acc[attr.name] = attr.value
    }
    return acc
  }, {} as Record<string, string>)

  // We directly assign the xmlns attribute here to deduplicate.
  props.xmlns = 'http://www.w3.org/2000/svg'

  const currentColor = computedStyle.color || inheritedColor
  const viewBoxSize = viewBox ? parseViewBox(viewBox) : null
  const ratio = viewBoxSize ? viewBoxSize[3] / viewBoxSize[2] : null

  let finalWidth = width ? parseFloat(width) : null
  let finalHeight = height ? parseFloat(height) : null

  finalWidth = finalWidth || (ratio && finalHeight ? finalHeight / ratio : null)
  finalHeight = finalHeight || (ratio && finalWidth ? finalWidth * ratio : null)

  props.width = finalWidth?.toString() || ''
  props.height = finalHeight?.toString() || ''
  if (viewBox) props.viewBox = viewBox

  return `data:image/svg+xml;utf8,${`<svg ${Object.entries(props)
    .map(([k, _v]) => {
      if (typeof _v === 'string' && _v.toLowerCase() === 'currentcolor') {
        _v = currentColor
      }
      return `${k}="${_v}"`
    })
    .join(' ')}>${translateSVGNodeToSVGString(
    Array.from(node.childNodes) as (Element | Text)[],
    currentColor
  )}</svg>`.replace(SVGSymbols, encodeURIComponent)}`
}
