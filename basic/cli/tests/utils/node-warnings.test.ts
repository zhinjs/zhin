import { describe, expect, it, vi } from 'vitest';
import {
  DISABLE_EXPERIMENTAL_WARNING_FLAG,
  suppressNodeExperimentalWarnings,
} from '../../src/utils/node-warnings.js';

describe('suppressNodeExperimentalWarnings', () => {
  it('exports the Node CLI flag for child processes', () => {
    expect(DISABLE_EXPERIMENTAL_WARNING_FLAG).toBe('--disable-warning=ExperimentalWarning');
  });

  it('swallows ExperimentalWarning process events', () => {
    suppressNodeExperimentalWarnings();
    const handler = vi.fn();
    process.on('warning', handler);
    try {
      const experimental = Object.assign(new Error('SQLite is an experimental feature'), {
        name: 'ExperimentalWarning',
      });
      const other = Object.assign(new Error('keep me'), { name: 'OtherWarning' });
      process.emit('warning', experimental);
      process.emit('warning', other);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![0]).toBe(other);
    } finally {
      process.off('warning', handler);
    }
  });
});
