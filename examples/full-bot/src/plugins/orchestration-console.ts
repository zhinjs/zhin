import path from 'node:path';
import { usePlugin } from 'zhin.js';

const { useContext } = usePlugin();

try {
  const clientEntry = path.resolve(process.cwd(), 'client/index.tsx');
  useContext('web', (pageManager) => {
    pageManager.addEntry({
      id: 'full-bot-orchestration',
      development: clientEntry,
      production: clientEntry,
      meta: { name: 'Orchestration Console' },
    });
  });
} catch {
  /* PageManager 不可用时跳过 Console 入口 */
}
