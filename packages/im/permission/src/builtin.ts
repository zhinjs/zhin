/**
 * 内置 permit DSL：adapter / group / private / channel / user / role。
 * 数组 AND；单项括号内逗号 OR。
 * SSOT：command / core 中的 permit-parse + permit-check 已由本模块替代。
 */

import type { PermissionSubject } from './subject.js';

export type PermitKind = 'adapter' | 'group' | 'private' | 'channel' | 'user' | 'role';

export interface ParsedPermit {
  readonly kind: PermitKind;
  readonly values: readonly string[];
}

export interface ParsedPlatformPermit {
  readonly adapter: string;
  readonly perm: string;
}

const BUILTIN_RE = /^(adapter|group|private|channel|user|role)\(([^)]*)\)$/;
const PLATFORM_RE = /^platform\(([^,)]+),([^)]*)\)$/;

export function parsePermitName(name: string): ParsedPermit | null {
  const m = name.match(BUILTIN_RE);
  if (!m) return null;
  const kind = m[1] as PermitKind;
  const inner = m[2]!.trim();
  if (!inner) return { kind, values: [''] };
  const values = inner.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return { kind, values: values.length > 0 ? values : [''] };
}

export function isBuiltinPermit(name: string): boolean {
  return BUILTIN_RE.test(name);
}

export function parsePlatformPermitName(name: string): ParsedPlatformPermit | null {
  const m = name.match(PLATFORM_RE);
  if (!m) return null;
  const adapter = m[1]!.trim();
  const perm = m[2]!.trim();
  if (!adapter || !perm) return null;
  return { adapter, perm };
}

export function isPlatformPermit(name: string): boolean {
  return PLATFORM_RE.test(name);
}

/** 构建期语法校验：仅允许 builtin DSL 或 `platform(adapter,perm)` 形态。 */
export function assertPermitSyntax(permits: readonly string[], source?: string): void {
  for (const [index, name] of permits.entries()) {
    if (typeof name !== 'string' || (!isBuiltinPermit(name) && !isPlatformPermit(name))) {
      const where = source ? ` for ${source}` : '';
      throw new TypeError(
        `Unknown permit[${index}]${where}: ${JSON.stringify(name)} `
        + '(expected adapter|group|private|channel|user|role(...) or platform(adapter,perm))',
      );
    }
  }
}

export function checkBuiltinPermit(name: string, subject: PermissionSubject): boolean {
  const parsed = parsePermitName(name);
  if (!parsed) return false;

  switch (parsed.kind) {
    case 'adapter':
      return parsed.values.some((v) => adapterMatches(subject.adapter, v));
    case 'group':
      return sceneMatches(subject, 'group', parsed.values);
    case 'private':
      return sceneMatches(subject, 'private', parsed.values);
    case 'channel':
      return sceneMatches(subject, 'channel', parsed.values);
    case 'user':
      return !!subject.sender
        && parsed.values.some((id) => subject.sender!.id === id);
    case 'role':
      return !!subject.sender
        && parsed.values.some((req) => roleSatisfies(subject.sender!.role, req));
    default:
      return false;
  }
}

export function checkBuiltinPermitList(
  permits: readonly string[],
  subject: PermissionSubject,
): boolean {
  return permits.every((name) => checkBuiltinPermit(name, subject));
}

function adapterMatches(sessionAdapter: string | undefined, value: string): boolean {
  if (!sessionAdapter) return false;
  if (sessionAdapter === value) return true;
  const last = sessionAdapter.includes('/')
    ? sessionAdapter.slice(sessionAdapter.lastIndexOf('/') + 1)
    : sessionAdapter;
  return last === value || last.startsWith(`${value}-`);
}

function sceneMatches(
  subject: PermissionSubject,
  type: string,
  values: readonly string[],
): boolean {
  const scene = subject.scene;
  if (!scene || scene.type !== type) return false;
  return values.some((id) => id === '' || id === '*' || scene.id === id);
}

/** master 隐含 trusted（与 core roles 对齐的轻量副本）。 */
function roleSatisfies(callerRoles: readonly string[], required: string): boolean {
  const expanded = new Set(callerRoles);
  if (expanded.has('master')) expanded.add('trusted');
  return expanded.has(required);
}
