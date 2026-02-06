import { beforeAll, expect } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'
import { toMatchImageSnapshot } from 'jest-image-snapshot'
import { readFile } from 'node:fs/promises'
import yoga from 'yoga-wasm-web/auto'

import { init, type SatoriOptions } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(__dirname, 'assets')

export function initYogaWasm() {
  beforeAll(async () => {
    init(yoga)
  })
}

export async function getDynamicAsset(text: string): Promise<Buffer> {
  const fontPath = join(ASSETS_DIR, text)
  return await readFile(fontPath)
}

export async function loadDynamicAsset(code: string, text: string) {
  return [
    {
      name: `satori_${code}_fallback_${text}`,
      data: await getDynamicAsset(text),
      weight: 400,
      style: 'normal',
      lang: code === 'unknown' ? undefined : code.split('|')[0],
    },
  ]
}

export function initFonts(callback: (fonts: SatoriOptions['fonts']) => void) {
  beforeAll(async () => {
    const robotoPath = join(ASSETS_DIR, 'Roboto-Regular.ttf')
    const robotoData = await readFile(robotoPath)
    
    const chineseFontPath = join(ASSETS_DIR, '你好')
    const chineseFontData = await readFile(chineseFontPath)
    
    callback([
      {
        name: 'Roboto',
        data: robotoData,
        weight: 400,
        style: 'normal',
      },
      {
        name: '你好',
        data: chineseFontData,
        weight: 400,
        style: 'normal',
        lang: 'zh-CN',
      },
    ])
  })
}

export function toImage(svg: string, width = 100) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: width,
    },
    font: {
      // As system fallback font
      fontFiles: [
        join(ASSETS_DIR, 'playfair-display.ttf'),
      ],
      loadSystemFonts: false,
      defaultFontFamily: 'Playfair Display',
    },
  })
  const pngData = resvg.render()
  return pngData.asPng()
}

declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchImageSnapshot(): R
    }
  }
}

expect.extend({ toMatchImageSnapshot })
