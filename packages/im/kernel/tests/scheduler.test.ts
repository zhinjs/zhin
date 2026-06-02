/**
 * Scheduler tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { Scheduler } from '../src/scheduler/scheduler.js'
import type { AddJobOptions, ScheduledJob } from '../src/scheduler/types.js'

function createTempStorePath(): string {
  const dir = path.join(os.tmpdir(), `scheduler-test-${randomUUID()}`)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'scheduler.json')
}

describe('Scheduler', () => {
  let storePath: string
  let scheduler: Scheduler

  beforeEach(() => {
    storePath = createTempStorePath()
    scheduler = new Scheduler({ storePath, workspace: '/test' })
  })

  afterEach(() => {
    scheduler.stop()
    try {
      const dir = path.dirname(storePath)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
    } catch {}
  })

  describe('addJob', () => {
    it('creates job with correct fields and returns ScheduledJob', () => {
      const options: AddJobOptions = {
        name: 'test-job',
        schedule: { kind: 'every', everyMs: 60000 },
        payload: { kind: 'system_event', message: 'hello', deliver: false },
      }
      const job = scheduler.addJob(options)
      expect(job).toBeDefined()
      expect(job.id).toBeDefined()
      expect(job.id.length).toBeGreaterThan(0)
      expect(job.name).toBe('test-job')
      expect(job.enabled).toBe(true)
      expect(job.schedule).toEqual(options.schedule)
      expect(job.payload).toEqual(options.payload)
      expect(job.state.nextRunAtMs).toBeDefined()
      expect(job.createdAtMs).toBeGreaterThan(0)
      expect(job.updatedAtMs).toBeGreaterThan(0)
      expect(job.deleteAfterRun).toBe(false)
    })

    it('respects enabled: false option', () => {
      const job = scheduler.addJob({
        name: 'disabled-job',
        schedule: { kind: 'every', everyMs: 1000 },
        payload: { kind: 'system_event', message: '', deliver: false },
        enabled: false,
      })
      expect(job.enabled).toBe(false)
    })

    it('respects deleteAfterRun option', () => {
      const job = scheduler.addJob({
        name: 'one-shot',
        schedule: { kind: 'at', atMs: Date.now() + 10000 },
        payload: { kind: 'system_event', message: '', deliver: false },
        deleteAfterRun: true,
      })
      expect(job.deleteAfterRun).toBe(true)
    })
  })

  describe('removeJob', () => {
    it('returns true when job found', () => {
      const job = scheduler.addJob({
        name: 'to-remove',
        schedule: { kind: 'every', everyMs: 1000 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      const result = scheduler.removeJob(job.id)
      expect(result).toBe(true)
      expect(scheduler.listJobs()).toHaveLength(0)
    })

    it('returns false when job not found', () => {
      const result = scheduler.removeJob('nonexistent-id')
      expect(result).toBe(false)
    })
  })

  describe('enableJob', () => {
    it('toggles enabled flag', () => {
      const job = scheduler.addJob({
        name: 'toggle-job',
        schedule: { kind: 'every', everyMs: 1000 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      expect(job.enabled).toBe(true)
      const disabled = scheduler.enableJob(job.id, false)
      expect(disabled).toBe(true)
      const jobs = scheduler.listJobs()
      expect(jobs.find(j => j.id === job.id)?.enabled).toBe(false)
      const enabled = scheduler.enableJob(job.id, true)
      expect(enabled).toBe(true)
      expect(scheduler.listJobs().find(j => j.id === job.id)?.enabled).toBe(true)
    })

    it('returns false for nonexistent job', () => {
      expect(scheduler.enableJob('nonexistent', true)).toBe(false)
    })
  })

  describe('listJobs', () => {
    it('returns sorted list by nextRunAtMs', () => {
      scheduler.addJob({
        name: 'later',
        schedule: { kind: 'every', everyMs: 60000 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      scheduler.addJob({
        name: 'sooner',
        schedule: { kind: 'every', everyMs: 1000 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      const jobs = scheduler.listJobs()
      expect(jobs).toHaveLength(2)
      const first = jobs[0]
      const second = jobs[1]
      expect((first.state.nextRunAtMs ?? 0)).toBeLessThanOrEqual(second.state.nextRunAtMs ?? Infinity)
    })
  })

  describe('start/stop lifecycle', () => {
    it('start loads store and arms timer', async () => {
      scheduler.addJob({
        name: 'lifecycle-job',
        schedule: { kind: 'every', everyMs: 1000 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      await scheduler.start()
      const status = scheduler.status()
      expect(status.running).toBe(true)
      expect(status.jobCount).toBe(1)
      expect(status.nextWakeAt).toBeDefined()
      scheduler.stop()
      expect(scheduler.status().running).toBe(false)
    })

    it('stop clears timer', async () => {
      await scheduler.start()
      scheduler.stop()
      expect(scheduler.status().running).toBe(false)
    })
  })

  describe('Persistence', () => {
    it('saveStore/loadStore persists jobs across scheduler instances', async () => {
      const jobOptions: AddJobOptions = {
        name: 'persisted-job',
        schedule: { kind: 'every', everyMs: 60000 },
        payload: { kind: 'system_event', message: 'persisted', deliver: false },
      }
      const s1 = new Scheduler({ storePath, workspace: '/test' })
      await s1.start()
      const job = s1.addJob(jobOptions)
      s1.stop()

      const s2 = new Scheduler({ storePath, workspace: '/test' })
      await s2.start()
      const jobs = s2.listJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe(job.id)
      expect(jobs[0].name).toBe('persisted-job')
      expect(jobs[0].payload.message).toBe('persisted')
      s2.stop()
    })
  })

  describe('Job execution', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls onJob callback for due jobs', async () => {
      const onJob = vi.fn().mockResolvedValue(undefined)
      const s = new Scheduler({
        storePath,
        workspace: '/test',
        onJob,
      })
      await s.start()
      s.addJob({
        name: 'exec-job',
        schedule: { kind: 'every', everyMs: 100 },
        payload: { kind: 'system_event', message: 'run', deliver: false },
      })
      await vi.advanceTimersByTimeAsync(150)
      expect(onJob).toHaveBeenCalledTimes(1)
      expect(onJob).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'exec-job', payload: expect.objectContaining({ message: 'run' }) })
      )
      s.stop()
    })

    it('does not call onJob for disabled jobs', async () => {
      const onJob = vi.fn().mockResolvedValue(undefined)
      const s = new Scheduler({ storePath, workspace: '/test', onJob })
      await s.start()
      const job = s.addJob({
        name: 'disabled-exec',
        schedule: { kind: 'every', everyMs: 100 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      s.enableJob(job.id, false)
      await vi.advanceTimersByTimeAsync(200)
      expect(onJob).not.toHaveBeenCalled()
      s.stop()
    })
  })

  describe('deleteAfterRun for at type jobs', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('removes job after execution when deleteAfterRun is true', async () => {
      const onJob = vi.fn().mockResolvedValue(undefined)
      const s = new Scheduler({ storePath, workspace: '/test', onJob })
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
      await s.start()
      const job = s.addJob({
        name: 'one-shot-at',
        schedule: { kind: 'at', atMs: Date.now() + 50 },
        payload: { kind: 'system_event', message: '', deliver: false },
        deleteAfterRun: true,
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(onJob).toHaveBeenCalledTimes(1)
      expect(s.listJobs()).toHaveLength(0)
      s.stop()
    })
  })

  describe('at type jobs become disabled after execution', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('disables at job when deleteAfterRun is false', async () => {
      const onJob = vi.fn().mockResolvedValue(undefined)
      const s = new Scheduler({ storePath, workspace: '/test', onJob })
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
      await s.start()
      const job = s.addJob({
        name: 'at-no-delete',
        schedule: { kind: 'at', atMs: Date.now() + 50 },
        payload: { kind: 'system_event', message: '', deliver: false },
        deleteAfterRun: false,
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(onJob).toHaveBeenCalledTimes(1)
      const jobs = s.listJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].enabled).toBe(false)
      s.stop()
    })
  })

  describe('status', () => {
    it('returns correct counts', async () => {
      await scheduler.start()
      expect(scheduler.status()).toEqual({
        running: true,
        jobCount: 0,
        nextWakeAt: undefined,
      })
      scheduler.addJob({
        name: 'status-job',
        schedule: { kind: 'every', everyMs: 60000 },
        payload: { kind: 'system_event', message: '', deliver: false },
      })
      const status = scheduler.status()
      expect(status.jobCount).toBe(1)
      expect(status.nextWakeAt).toBeDefined()
      scheduler.stop()
      expect(scheduler.status().running).toBe(false)
    })
  })

  describe('Legacy data migration', () => {
    it('maps old channel field to target', async () => {
      const dir = path.dirname(storePath)
      const legacyPath = path.join(dir, 'legacy.json')
      fs.writeFileSync(
        legacyPath,
        JSON.stringify({
          version: 1,
          jobs: [
            {
              id: 'legacy-1',
              name: 'legacy-job',
              enabled: true,
              schedule: { kind: 'cron', expr: '0 0 * * *' },
              payload: {
                kind: 'system_event',
                message: 'legacy',
                deliver: true,
                channel: 'old-channel-id',
              },
              state: {},
              createdAtMs: 0,
              updatedAtMs: 0,
            },
          ],
        })
      )

      const s = new Scheduler({ storePath: legacyPath, workspace: '/test' })
      await s.start()
      const jobs = s.listJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].payload.target).toBe('old-channel-id')
      s.stop()
    })
  })
})
