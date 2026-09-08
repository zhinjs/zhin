import fs from 'node:fs';
/** Behavioral smoke evidence, not an independent security attestation of hostile package code. */
export function verifyInstalledSmokeReceipt(path, candidateSha, artifactDigest) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (cause) { throw new Error('Installed smoke receipt missing or invalid', { cause }); }
  if (!receipt || receipt.version !== 1 || receipt.candidateSha !== candidateSha
    || receipt.artifactDigest !== artifactDigest || receipt.minimalBot !== 'passed'
    || receipt.terminalRoundTrip !== 'passed' || receipt.agentEntryImport !== 'passed'
    || receipt.stopped !== true) throw new Error('Installed smoke receipt missing or invalid');
  return receipt;
}
