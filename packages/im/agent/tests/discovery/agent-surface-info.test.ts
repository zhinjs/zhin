import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  buildAgentSurfaceInfoReport,
  formatAgentSurfaceInfoReport,
} from '../../src/discovery/agent-surface-info.js';

describe('agent-surface-info', () => {
  it('discovers plugin utils/lottery agent surface from monorepo', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const report = await buildAgentSurfaceInfoReport(repoRoot);
    const lottery = report.plugins.find((p) => p.pluginName.includes('lottery'));
    expect(lottery).toBeDefined();
    expect(lottery!.tools.length).toBeGreaterThan(0);
    const text = formatAgentSurfaceInfoReport(report);
    expect(text).toContain('Totals:');
  });
});
