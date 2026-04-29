/**
 * ResourceRegistry<T> — unified base class for all five resource types.
 *
 * Supports:
 *   - common resources (agentId omitted) — available to all agents
 *   - specialized resources (agentId set) — only for the specified agent
 *   - event listeners for add/remove
 */

import type { ResourceScope, ResourceEntry } from './types.js';

type RegistryEvent = 'add' | 'remove';
type RegistryListener<T> = (entry: ResourceEntry<T>) => void;

export class ResourceRegistry<T extends { name: string }> {
  protected readonly common = new Map<string, ResourceEntry<T>>();
  protected readonly specialized = new Map<string, Map<string, ResourceEntry<T>>>();
  private readonly listeners = new Map<RegistryEvent, Set<RegistryListener<T>>>();

  add(resource: T, scope?: ResourceScope, source: string = 'unknown'): () => void {
    const entry: ResourceEntry<T> = { resource, scope: scope ?? {}, source };
    const agentId = scope?.agentId;

    if (agentId) {
      let agentMap = this.specialized.get(agentId);
      if (!agentMap) {
        agentMap = new Map();
        this.specialized.set(agentId, agentMap);
      }
      agentMap.set(resource.name, entry);
    } else {
      this.common.set(resource.name, entry);
    }

    this.emit('add', entry);
    return () => this.remove(resource.name, scope);
  }

  remove(name: string, scope?: ResourceScope): boolean {
    const agentId = scope?.agentId;
    let entry: ResourceEntry<T> | undefined;

    if (agentId) {
      const agentMap = this.specialized.get(agentId);
      if (agentMap) {
        entry = agentMap.get(name);
        agentMap.delete(name);
        if (agentMap.size === 0) this.specialized.delete(agentId);
      }
    } else {
      entry = this.common.get(name);
      this.common.delete(name);
    }

    if (entry) {
      this.emit('remove', entry);
      return true;
    }
    return false;
  }

  getCommon(): T[] {
    return Array.from(this.common.values()).map(e => e.resource);
  }

  getForAgent(agentId: string): T[] {
    const result = new Map<string, T>();
    for (const e of this.common.values()) result.set(e.resource.name, e.resource);
    const agentMap = this.specialized.get(agentId);
    if (agentMap) {
      for (const e of agentMap.values()) result.set(e.resource.name, e.resource);
    }
    return Array.from(result.values());
  }

  getAll(): T[] {
    const result = new Map<string, T>();
    for (const e of this.common.values()) result.set(e.resource.name, e.resource);
    for (const agentMap of this.specialized.values()) {
      for (const e of agentMap.values()) result.set(e.resource.name, e.resource);
    }
    return Array.from(result.values());
  }

  has(name: string, scope?: ResourceScope): boolean {
    const agentId = scope?.agentId;
    if (agentId) {
      return this.specialized.get(agentId)?.has(name) ?? false;
    }
    return this.common.has(name);
  }

  get(name: string, scope?: ResourceScope): T | undefined {
    const agentId = scope?.agentId;
    if (agentId) {
      return this.specialized.get(agentId)?.get(name)?.resource;
    }
    return this.common.get(name)?.resource;
  }

  get size(): number {
    let count = this.common.size;
    for (const m of this.specialized.values()) count += m.size;
    return count;
  }

  on(event: RegistryEvent, handler: RegistryListener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  dispose(): void {
    this.common.clear();
    this.specialized.clear();
    this.listeners.clear();
  }

  private emit(event: RegistryEvent, entry: ResourceEntry<T>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(entry);
      } catch {
        // swallow listener errors
      }
    }
  }
}
