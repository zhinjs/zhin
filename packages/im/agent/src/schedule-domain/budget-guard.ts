export type ScheduleBudgetTermination = 'token_limit' | 'tool_limit' | 'timeout';

export interface ScheduleExecutionBudget {
  maxTokens: number;
  maxToolCalls: number;
  timeoutMs: number;
}

export interface BudgetRunContext {
  signal: AbortSignal;
  onUsage(input: number, output: number): void;
  onToolCall(name: string): void;
}

export interface BudgetRunResult<T> {
  value?: T;
  error?: Error;
  terminatedBy?: ScheduleBudgetTermination;
  tokenUsage: { input: number; output: number };
  toolCalls: string[];
}

export class BudgetGuard {
  constructor(readonly budget: ScheduleExecutionBudget) {}

  async run<T>(operation: (context: BudgetRunContext) => Promise<T>): Promise<BudgetRunResult<T>> {
    const controller = new AbortController();
    let terminatedBy: ScheduleBudgetTermination | undefined;
    let tokenUsage = { input: 0, output: 0 };
    const toolCalls: string[] = [];
    const terminate = (reason: ScheduleBudgetTermination) => {
      if (terminatedBy) return;
      terminatedBy = reason;
      controller.abort(reason);
    };
    const timeout = setTimeout(() => terminate('timeout'), this.budget.timeoutMs);
    timeout.unref?.();

    try {
      const value = await operation({
        signal: controller.signal,
        onUsage: (input, output) => {
          tokenUsage = { input, output };
          if (input + output > this.budget.maxTokens) terminate('token_limit');
        },
        onToolCall: (name) => {
          toolCalls.push(name);
          if (toolCalls.length > this.budget.maxToolCalls) terminate('tool_limit');
        },
      });
      return { value, terminatedBy, tokenUsage, toolCalls };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
        terminatedBy,
        tokenUsage,
        toolCalls,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
