import { definePage } from '@zhin.js/console-contract';
import SandboxChat from './SandboxChat';

export const meta = definePage({
  title: '沙盒',
  icon: 'Box',
  order: 10,
});

/**
 * Convention page entry (ADR 0046).
 * Restores the pre-runtime-migration Sandbox console UI (channels + rich text + faces).
 * WebSocket targets Host `/sandbox` via zhin_api_base + token (see sandboxTransport.ts).
 */
export default function SandboxPage() {
  return <SandboxChat />;
}
