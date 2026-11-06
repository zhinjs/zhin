import {
  definePlugin,
  definePluginCapabilityGraph,
  definePluginConsoleRpc,
  pluginConsoleRpcToken,
  type PluginConsoleRpc,
} from 'zhin.js';
import type { FullBotTraceStatus } from './pages/agent-trace/index.js';
import type { FullBotWorkroomStatus } from './pages/workroom/index.js';

export interface FullBotAdapterRow {
  readonly instance: string;
  readonly package: string;
  readonly mode: string;
  readonly [key: string]: string;
}

export interface FullBotCapabilityRow {
  readonly name: string;
  readonly kind: string;
  readonly entry: string;
  readonly [key: string]: string;
}

export interface FullBotConsoleStatus {
  readonly plugin: 'full-bot';
  readonly tier: 'L4 Reference';
  readonly nodeVersion: string;
  readonly rssMb: number;
  readonly heapMb: number;
  readonly uptimeSec: number;
  readonly adapters: readonly FullBotAdapterRow[];
  readonly capabilities: readonly FullBotCapabilityRow[];
  readonly updatedAt: string;
  readonly [key: string]:
    | string
    | number
    | readonly FullBotAdapterRow[]
    | readonly FullBotCapabilityRow[];
}

export function getFullBotConsoleStatus(): FullBotConsoleStatus {
  const mem = process.memoryUsage();
  return {
    plugin: 'full-bot',
    tier: 'L4 Reference',
    nodeVersion: process.version,
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
    adapters: [
      { instance: 'sandbox', package: '@zhin.js/adapter-sandbox', mode: 'local' },
      { instance: 'napcat', package: '@zhin.js/adapter-napcat', mode: 'ws' },
      { instance: 'kook', package: '@zhin.js/adapter-kook', mode: 'websocket' },
    ],
    capabilities: [
      {
        name: 'runtime-diagnostics',
        kind: 'skill + tool',
        entry: 'skills/runtime-diagnostics/tools/runtime-status/index.ts',
      },
      {
        name: 'memory-consolidate',
        kind: 'skill',
        entry: 'skills/memory-consolidate/SKILL.md',
      },
      {
        name: 'custom-prompt',
        kind: 'prompt-section',
        entry: 'prompt-sections/custom/index.ts',
      },
      {
        name: 'workroom & trace',
        kind: 'console-pages',
        entry: 'pages/workroom/index.ts & pages/agent-trace/index.ts',
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function getFullBotWorkroomSummary(): FullBotWorkroomStatus {
  return {
    plugin: 'full-bot',
    activeRuns: 0,
    pendingTasks: 0,
    journalMode: 'engagement-journal',
    runs: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getFullBotTraceSummary(): FullBotTraceStatus {
  return {
    plugin: 'full-bot',
    retentionDays: 7,
    maxArchiveMb: 64,
    recentTurns: 0,
    turns: [],
    updatedAt: new Date().toISOString(),
  };
}

export const fullBotConsoleRpc: PluginConsoleRpc = definePluginConsoleRpc({
  status: {
    page: 'index',
    demo: true,
    handler() {
      return { ...getFullBotConsoleStatus() };
    },
  },
  queries: {
    'workroom-summary': {
      page: 'workroom',
      demo: true,
      handler() {
        return { ...getFullBotWorkroomSummary() };
      },
    },
    'trace-summary': {
      page: 'agent-trace',
      demo: true,
      handler() {
        return { ...getFullBotTraceSummary() };
      },
    },
  },
  actions: {
    ping: {
      page: 'index',
      handler() {
        return {
          ok: true,
          message: 'full-bot L4 runtime active',
          timestamp: new Date().toISOString(),
        };
      },
    },
    'refresh-workroom': {
      page: 'workroom',
      handler() {
        return {
          ok: true,
          summary: { ...getFullBotWorkroomSummary() },
        };
      },
    },
    'refresh-traces': {
      page: 'agent-trace',
      handler() {
        return {
          ok: true,
          summary: { ...getFullBotTraceSummary() },
        };
      },
    },
  },
});

export default definePlugin({
  name: 'full-bot',
  metadata: {
    displayName: 'Full Bot (L4 reference)',
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [pluginConsoleRpcToken],
    features: {
      commands: ['hello', 'card'],
      components: ['status-card'],
      skills: ['memory-consolidate', 'runtime-diagnostics'],
      tools: ['runtime-status'],
      promptSections: ['custom'],
      pages: ['index', 'workroom', 'agent-trace'],
    },
  }),
  setup() {
    return { consoleRpc: fullBotConsoleRpc };
  },
});
