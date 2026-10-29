/**
 * ADR 0038 §4 — which turn events make a stale reply go out anyway.
 *
 * A reply that went stale is dropped only when the turn did nothing the
 * user must hear about. Tool descriptors do not say whether a tool has side
 * effects, so every tool call (and every sub-agent) counts (a stale reply is sent rather than an
 * action going unreported), and so does any hard-gate denial.
 */

import type { TurnEvent } from '../event/turn-event.js';
import { TOOL_HARD_GATE_POLICY } from '../security/tool-hard-gate.js';

export function isActingTurnEvent(event: TurnEvent): boolean {
  switch (event.type) {
    case 'tool_call':
    case 'mcp_tool_call':
    case 'subagent_start':
      return true;
    case 'tool_denied':
      return event.policy === TOOL_HARD_GATE_POLICY;
    default:
      return false;
  }
}
