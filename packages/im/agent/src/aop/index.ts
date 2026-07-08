/**
 * Agent Orchestration Plane — collaboration + legacy pipeline state (ADR 0024/0027).
 *
 * Model-facing cell_* pipeline tools were removed (ADR 0026). Default orchestration
 * uses OrchestrationKernel + orchestration_* tools.
 */
export * from './coordination/index.js';
export * from './pipeline/index.js';
export * from './inbound/index.js';
export * from './runtime/index.js';
