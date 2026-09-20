// @ts-nocheck — 说明性骨架：复制为 pages/dashboard/index.tsx。
import { definePage } from 'zhin.js/page';

export const meta = definePage({
  title: 'Plugin Dashboard',
  order: 20,
});

export default function PluginDashboard() {
  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Plugin Dashboard</h1>
        <p className="text-sm opacity-70">Replace this page with your plugin UI.</p>
      </header>
    </main>
  );
}
