import { AUDIT_DETAIL_MAX_LENGTH, auditDetailJson } from '../../src/iam/service.js';

describe('stored audit detail', () => {
  it('keeps short details as they are', () => {
    expect(auditDetailJson({ type: 'db:execute', keys: ['sql'] })).toBe('{"type":"db:execute","keys":["sql"]}');
  });

  it('never cuts a detail mid-string: an oversized one is replaced by a parseable preview', () => {
    for (const detail of [
      { statements: [`DELETE FROM notes WHERE 1=0${'\n'.repeat(2500)}`] },
      { statements: ['"'.repeat(5000)] },
      { statements: ['x'.repeat(10_000)] },
    ]) {
      const stored = auditDetailJson(detail);
      expect(stored.length).toBeLessThanOrEqual(AUDIT_DETAIL_MAX_LENGTH);
      const parsed = JSON.parse(stored) as { truncated: boolean; length: number; preview: string };
      expect(parsed).toMatchObject({ truncated: true, length: JSON.stringify(detail).length });
      expect(JSON.stringify(detail).startsWith(parsed.preview)).toBe(true);
    }
  });
});
