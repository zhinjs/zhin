/**
 * Git 状态单行摘要（注入 §1 Runtime 信息行）。
 *
 * 设计约束：越短越好——只给分支 + 按状态聚合计数，不列文件清单；
 * agent 需要细节可用 exec 工具自行跑 git。进程内 TTL 缓存避免每条消息 fork git。
 */
import { execFile } from 'node:child_process';

const GIT_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 60_000;
const MAX_LINE_CHARS = 256;

interface CacheEntry {
  line: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 测试用：清空缓存 */
export function clearGitStatusCache(): void {
  cache.clear();
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * 返回单行 git 摘要，如 `Git: main | 3M 1A 2? | ahead 1`；非 git 仓库或失败返回 null。
 */
export async function getGitStatusLine(cwd: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > now) return cached.line;

  let line: string | null = null;
  try {
    const inside = (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside === 'true') {
      // --branch 首行形如 `## main...origin/main [ahead 1]`；无提交时为 `## No commits yet on main`
      const raw = await runGit(cwd, ['status', '--short', '--branch']);
      const lines = raw.split('\n').filter(Boolean);
      const header = lines[0]?.startsWith('##') ? lines.shift()! : '';
      const branch = header.replace(/^##\s*/, '').replace(/\.\.\..*$/, '').replace(/^No commits yet on /, '') || 'unknown';
      const aheadBehind = header.match(/\[(ahead \d+|behind \d+|ahead \d+, behind \d+)\]/)?.[1];

      const counts = new Map<string, number>();
      for (const entry of lines) {
        const xy = entry.slice(0, 2);
        if (xy === '??') {
          counts.set('?', (counts.get('?') ?? 0) + 1);
          continue;
        }
        for (const ch of xy) {
          if (ch === ' ' || ch === '?') continue;
          counts.set(ch, (counts.get(ch) ?? 0) + 1);
        }
      }
      const parts: string[] = [];
      // 常见状态优先：M 修改、A 新增、D 删除、R 改名、? 未跟踪
      for (const key of ['M', 'A', 'D', 'R', 'C', 'U', '?']) {
        const n = counts.get(key);
        if (n) parts.push(`${n}${key}`);
      }
      line = `Git: ${branch}${parts.length ? ` | ${parts.join(' ')}` : ' | clean'}${aheadBehind ? ` | ${aheadBehind}` : ''}`;
      if (line.length > MAX_LINE_CHARS) line = line.slice(0, MAX_LINE_CHARS - 1) + '…';
    }
  } catch {
    line = null;
  }

  cache.set(cwd, { line, expiresAt: now + CACHE_TTL_MS });
  return line;
}
