/**
 * Connection OAuth / authorization stream payloads — ADR 0039 P1.
 */

export type AuthorizationRequiredData = {
  sessionId: string;
  requestId: string;
  connection: string;
  /** Host-rendered OAuth URL when interactive auth is needed */
  authUrl?: string;
  scope?: string;
};

export type AuthorizationCompletedData = {
  sessionId: string;
  requestId: string;
  connection: string;
  success: boolean;
  error?: string;
};

export type InputRequestedData = {
  sessionId: string;
  requestId: string;
  kind: 'approval' | 'question' | (string & {});
  toolName?: string;
  args?: Record<string, unknown>;
  prompt?: string;
};

export type InputCompletedData = {
  sessionId: string;
  requestId: string;
  kind: 'approval' | 'question' | (string & {});
  toolName?: string;
  approved?: boolean;
  answer?: string;
};
