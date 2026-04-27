import type { PluginRegisterHostApi } from '@zhin.js/console-types'
import TelegramDashboard from './Dashboard'

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/telegram',
    name: 'Telegram',
    element: api.React.createElement(TelegramDashboard, { hostReact: api.React }),
  })
  api.addTool({ id: 'telegram', name: 'Telegram', path: '/console/telegram' })
}
