import { expect } from 'vitest';
import { Adapter } from '../../src/adapter.js';
import {
  getAdapterAiOutboundCapabilities,
  getAdapterAiOutboundExtensions,
} from '../../src/built/ai-outbound/adapter-access.js';

export function assertAiOutboundContract(
  AdapterClass: typeof Adapter,
  adapterName: string,
): void {
  expect(Object.prototype.isPrototypeOf.call(Adapter.prototype, AdapterClass.prototype)).toBe(true);
  expect(AdapterClass.aiOutboundCapabilities).toBeDefined();
  expect(typeof AdapterClass.prototype.sendMessage).toBe('function');

  const caps = getAdapterAiOutboundCapabilities(AdapterClass);
  expect(caps).toBeDefined();

  const extensions = getAdapterAiOutboundExtensions(AdapterClass);
  for (const ext of extensions) {
    expect(ext.key).toBeTruthy();
    expect(ext.schema).toBeDefined();
    expect(ext.examples.length).toBeGreaterThan(0);
  }

  void adapterName;
}
