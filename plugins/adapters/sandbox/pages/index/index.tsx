import { definePage } from '@zhin.js/console-contract';
import SandboxChat, { type SandboxPageProps } from './SandboxChat';

export const meta = definePage({
  title: '会话',
  titleI18n: { en: 'Conversations' },
  icon: 'Box',
  order: 10,
});

/**
 * Convention page entry (ADR 0046).
 * `pages/index/index.tsx` → `/sandbox` (plugin path; no `/p-` leaf).
 * Agent workbench for testing scoped conversations, rich messages and execution traces.
 * WebSocket targets Host `/sandbox` via zhin_api_base + token (see sandboxTransport.ts).
 */
export default function SandboxPage(props: SandboxPageProps) {
  return <SandboxChat {...props} />;
}
