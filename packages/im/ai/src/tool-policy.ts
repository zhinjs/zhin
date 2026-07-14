/**
 * Per-tool approval / model-output policy types (ADR 0039 P1).
 */

export type ToolApprovalMode = 'always' | 'once' | 'never';

export type ToolApprovalPolicy =
  | ToolApprovalMode
  | ((input: {
    toolName: string;
    args: Record<string, unknown>;
  }) => boolean | Promise<boolean>);

export type ToolToModelOutputInput<TArgs = Record<string, unknown>> = {
  result: unknown;
  args: TArgs;
};

export type ToolToModelOutputFn<TArgs = Record<string, unknown>> = (
  input: ToolToModelOutputInput<TArgs>,
) => string | Promise<string>;

export function toolApprovalAlways(): ToolApprovalMode {
  return 'always';
}

export function toolApprovalOnce(): ToolApprovalMode {
  return 'once';
}

export function toolApprovalNever(): ToolApprovalMode {
  return 'never';
}

/** @deprecated Use toolApprovalAlways — Eve-style alias */
export const always = toolApprovalAlways;
/** @deprecated Use toolApprovalOnce */
export const once = toolApprovalOnce;
/** @deprecated Use toolApprovalNever */
export const never = toolApprovalNever;
