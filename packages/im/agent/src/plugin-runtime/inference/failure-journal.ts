/**
 * Port to the instance runtime failure journal (`.zhin/runtime-failures.json`, #1270).
 *
 * The Host account runtime writes the latest failure of each account through it, so the reason
 * of a failed preparation (or model call) survives an instance restart, and clears it on success.
 * The journal itself belongs to the instance (it also records Endpoint and MCP failures); this
 * module only declares the shape the account runtime needs. Entries never carry credentials,
 * upstream bodies, URLs or headers.
 */

/** Journal sources the account runtime writes. */
export type InferenceFailureSource = 'account' | 'model';

export interface InferenceFailureReport {
  readonly source: InferenceFailureSource;
  /** Inference account id. */
  readonly subject: string;
  /** Stable code: the driver preparation code (`project-unavailable`, category `preparation`), or the model call outcome (`auth`, `rate-limit`, `server`, …). */
  readonly code: string;
  readonly category: string;
  /** Operator-facing summary; sanitized codes and HTTP status only. */
  readonly message: string;
  readonly step?: string;
  readonly reason?: string;
  readonly upstreamStatus?: number;
  /** Credential revision the failure was observed on. */
  readonly credentialRevision?: number;
  /** Epoch milliseconds of the observation (defaults to the journal's clock). */
  readonly at?: number;
}

export interface InferenceFailureEntry extends Omit<InferenceFailureReport, 'at' | 'source'> {
  readonly source: string;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly count: number;
  /** Loaded from the journal file: observed before this instance started (「重启前记录」). */
  readonly restored?: boolean;
}

export interface InferenceFailureJournal {
  record(report: InferenceFailureReport): void;
  clear(source: InferenceFailureSource, subject: string): void;
  get(source: InferenceFailureSource, subject: string): InferenceFailureEntry | undefined;
}
