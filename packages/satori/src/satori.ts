import type { TwConfig } from 'twrnc'
import type { JSDOM } from 'jsdom'
import type { SatoriNode } from './layout.js'

import getYoga, { init } from './yoga/index.js'
import layout from './layout.js'
import FontLoader, { FontOptions } from './font.js'
import svg from './builder/svg.js'
import { segment } from './utils.js'
import { detectLanguageCode, LangCode, Locale } from './language.js'
import { preProcessNode } from './handler/preprocess.js'
import { cache, inflightRequests } from './handler/image.js'
import type { Yoga } from 'yoga-wasm-web'
const fontCache = new WeakMap()

export type SatoriOptions = (
  | {
      width: number
      height: number
    }
  | {
      width: number
    }
  | {
      height: number
    }
) & {
  fonts: FontOptions[]
  embedFont?: boolean
  debug?: boolean
  graphemeImages?: Record<string, string>
  loadAdditionalAsset?: (
    languageCode: string,
    segment: string
  ) => Promise<string | Array<FontOptions>>
  tailwindConfig?: TwConfig
  onNodeDetected?: (node: SatoriNode) => void
  pointScaleFactor?: number
}
export type { SatoriNode }

export { init }

export default async function satori(
  dom: JSDOM,
  options: SatoriOptions
): Promise<string> {
  const Yoga = await getYoga()
  if (!Yoga || !Yoga.Node) {
    throw new Error(
      'Satori is not initialized: expect `yoga` to be loaded, got ' + Yoga
    )
  }
  options.fonts = options.fonts || []

  let font: FontLoader
  if (fontCache.has(options.fonts)) {
    font = fontCache.get(options.fonts)
  } else {
    fontCache.set(options.fonts, (font = new FontLoader(options.fonts)))
  }

  const definedWidth = 'width' in options ? options.width : undefined
  const definedHeight = 'height' in options ? options.height : undefined

  const root = getRootNode(Yoga, options.pointScaleFactor)
  if (definedWidth) root.setWidth(definedWidth)
  if (definedHeight) root.setHeight(definedHeight)
  root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)
  root.setFlexWrap(Yoga.WRAP_WRAP)
  root.setAlignContent(Yoga.ALIGN_AUTO)
  root.setAlignItems(Yoga.ALIGN_FLEX_START)
  root.setJustifyContent(Yoga.JUSTIFY_FLEX_START)
  root.setOverflow(Yoga.OVERFLOW_HIDDEN)

  const graphemeImages = { ...options.graphemeImages }
  // Some Chinese characters have different glyphs in Chinese and
  // Japanese, but their Unicode is the same. If the user needs to display
  // the Chinese and Japanese characters simultaneously correctly, the user
  // needs to download the Chinese and Japanese fonts, respectively.
  // Assuming that the user has downloaded the corresponding Japanese font,
  // to let the program realize that the font has not been downloaded in Chinese,
  // we need to prohibit Japanese as the fallback when executing `engine.has`.
  //
  // This causes a problem. Consider a scenario where we need to display Chinese
  // correctly under tags with `lang="ja"` set. `engine.has` will repeatedly treat
  // the Chinese as missing font because we have removed the Chinese as a fallback.
  // To address this situation, we may need to add `processedWordsMissingFont`
  const processedWordsMissingFonts = new Set()

  cache.clear()
  inflightRequests.clear()
  
  const document = dom.window.document
  const computedStyles = new Map()
  
  function getPropertyNames(style: CSSStyleDeclaration): string[] {
    const result: string[] = []
    for (let i = 0; i < style.length; i++) {
      result.push(style.item(i))
    }
    return result
  }

  function getComputedStyle(element: Element) {
    if (!computedStyles.has(element)) {
      const style = dom.window.getComputedStyle(element)
      // Convert snake-case to camelCase
      const camelCaseStyle: { [key: string]: string } = {}
      // Get all style properties
      const propertyNames = getPropertyNames(style)
      for (const propertyName of propertyNames) {
        const camelKey = propertyName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        camelCaseStyle[camelKey] = style.getPropertyValue(propertyName)
      }
      computedStyles.set(element, camelCaseStyle)
    }
    return computedStyles.get(element)
  }

  await preProcessNode(document.body)

  const handler = layout(document.body, {
    id: 'id',
    parentStyle: {},
    inheritedStyle: {
      fontSize: 16,
      fontWeight: 'normal',
      fontFamily: 'serif',
      fontStyle: 'normal',
      lineHeight: 'normal',
      color: 'black',
      opacity: 1,
      whiteSpace: 'normal',

      // Special style properties:
      _viewportWidth: definedWidth,
      _viewportHeight: definedHeight,
    },
    parent: root,
    font,
    embedFont: options.embedFont,
    debug: options.debug,
    graphemeImages,
    canLoadAdditionalAssets: !!options.loadAdditionalAsset,
    onNodeDetected: options.onNodeDetected,
    getComputedStyle,
    // Initialize root parent dimensions
    parentDimensions: {
      width: definedWidth || 0,
      height: definedHeight || 0,
      position: 'static',
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    },
  })

  const segmentsMissingFont = (await handler.next()).value as {
    word: string
    locale?: Locale
  }[]

  if (options.loadAdditionalAsset) {
    if (segmentsMissingFont.length) {
      const languageCodes = convertToLanguageCodes(segmentsMissingFont)
      const fonts: FontOptions[] = []
      const images: Record<string, string> = {}

      await Promise.all(
        Object.entries(languageCodes).flatMap(([code, segments]) =>
          segments.map((_segment) => {
            const key = `${code}_${_segment}`
            if (processedWordsMissingFonts.has(key)) {
              return null
            }
            processedWordsMissingFonts.add(key)

            return options
              .loadAdditionalAsset(code, _segment)
              .then((asset: any) => {
                if (typeof asset === 'string') {
                  images[_segment] = asset
                } else if (asset) {
                  if (Array.isArray(asset)) {
                    fonts.push(...asset)
                  } else {
                    fonts.push(asset)
                  }
                }
              })
          })
        )
      )

      // Directly mutate the font provider and the grapheme map.
      font.addFonts(fonts)
      Object.assign(graphemeImages, images)
    }
  }

  await handler.next()
  root.calculateLayout(definedWidth, definedHeight, Yoga.DIRECTION_LTR)

  const content = (await handler.next([0, 0])).value as string

  const computedWidth = root.getComputedWidth()
  const computedHeight = root.getComputedHeight()

  root.freeRecursive()

  return svg({ width: computedWidth, height: computedHeight, content })
}

