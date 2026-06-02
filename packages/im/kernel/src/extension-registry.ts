/**
 * Shared extension registry with reference counting.
 *
 * Extensions (methods added by contexts via `provide()`) are stored here
 * instead of being directly written to `Class.prototype`. A Proxy on the
 * prototype chain intercepts property access and resolves from the registry.
 *
 * This prevents the bug where stopping one plugin deletes an extension
 * that another plugin still depends on.
 */

const registry = new Map<string, { fn: Function; refCount: number }>();
const proxiedPrototypes = new WeakSet<object>();

export function registerExtension(name: string, fn: Function): void {
  const existing = registry.get(name);
  if (existing) {
    existing.fn = fn;
    existing.refCount++;
  } else {
    registry.set(name, { fn, refCount: 1 });
  }
}

export function unregisterExtensions(names: string[]): void {
  for (const name of names) {
    const entry = registry.get(name);
    if (entry) {
      entry.refCount--;
      if (entry.refCount <= 0) registry.delete(name);
    }
  }
}

export function getExtension(name: string): Function | undefined {
  return registry.get(name)?.fn;
}

export function hasExtension(name: string): boolean {
  return registry.has(name);
}

/**
 * Install a Proxy on the given prototype so that extension lookups
 * are intercepted and resolved from the registry.
 */
export function installExtensionProxy(prototype: object): void {
  if (proxiedPrototypes.has(prototype)) return;
  proxiedPrototypes.add(prototype);

  const handler: ProxyHandler<object> = {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const entry = registry.get(prop);
        if (entry) return entry.fn;
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string" && registry.has(prop)) return true;
      return Reflect.has(target, prop);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === "string" && registry.has(prop)) {
        registry.get(prop)!.fn = value;
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
  };

  const parent = Object.getPrototypeOf(prototype);
  Object.setPrototypeOf(prototype, new Proxy(parent, handler));
}
