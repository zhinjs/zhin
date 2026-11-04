import { createGenerationAdmissionGate, generationAdmissionSource, type PluginId } from 'zhin.js/plugin-runtime';
import type { GroupModerationInput, GroupModerator } from './group-moderation.js';
import { deferred, REQUEST_BATCHES, reviewGroupBatch, takeGroupBatch } from './group-review-batch.js';

const COLLECT_MS = 300;
const MAX_PENDING = 128;
const MAX_PENDING_BYTES = 256 * 1024;
type Entry = { input: GroupModerationInput; sender: string; bytes: number; order: number;
  done: ReturnType<typeof deferred<boolean>>; ownsRecall: boolean; detach(): void };
type Scene = { pending: Entry[]; bytes: number; active: Map<string, Entry> };
/** Exact source ownership captured while the inbound operation is still live. */
interface GroupReviewSourceInput {
  readonly owner: PluginId;
  /** Carries caller cancellation, account epoch retirement and explicit Root stop. */
  readonly signal: AbortSignal;
}
interface CapturedGroupReviewSource {
  readonly signal: AbortSignal;
  /** Ends only this registration; it never resumes or replays detached work. */
  release(): void;
}

/** One generation-owned worker; per-scene bounded buffers, no persisted/replayed punishment jobs. */
export class GroupReviewQueue {
  readonly #moderator: GroupModerator;
  readonly #gate = createGenerationAdmissionGate();
  readonly #abort = new AbortController();
  readonly #scenes = new Map<string, Scene>();
  readonly #sources = new Set<{ readonly owner: PluginId; readonly abort: AbortController }>();
  #timer?: ReturnType<typeof setTimeout>;
  #running = false;
  #order = 0;
  get [generationAdmissionSource]() { return [this.#gate]; }

  constructor(moderator: GroupModerator) {
    this.#moderator = moderator;
  }

  /** Bind detached review work to its actual Adapter owner, not a replaceable generation gate. */
  captureSource(input: GroupReviewSourceInput): CapturedGroupReviewSource {
    const source = { owner: input.owner, abort: new AbortController() };
    this.#sources.add(source);
    return { signal: AbortSignal.any([input.signal, source.abort.signal]), release: () => { this.#sources.delete(source); } };
  }

  /** Existing cancellation policy, applied only to the actual committed replacement set. */
  cancelReplacedSources(owners: readonly PluginId[]): void {
    for (const source of this.#sources) {
      if (owners.includes(source.owner)) source.abort.abort(new Error('Moderation source Adapter was replaced'));
    }
  }

  stop(): void {
    this.#abort.abort(new Error('Group review generation retired'));
    for (const source of this.#sources) source.abort.abort(this.#abort.signal.reason);
    clearTimeout(this.#timer); this.#timer = undefined;
    for (const scene of this.#scenes.values()) {
      for (const entry of scene.pending) this.#finish(entry);
      scene.pending = []; scene.bytes = 0;
    }
    this.#scenes.clear();
  }

  /** Resolves on admission, not classification. Full buffers explicitly audit skipped reviews. */
  async enqueue(input: GroupModerationInput): Promise<{ done: Promise<boolean> }> {
    this.#assertActive();
    const signal = AbortSignal.any([this.#abort.signal, input.signal]);
    signal.throwIfAborted();
    const bytes = Buffer.byteLength(input.text);
    // Same eligibility budget as the existing single-message reviewer.
    if (!input.text.trim() || input.text.length > 12_000) return { done: Promise.resolve(false) };
    let scene = this.#scenes.get(input.scope);
    if (!scene) { scene = { pending: [], bytes: 0, active: new Map() }; this.#scenes.set(input.scope, scene); }
    const key = JSON.stringify([input.sender, input.messageId]);
    // A duplicate cannot take the full-buffer path and override an original's pending recall decision.
    if (input.messageId && scene.active.has(key)) return { done: Promise.resolve(true) };
    const order = ++this.#order;
    if (scene.pending.length >= MAX_PENDING || scene.bytes + bytes > MAX_PENDING_BYTES) {
      input.audit({ event: 'group_review_skipped', messageId: input.messageId, reason: 'queue_full',
        pending: scene.pending.length, pendingBytes: scene.bytes });
      return { done: this.#moderator.ownsRecall(input).catch(error => {
        input.audit({ event: 'group_recall_ownership_unavailable', messageId: input.messageId,
          error: error instanceof Error ? error.message : String(error) });
        return true; // Unknown ownership is not permission to delete an original message.
      }) };
    }
    const entry: Entry = { input: { ...input, signal }, sender: input.sender, bytes, order,
      done: deferred<boolean>(), ownsRecall: false, detach: () => {} };
    const cancel = () => {
      const index = scene!.pending.indexOf(entry);
      if (index < 0) return;
      scene!.pending.splice(index, 1); scene!.bytes -= bytes;
      input.audit({ event: 'group_review_cancelled', messageId: input.messageId });
      this.#finish(entry);
    };
    signal.addEventListener('abort', cancel, { once: true });
    entry.detach = () => signal.removeEventListener('abort', cancel);
    scene.pending.push(entry); scene.pending.sort((a, b) => a.order - b.order); scene.bytes += bytes;
    scene.active.set(key, entry);
    if (!this.#running) {
      if (takeGroupBatch(scene.pending).length === REQUEST_BATCHES) this.#start();
      else if (!this.#timer) {
        this.#timer = setTimeout(() => this.#start(), COLLECT_MS);
        this.#timer.unref();
      }
    }
    return { done: entry.done.promise };
  }

  #assertActive(): void {
    this.#abort.signal.throwIfAborted();
    if (!this.#gate.active) throw new Error('Group review generation is not active');
  }

  #start(): void {
    clearTimeout(this.#timer); this.#timer = undefined;
    if (this.#running || this.#abort.signal.aborted) return;
    this.#running = true;
    void this.#drain().finally(() => {
      this.#running = false;
      if (!this.#abort.signal.aborted && [...this.#scenes.values()].some(scene => scene.pending.length)) this.#start();
    });
  }

  async #drain(): Promise<void> {
    while (!this.#abort.signal.aborted) {
      const scene = [...this.#scenes.values()].filter(item => item.pending.length)
        .sort((a, b) => a.pending[0]!.order - b.pending[0]!.order)[0];
      if (!scene) return;
      // Each finite batch owns the current snapshot after its inbound Message expires. A retained
      // queue must not pin an old generation throughout a continuously busy drain loop.
      const release = this.#gate.acquire();
      if (!release) return;
      // Preserve FIFO across binding replacement; a request must use exactly one completion resource.
      const completion = scene.pending[0]!.input.completion;
      const boundary = scene.pending.findIndex(entry => entry.input.completion !== completion);
      const compatible = boundary < 0 ? scene.pending : scene.pending.slice(0, boundary);
      const entries = takeGroupBatch(compatible).flat().sort((a, b) => a.order - b.order);
      scene.pending.splice(0, entries.length); scene.bytes -= entries.reduce((sum, item) => sum + item.bytes, 0);
      try {
        await reviewGroupBatch(this.#moderator, entries.map(entry => ({ ...entry.input,
          onReview: () => { entry.ownsRecall = true; entry.input.onReview?.(); },
        })), this.#abort.signal);
      } catch (error) {
        for (const entry of entries) entry.input.audit({ event: 'group_review_batch_failed', messageId: entry.input.messageId,
          error: error instanceof Error ? error.message : String(error) });
      } finally {
        for (const entry of entries) this.#finish(entry);
        release();
      }
    }
  }

  #finish(entry: Entry): void {
    entry.detach();
    const active = this.#scenes.get(entry.input.scope)?.active;
    const key = JSON.stringify([entry.sender, entry.input.messageId]);
    if (active?.get(key) === entry) active.delete(key);
    entry.done.resolve(entry.ownsRecall);
  }
}
