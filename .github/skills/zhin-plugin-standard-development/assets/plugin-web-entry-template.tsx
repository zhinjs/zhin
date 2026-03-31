// @ts-nocheck
import { addPage } from '@zhin.js/client'

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

addPage({
  key: 'plugin-dashboard',
  path: '/plugins/plugin-dashboard',
  title: 'Plugin Dashboard',
  element: <PluginDashboard />,
})