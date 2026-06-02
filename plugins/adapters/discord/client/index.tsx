import type { PluginRegisterHostApi } from '@zhin.js/contract'
import DiscordDashboard from './Dashboard'

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/discord',
    name: 'Discord',
    element: api.React.createElement(DiscordDashboard, { hostReact: api.React }),
  })
  api.addTool({ id: 'discord', name: 'Discord', path: '/console/discord' })
}
