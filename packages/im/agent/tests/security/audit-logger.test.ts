/**
 * audit-logger — 异步关闭与背压硬化单测
 *
 * 覆盖：
 *  - close() 等待 flush，关闭后文件包含全部事件
 *  - 背压（write 返回 false）下事件进队列、'drain' 后泄放不丢
 *  - 队列超上限丢弃并计数（drop 计数落 warn 审计事件）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLogger, initAuditLogger, closeAuditLogger } from '../../src/security/audit-logger.js';

describe('AuditLogger 异步硬化', () => {
  let tmpDir: string;
  let logFile: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-audit-'));
    logFile = path.join(tmpDir, 'audit.log');
  });
  afterEach(async () => {
    await closeAuditLogger();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readLogLines(): Array<Record<string, unknown>> {
    const raw = fs.readFileSync(logFile, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('close() 后文件包含全部已记录事件', async () => {
    const logger = new AuditLogger({ enabled: true, logFile });
    for (let i = 0; i < 20; i++) {
      logger.log({ type: 'tool.execute', severity: 'info', message: `event-${i}` });
    }
    await logger.close();

    const lines = readLogLines();
    expect(lines).toHaveLength(20);
    expect(lines[0]!.message).toBe('event-0');
    expect(lines[19]!.message).toBe('event-19');
  });

  it('close() 无日志流时直接 resolve，且可重复调用', async () => {
    const logger = new AuditLogger({ enabled: true });
    await expect(logger.close()).resolves.toBeUndefined();
    await expect(logger.close()).resolves.toBeUndefined();
  });

  it('背压（write 返回 false）下事件进队列，drain 后泄放不丢', async () => {
    const logger = new AuditLogger({ enabled: true, logFile });
    const stream = (logger as unknown as { logStream: fs.WriteStream }).logStream;
    expect(stream).toBeTruthy();

    // 首次 write 谎报背压（仍写穿），之后恢复正常
    const realWrite = stream.write.bind(stream);
    let falseReturnsLeft = 1;
    (stream as unknown as { write: unknown }).write = ((chunk: unknown, ...rest: unknown[]) => {
      const args = rest as [];
      if (falseReturnsLeft-- > 0) {
        realWrite(chunk as string, ...args);
        return false;
      }
      return realWrite(chunk as string, ...args);
    }) as typeof stream.write;

    for (let i = 0; i < 10; i++) {
      logger.log({ type: 'tool.execute', severity: 'info', message: `bp-${i}` });
    }
    // 首个事件写入后触发背压，其余应已进入队列
    const queued = (logger as unknown as { pendingLines: string[] }).pendingLines.length;
    expect(queued).toBeGreaterThan(0);

    // drain 泄放队列
    stream.emit('drain');
    expect((logger as unknown as { pendingLines: string[] }).pendingLines.length).toBe(0);

    await logger.close();
    const lines = readLogLines();
    expect(lines).toHaveLength(10);
    expect(lines.map((l) => l.message)).toEqual(Array.from({ length: 10 }, (_, i) => `bp-${i}`));
  });

  it('背压期间 close() 也会先泄放队列再 flush', async () => {
    const logger = new AuditLogger({ enabled: true, logFile });
    const stream = (logger as unknown as { logStream: fs.WriteStream }).logStream;
    const realWrite = stream.write.bind(stream);
    (stream as unknown as { write: unknown }).write = ((chunk: unknown, ...rest: unknown[]) => {
      realWrite(chunk as string, ...(rest as []));
      return false; // 全程谎报背压
    }) as typeof stream.write;

    for (let i = 0; i < 30; i++) {
      logger.log({ type: 'tool.execute', severity: 'info', message: `close-flush-${i}` });
    }
    await logger.close();

    const lines = readLogLines();
    expect(lines).toHaveLength(30);
    expect(lines[29]!.message).toBe('close-flush-29');
  });

  it('队列超上限丢弃并计数，且落一条 warn 审计事件', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new AuditLogger({ enabled: true, logFile });
    const stream = (logger as unknown as { logStream: fs.WriteStream }).logStream;
    const realWrite = stream.write.bind(stream);
    (stream as unknown as { write: unknown }).write = ((chunk: unknown, ...rest: unknown[]) => {
      realWrite(chunk as string, ...(rest as []));
      return false; // 全程背压，队列只进不出
    }) as typeof stream.write;

    const MAX = 10000; // AuditLogger.MAX_PENDING_LINES
    // 第 1 条直入，随后 MAX 条填满队列，再多 5 条应被丢弃
    const total = 1 + MAX + 5;
    for (let i = 0; i < total; i++) {
      logger.log({ type: 'tool.execute', severity: 'info', message: `flood-${i}` });
    }

    const stats = logger.getStats();
    expect(stats.droppedEvents).toBeGreaterThanOrEqual(5);

    // drop 计数本身落一条 warn 审计事件（会话事件可见）
    const warnEvents = logger
      .getSessionEvents()
      .filter((e) => e.type === 'security.violation' && e.message.includes('已丢弃'));
    expect(warnEvents.length).toBeGreaterThan(0);

    await logger.close();
    // 队列中的 MAX 条 + 首条直入全部落盘，被丢弃的不在文件中
    const lines = readLogLines();
    expect(lines).toHaveLength(1 + MAX);
    expect(lines[0]!.message).toBe('flood-0');
  });

  it('closeAuditLogger() 等待全局实例 flush', async () => {
    const logger = initAuditLogger({ enabled: true, logFile });
    logger.log({ type: 'session.end', severity: 'info', message: 'global-flush' });
    await closeAuditLogger();

    const lines = readLogLines();
    expect(lines.some((l) => l.message === 'global-flush')).toBe(true);
  });
});
