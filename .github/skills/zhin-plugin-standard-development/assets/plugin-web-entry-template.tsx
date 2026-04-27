// @ts-nocheck
import type { PluginRegisterHostApi } from '@zhin.js/console-types'

function PluginDashboard() {
  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Plugin Dashboard</h1>
        <p className="text-sm opacity-70">Replace this page with your plugin UI.</p>
      </header>
    </main>
  )
}

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/plugins/plugin-dashboard',
    name: 'Plugin Dashboard',
    element: api.React.createElement(PluginDashboard),
  })
}
