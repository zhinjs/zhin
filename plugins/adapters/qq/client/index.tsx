import type { PluginRegisterHostApi } from '@zhin.js/console-types'
import QQDashboard from './Dashboard'

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/qq',
    name: 'QQ官方',
    element: api.React.createElement(QQDashboard, { hostReact: api.React }),
  })
  api.addTool({ id: 'qq', name: 'QQ官方', path: '/console/qq' })
}
