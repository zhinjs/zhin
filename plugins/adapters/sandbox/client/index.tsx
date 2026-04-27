import type { PluginRegisterHostApi } from '@zhin.js/console-types'
import Sandbox from './Sandbox'

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/sandbox',
    name: '沙盒',
    element: api.React.createElement(Sandbox, { hostReact: api.React }),
  })
  api.addTool({ id: 'sandbox', name: '沙盒', path: '/console/sandbox' })
}
