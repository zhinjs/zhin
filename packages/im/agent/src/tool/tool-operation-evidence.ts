/** Actual tool admission after all authority checks; inputs and outputs never enter this port. */
export interface ToolOperationStart {
  readonly turnId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  /** Formal ToolCapability declaration, never inferred from a name, prompt or risk label. */
  readonly readOnly: boolean;
}

/** Runtime-only evidence for the enclosing execution; it grants no tool authority. */
export interface ToolOperationEvidencePort {
  started(operation: ToolOperationStart): NonNullable<ToolInvocationContext['effects']>;
}
import type { ToolInvocationContext } from '@zhin.js/tool';