function getRootNode(
  Yoga: Yoga,
  pointScaleFactor?: SatoriOptions['pointScaleFactor']
) {
  if (!pointScaleFactor) {
    return Yoga.Node.create()
  } else {
    const config = Yoga.Config.create()
    config.setPointScaleFactor(pointScaleFactor)
    return Yoga.Node.createWithConfig(config)
  }
}

function convertToLanguageCodes(
  segmentsMissingFont: { word: string; locale?: Locale }[]
): Partial<Record<LangCode, string[]>> {
  const languageCodes = {}
  let wordsByCode = {}

  for (const { word, locale } of segmentsMissingFont) {
    const code = detectLanguageCode(word, locale).join('|')
    wordsByCode[code] = wordsByCode[code] || ''
    wordsByCode[code] += word
  }

  Object.keys(wordsByCode).forEach((code: LangCode) => {
    languageCodes[code] = languageCodes[code] || []
    if (code === 'emoji') {
      languageCodes[code].push(
        ...unique(segment(wordsByCode[code], 'grapheme'))
      )
    } else {
      languageCodes[code][0] = languageCodes[code][0] || ''
      languageCodes[code][0] += unique(
        segment(
          wordsByCode[code],
          'grapheme',
          code === 'unknown' ? undefined : code
        )
      ).join('')
    }
  })

  return languageCodes
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}
