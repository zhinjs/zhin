/** Safe protocol rejection without request payloads or provider response contents. */
export class ProviderProtocolError extends Error {
  readonly code: 'missing-call-context' | 'unsupported-parameter' | 'invalid-credential' | 'invalid-response';
  constructor(code: ProviderProtocolError['code']) {
    super(`Provider protocol: ${code}`);
    this.name = 'ProviderProtocolError';
    this.code = code;
  }
}
