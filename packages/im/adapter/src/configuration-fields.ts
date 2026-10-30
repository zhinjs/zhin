import { AdapterManagementError } from './adapter-types.js';

/** Configuration paths come from each Adapter's explicit field declarations. */
export function readConfigurationPath(config: Readonly<Record<string, unknown>>, field: string): unknown {
  let value: unknown = config;
  for (const part of field.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function writeConfigurationPath(config: Record<string, unknown>, field: string, value: unknown): void {
  const parts = field.split('.');
  if (parts.some(part => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new AdapterManagementError('invalid_configuration', 'Invalid declared configuration path');
  }
  let current = config;
  for (const part of parts.slice(0, -1)) {
    const previous = Object.hasOwn(current, part) ? current[part] : undefined;
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}
