import { MessageCommand, ZhinTool, usePlugin } from 'zhin.js'

const { addCommand, addTool, logger } = usePlugin()

const QR_API_BASE = 'https://api.qrserver.com/v1'

// ====== 命令：二维码 <text> ======
addCommand(
  new MessageCommand('二维码 <text:text>')
    .desc('根据文本或链接生成二维码图片')
    .action(async (_message, result) => {
      const text = result.params.text
      const qrUrl = `${QR_API_BASE}/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`
      logger.info(`生成二维码: ${text}`)
      return [{ type: 'image' as const, data: { url: qrUrl } }]
    }),
)

// ====== 命令：扫码 <url> ======
addCommand(
  new MessageCommand('扫码 <url:text>')
    .desc('识别图片中的二维码内容')
    .action(async (_message, result) => {
      const imageUrl = result.params.url
      const apiUrl = `${QR_API_BASE}/read-qr-code/?fileurl=${encodeURIComponent(imageUrl)}`
      try {
        const response = await fetch(apiUrl)
        if (!response.ok) {
          return '二维码识别服务请求失败'
        }
        const data = (await response.json()) as Array<{
          symbol: Array<{ data: string | null; error: string | null }>
        }>
        const symbol = data?.[0]?.symbol?.[0]
        if (!symbol || symbol.error || !symbol.data) {
          return `未能识别二维码内容${symbol?.error ? `：${symbol.error}` : ''}`
        }
        return `识别结果：${symbol.data}`
      } catch (e) {
        logger.warn('扫码失败', e)
        return '二维码识别失败，请检查图片链接是否有效'
      }
    }),
)

// ====== AI 工具：qrcode_generate ======
addTool(
  new ZhinTool('qrcode_generate')
    .desc('根据文本或 URL 生成二维码图片')
    .keyword('二维码', 'QR', 'qrcode')
    .tag('qrcode', 'image')
    .param('text', { type: 'string', description: '要编码到二维码中的文本或 URL' }, true)
    .execute(async (args) => {
      const qrUrl = `${QR_API_BASE}/create-qr-code/?size=300x300&data=${encodeURIComponent(args.text)}`
      return JSON.stringify([{ type: 'image', data: { url: qrUrl } }])
    })
    .toTool(),
)
