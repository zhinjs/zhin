import { operationsImpliedByProfile } from '@zhin.js/adapter';
import sandboxAdapter from '../adapters/sandbox/index.js';

/**
 * The control operations the real Sandbox definition declares (ADR 0064 P1b): Endpoint harnesses
 * that bypass `defineAdapter` pass them so the assembly check sees the same declaration.
 */
export const sandboxOperations = operationsImpliedByProfile(sandboxAdapter.profile!);
