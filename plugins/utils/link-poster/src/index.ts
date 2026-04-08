/**
 * @zhin.js/plugin-link-poster
 *
 * 自动检测消息中的 Bilibili / GitHub / 抖音 / 小红书链接，
 * 生成精美内容海报图片并回复。
 *
 * 依赖：@zhin.js/plugin-html-renderer（提供 html-renderer Context）
 */
import { usePlugin, segment } from 'zhin.js'
import { detectAndParse } from './platforms.js'
import { renderPoster } from './render.js'

// html-renderer Context 的最小类型声明（运行时由 html-renderer 插件注入）
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      'html-renderer': {
        render(html: string, options?: { width?: number }): Promise<{
          data: Buffer | string
          format: string
          mimeType: string
        }>
      }
    }
  }
}

const { addMiddleware, useContext, logger } = usePlugin()

useContext('html-renderer', (renderer) => {
  logger.info('link-poster: html-renderer 就绪，已启用链接海报')

  addMiddleware(async (message, next) => {
    const text = message.$raw || ''

    // 快速跳过：消息中没有 http 链接
    if (!text.includes('http')) return next()

    try {
      const meta = await detectAndParse(text)
      if (meta) {
        const html = renderPoster(meta)
        const result = await renderer.render(html, { width: 480 })

        if (result.format === 'png' && typeof result.data === 'object') {
          const base64 = Buffer.from(result.data as Buffer).toString('base64')
          const dataUrl = `data:${result.mimeType};base64,${base64}`
          await message.$reply(segment('image', { url: dataUrl }))
        }
      }
    } catch (e) {
      logger.warn(`link-poster: 海报生成失败 - ${e instanceof Error ? e.message : e}`)
    }

    return next()
  })
})
