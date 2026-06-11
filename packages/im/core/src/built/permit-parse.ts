/**
 * Permit 语法解析：type(a,b,c) 括号内逗号为 OR；链式 .permit().permit() 为 AND（由调用方保证）。
 */

export type PermitKind = 'adapter' | 'group' | 'private' | 'channel' | 'user' | 'role';

export interface ParsedPermit {
  kind: PermitKind;
  values: string[];
}

const PERMIT_RE = /^(adapter|group|private|channel|user|role)\(([^)]*)\)$/;

export function parsePermitName(name: string): ParsedPermit | null {
  const m = name.match(PERMIT_RE);
  if (!m) return null;
  const kind = m[1] as PermitKind;
  const inner = m[2].trim();
  if (!inner) return { kind, values: [''] };
  const values = inner.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return { kind, values: values.length > 0 ? values : [''] };
}

export function isBuiltinPermit(name: string): boolean {
  return PERMIT_RE.test(name);
}

export interface ParsedPlatformPermit {
  adapter: string;
  perm: string;
}

const PLATFORM_PERMIT_RE = /^platform\(([^,)]+),([^)]*)\)$/;

export function parsePlatformPermitName(name: string): ParsedPlatformPermit | null {
  const m = name.match(PLATFORM_PERMIT_RE);
  if (!m) return null;
  const adapter = m[1].trim();
  const perm = m[2].trim();
  if (!adapter || !perm) return null;
  return { adapter, perm };
}

export function isPlatformPermit(name: string): boolean {
  return PLATFORM_PERMIT_RE.test(name);
}
