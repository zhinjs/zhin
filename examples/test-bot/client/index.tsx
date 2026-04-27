import type { PluginRegisterHostApi } from '@zhin.js/console-types'
import TestPage from './TestPage'

function TrashMenuIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
    </svg>
  )
}

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/test',
    name: '测试',
    element: api.React.createElement(TestPage, { hostReact: api.React }),
  })
  api.addTool({ id: 'test', name: '测试', path: '/console/test' })
}
