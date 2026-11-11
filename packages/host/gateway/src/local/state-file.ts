/** `.zhin/gateway.json`: written by a running gateway, removed when it stops. */
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gatewayInfoFile } from './paths.js';
import type { LocalGatewayInfo } from './protocol.js';

/** Atomically writes the info file with mode 0600. */
export async function writeGatewayInfo(root: string, info: LocalGatewayInfo): Promise<string> {
  const file = gatewayInfoFile(root);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, file);
  return file;
}

/** The info file, or undefined when missing or unreadable. */
export async function readGatewayInfo(root: string): Promise<LocalGatewayInfo | undefined> {
  try { return parseInfo(await readFile(gatewayInfoFile(root), 'utf8')); } catch { return undefined; }
}

export function readGatewayInfoSync(root: string): LocalGatewayInfo | undefined {
  try { return parseInfo(readFileSync(gatewayInfoFile(root), 'utf8')); } catch { return undefined; }
}

/** Removes the info file when it still belongs to `pid`. */
export async function removeGatewayInfo(root: string, pid = process.pid): Promise<void> {
  const current = await readGatewayInfo(root);
  if (current && current.pid !== pid) return;
  await rm(gatewayInfoFile(root), { force: true });
}

function parseInfo(text: string): LocalGatewayInfo | undefined {
  const value = JSON.parse(text) as Partial<LocalGatewayInfo>;
  if (!value || typeof value !== 'object' || typeof value.pid !== 'number' || typeof value.socket !== 'string') return undefined;
  return value as LocalGatewayInfo;
}
