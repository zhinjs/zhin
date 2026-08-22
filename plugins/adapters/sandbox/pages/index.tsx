import { definePage } from '@zhin.js/console-contract';
import SandboxChat from './SandboxChat';

export const meta = definePage({
  title: 'Agent 试验台',
  icon: 'Box',
  order: 10,
});

/**
 * Convention page entry (ADR 0046).
 * `pages/index.tsx` → `/sandbox` (plugin path; no `/p-` leaf).
 * Agent workbench for testing scoped conversations, rich messages and execution traces.
 * WebSocket targets Host `/sandbox` via zhin_api_base + token (see sandboxTransport.ts).
 */
export default function SandboxPage() {
  return <SandboxChat />;
}
