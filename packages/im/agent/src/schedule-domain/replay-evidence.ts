import type { ToolOperationEvidencePort, ToolOperationStart } from '../tool/tool-operation-evidence.js';

export interface ReplayOperation {
  readonly id: string;
  readonly toolName: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly readOnly: boolean;
  readonly status: 'safe' | 'committed' | 'unknown';
}

export interface ReplayEvidence {
  readonly disposition: 'safe' | 'committed' | 'unknown';
  readonly reason?: 'read_only' | 'not_submitted';
  readonly operations: readonly ReplayOperation[];
}

/** Attempt-owned evidence. A generic tool result or exception cannot prove all its effects. */
export class AttemptReplayEvidence implements ToolOperationEvidencePort {
  readonly #operations: ReplayOperation[] = [];

  started(operation: ToolOperationStart): ReturnType<ToolOperationEvidencePort['started']> {
    const index = this.#operations.length;
    const record: ReplayOperation = Object.freeze({
      id: `${operation.turnId}:${operation.toolUseId}`, toolName: operation.toolName,
      turnId: operation.turnId, toolUseId: operation.toolUseId,
      readOnly: operation.readOnly,
      status: operation.readOnly ? 'safe' : 'unknown',
    });
    this.#operations.push(record);
    const report: ReturnType<ToolOperationEvidencePort['started']>['report'] = ({ disposition }) => {
      const previous = this.#operations[index]!;
      // A later rejected action cannot erase an earlier confirmed effect in this invocation.
      const status = previous.status === 'committed' && disposition === 'not_submitted' ? 'committed'
        : disposition === 'not_submitted' ? 'safe' : disposition;
      this.#operations[index] = Object.freeze({ ...record, status });
    };
    return Object.freeze({ report });
  }

  snapshot(): ReplayEvidence {
    const operations = Object.freeze([...this.#operations]);
    if (operations.some(operation => operation.status === 'unknown')) {
      return Object.freeze({ disposition: 'unknown', operations });
    }
    if (operations.some(operation => operation.status === 'committed')) {
      return Object.freeze({ disposition: 'committed', operations });
    }
    return Object.freeze({ disposition: 'safe', reason: operations.length && operations.every(operation => operation.readOnly)
      ? 'read_only' : 'not_submitted', operations });
  }
}
