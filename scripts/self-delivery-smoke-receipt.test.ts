import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyInstalledSmokeReceipt } from './self-delivery-smoke-receipt.mjs';
it('rejects exit zero before a package produced its required smoke receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'smoke-early-exit-'));
  try {
    execFileSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: directory });
    expect(() => verifyInstalledSmokeReceipt(join(directory, 'smoke-result.json'), 'head', 'digest')).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('requires the exact candidate identity and every successful runtime probe', () => {
  const directory = mkdtempSync(join(tmpdir(), 'smoke-receipt-'));
  const path = join(directory, 'smoke-result.json');
  const receipt = { version: 1, candidateSha: 'head', artifactDigest: 'digest', minimalBot: 'passed', terminalRoundTrip: 'passed', agentEntryImport: 'passed', stopped: true };
  try {
    writeFileSync(path, JSON.stringify(receipt));
    expect(verifyInstalledSmokeReceipt(path, 'head', 'digest')).toEqual(receipt);
    expect(() => verifyInstalledSmokeReceipt(path, 'new-head', 'digest')).toThrow();
    for (const field of Object.keys(receipt)) {
      writeFileSync(path, JSON.stringify({ ...receipt, [field]: null }));
      expect(() => verifyInstalledSmokeReceipt(path, 'head', 'digest')).toThrow();
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
