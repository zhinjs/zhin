import { Database } from './types';
export type Factory<T = Database> = (...args: any[]) => T | Promise<T>;
export const dbFactories: Map<string, Factory> = new Map<string, Factory>();
export const initFactories: Map<string, any[]> = new Map<string, any[]>();
