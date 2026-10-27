/**
 * 本地状态文件（草稿、扫码登录凭据）。
 *
 * - 位置：`<dataDir>/<endpointId>/`，默认 `data/bilibili/<id>/`，与 icqq / weixin-ilink 的 data 目录约定一致。
 * - 写入：先写临时文件再 rename，避免进程中途退出留下半个 JSON。
 * - 凭据文件权限 0600；内容永远不进日志、不进 YAML。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** endpoint id → 安全的目录名（只留字母数字和 `_.-`，其余替换成 `_`）。 */
export function endpointDirectoryName(endpointId: string): string {
  const name = endpointId.replace(/[^A-Za-z0-9_.-]/gu, '_');
  if (!name || /^\.+$/u.test(name)) throw new TypeError(`Bilibili endpoint id "${endpointId}" cannot be used as a data directory name`);
  return name;
}

export function writeJsonAtomic(file: string, value: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', ...(mode === undefined ? {} : { mode }) });
  fs.renameSync(temp, file);
  if (mode !== undefined) {
    try { fs.chmodSync(file, mode); } catch { /* 非 POSIX 文件系统：忽略 */ }
  }
}

/** 读不到、不是 JSON 都返回 undefined；调用方自行校验结构。 */
export function readJson(file: string): unknown {
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
  } catch {
    return undefined;
  }
}

export function removeFile(file: string): void {
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}

export class BilibiliStateFiles {
  readonly directory: string;

  constructor(rootDir: string, endpointId: string) {
    this.directory = path.resolve(rootDir, endpointDirectoryName(endpointId));
  }

  get draftsFile(): string {
    return path.join(this.directory, 'drafts.json');
  }

  get credentialsFile(): string {
    return path.join(this.directory, 'credentials.json');
  }
}
