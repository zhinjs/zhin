import { describe, expect, it } from 'vitest';
import { ConsoleTransportError, readConsoleErrorDetails } from './types.js';

describe('readConsoleErrorDetails', () => {
  it('keeps the structured validation fields of a Host error reply', () => {
    const details = readConsoleErrorDetails({
      success: false,
      code: 'invalid_input',
      error: '配置未通过插件 Schema 校验',
      errors: [{ path: '$.endpoints.0.id', message: "must have required property 'id'" }, { path: 1 }, null],
      missingEnv: ['BOT_TOKEN', 2],
    });
    expect(details).toEqual({
      serverCode: 'invalid_input',
      errors: [{ path: '$.endpoints.0.id', message: "must have required property 'id'" }],
      missingEnv: ['BOT_TOKEN'],
    });
  });

  it('returns no details for replies without them', () => {
    expect(readConsoleErrorDetails({ success: false, error: 'nope' })).toEqual({});
    expect(readConsoleErrorDetails(null)).toEqual({});
  });

  it('exposes the details on the transport error', () => {
    const error = new ConsoleTransportError('x', 'SERVER_ERROR', undefined, readConsoleErrorDetails({ missingEnv: ['A'] }));
    expect(error.details.missingEnv).toEqual(['A']);
    expect(new ConsoleTransportError('y', 'SERVER_ERROR').details).toEqual({});
  });
});
