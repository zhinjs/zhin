import type { PluginRegisterHostApi } from '@zhin.js/console-types'
import KookDashboard from './Dashboard'

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/kook',
    name: 'KOOK',
    element: api.React.createElement(KookDashboard, { hostReact: api.React }),
  })
  api.addTool({ id: 'kook', name: 'KOOK', path: '/kook' })
}
