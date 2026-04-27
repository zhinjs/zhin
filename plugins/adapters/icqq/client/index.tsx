import type { PluginRegisterHostApi } from '@zhin.js/console-types'
import ICQQManagement from './ICQQManagement'

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/icqq',
    name: 'ICQQ管理',
    element: api.React.createElement(ICQQManagement, { hostReact: api.React }),
  })
  api.addTool({ id: 'icqq', name: 'ICQQ', path: '/console/icqq' })
}
