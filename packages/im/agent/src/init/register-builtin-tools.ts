/**
 * Register built-in system tools (file/shell/web/schedule/memory/skill)
 * and workspace skills with hot-reload support.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatCompact, getPlugin, isZhinTool } from '@zhin.js/core';
import type { Tool } from '../orchestrator/types.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { discoverWorkspaceSkills, loadAlwaysSkillsContent, buildSkillsSummaryXML } from '../discovery/skills.js';
import { discoverWorkspaceAgents, loadAgentInstructionsBody } from '../discovery/agents.js';
import { registerPluginAgentSurfaces } from '../discovery/register-agent-surface.js';
import { discoverWorkspaceTools, buildToolFromMeta } from '../discovery/tools.js';
import { resolveSkillInstructionMaxChars, DEFAULT_CONFIG } from '../config/index.js';
import { loadBootstrapFiles, buildContextFiles, buildStableBootstrapSection } from '../bootstrap.js';
import { loadBootstrapWithProfile, resolveAssistantConfig } from '../assistant/index.js';
import { createAIHookEvent } from '../orchestrator/hook-registry.js';
import { createScheduleTools } from '../schedule-manager.js';
import { createGenerateImageTool } from '../builtin/generate-image-tool.js';
import { markAgentBootstrapReady } from './bootstrap-gate.js';
import type { AIServiceRefs } from './shared-refs.js';

export function registerBuiltinTools(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', 'tool', (ai, toolService) => {
    if (!ai || !toolService) {
      markAgentBootstrapReady();
      return;
    }
    if (!ai.isReady()) {
      markAgentBootstrapReady();
      return;
    }

    const provider = ai.getProvider();
    const agentCfg = ai.getAgentConfig();
    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: { memory?: { semantic?: { enabled?: boolean } }; knowledge?: { baseDir?: string } } }>() ?? {};
    const semanticMemory = appConfig.ai?.memory?.semantic?.enabled === true;
    const knowledgeDir = appConfig.ai?.knowledge?.baseDir
      ? path.resolve(appConfig.ai.knowledge.baseDir)
      : path.join(process.cwd(), 'knowledge');
    const fullCfg = { ...DEFAULT_CONFIG, ...agentCfg } as Required<import('../config/index.js').ZhinAgentConfig>;
    const modelName = provider.models[0] || '';
    const builtinTools = createBuiltinTools({
      plugin,
      semanticMemory,
      knowledgeDir,
      skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullCfg, modelName),
      pluginSkillRootsResolver: () => collectPluginSkillSearchRoots(root),
      skillFileLookup: (name: string) => {
        const fromFeature = root.inject?.('skill')?.get(name)?.filePath;
        if (fromFeature) return fromFeature;
        const orchestrator = root.inject?.('agent') as AgentOrchestrator | undefined;
        return orchestrator?.skills.getByName(name)?.filePath;
      },
    });
    builtinTools.push(createGenerateImageTool(
      (alias) => ai.getProvider(alias),
      (alias) => ai.getImageGenerationDefaults(alias),
    ));
    const disposers: (() => void)[] = [];
    for (const tool of builtinTools) {
      const plain = isZhinTool(tool) ? tool.toTool() : tool;
      disposers.push(toolService.addTool({ ...plain, source: 'builtin' }, root.name));
    }
    const scheduleTools = createScheduleTools();
    for (const tool of scheduleTools) {
      const plain = tool.toTool();
      disposers.push(toolService.addTool({ ...plain, source: 'builtin' }, root.name));
    }

    // Boot: reserved/builtin → Orchestrator via Capability Ingress
    const orchestratorBoot = root.inject?.('agent') as AgentOrchestrator | undefined;
    const ingress = root.inject?.('capabilityIngress');
    if (orchestratorBoot && ingress) {
      ingress.ensureCore(orchestratorBoot, { tools: toolService });
    }

    let skillWatchers: fs.FSWatcher[] = [];
    let skillReloadDebounce: ReturnType<typeof setTimeout> | null = null;
    let toolReloadDebounce: ReturnType<typeof setTimeout> | null = null;
    /** 保存 skill → 声明的 toolNames 映射，供延迟重关联使用 */
    const skillToolNames = new Map<string, string[]>();

    /** 根据工具名列表从 toolService 查找 Tool */
    function resolveSkillTools(toolNames: string[]): Tool[] {
      if (toolNames.length === 0) return [];
      const allRegisteredTools = toolService.getAll();
      const toolNameIndex = new Map<string, Tool>();
      for (const t of allRegisteredTools) {
        toolNameIndex.set(t.name, t);
        const parts = t.name.split('_');
        if (parts.length === 2) toolNameIndex.set(`${parts[1]}_${parts[0]}`, t);
      }
      const result: Tool[] = [];
      for (const name of toolNames) {
        const tool = toolService.get(name) || toolNameIndex.get(name);
        if (tool) result.push(tool);
      }
      return result;
    }

    /** 重新关联 SkillFeature 中技能的 tools（适配器 tool 后注册时调用） */
    function relinkSkillTools(): void {
      const skillFeature = root.inject?.('skill');
      if (!skillFeature) return;
      let changed = false;
      for (const skill of skillFeature.getAll()) {
        const declaredNames = skillToolNames.get(skill.name);
        if (!declaredNames || declaredNames.length === 0) continue;
        const newTools = resolveSkillTools(declaredNames);
        if (newTools.length > skill.tools.length) {
          skill.tools = newTools as typeof skill.tools;
          changed = true;
        }
      }
      if (changed) root.inject?.('capabilityIngress')?.invalidate();
    }

    /**
     * Discover workspace skills → SkillFeature (ADR 0042); Orchestrator via Ingress.
     */
    async function syncWorkspaceSkills(): Promise<{ count: number; pluginTools: string }> {
      const skillFeature = root.inject?.('skill');
      if (!skillFeature) return { count: 0, pluginTools: '' };

      for (const existing of [...skillFeature.getAll()]) {
        skillFeature.remove(existing);
      }
      skillToolNames.clear();
      const skills = await discoverWorkspaceSkills(root);
      const pluginToolCounts: string[] = [];
      if (skills.length > 0) {
        for (const s of skills) {
          const ownerName = s.ownerPlugin || root.name;
          const toolNames = s.toolNames || [];
          skillToolNames.set(s.name, toolNames);
          const associatedTools = resolveSkillTools(toolNames);
          skillFeature.add({
            name: s.name,
            description: s.description,
            tools: associatedTools as import('@zhin.js/core').Tool[],
            keywords: s.keywords || [],
            tags: s.tags || [],
            platforms: s.platforms,
            pluginName: ownerName,
            filePath: s.filePath,
            always: s.always,
          }, ownerName);
          if (associatedTools.length) {
            const label = s.platforms?.length ? s.platforms.join('+') : 'generic';
            pluginToolCounts.push(`${label}:${associatedTools.length}`);
          }
        }
      }
      root.inject?.('capabilityIngress')?.invalidate();
      // Inject always-on skills content + XML summary into agent
      if (refs.zhinAgent) {
        const alwaysContent = await loadAlwaysSkillsContent(skills);
        const skillsXml = buildSkillsSummaryXML(skills);
        refs.zhinAgent.configure({ activeSkillsContext: alwaysContent, skillsSummaryXML: skillsXml });
      }
      return { count: skills.length, pluginTools: pluginToolCounts.join(',') };
    }

    // 文件化 Tool 的 disposer（用于热重载时移除旧 tool）
    let toolFileDisposers: (() => void)[] = [];

    /**
     * Discover *.tool.md files and register them as tools.
     */
    async function syncWorkspaceTools(): Promise<number> {
      // 移除之前文件化注册的 tool
      for (const d of toolFileDisposers) d();
      toolFileDisposers = [];

      const toolMetas = await discoverWorkspaceTools(root);
      if (toolMetas.length === 0) return 0;

      let added = 0;
      for (const meta of toolMetas) {
        // 跳过已通过程序化方式注册的同名 tool
        if (toolService.get(meta.name)) {
          logger.debug(`Tool '${meta.name}' 已存在（程序化注册），跳过文件化版本`);
          continue;
        }
        const tool = await buildToolFromMeta(meta);
        if (!tool) continue;
        const ownerName = meta.ownerPlugin || root.name;
        const dispose = toolService.addTool(tool, ownerName);
        toolFileDisposers.push(dispose);
        added++;
      }
      return added;
    }

    /**
     * Discover *.agent.md → AgentFeature (ADR 0042); Orchestrator via Ingress.
     */
    async function syncWorkspaceAgents(): Promise<number> {
      const agentFeature = root.inject?.('agentFeature');
      if (!agentFeature) return 0;

      for (const existing of [...agentFeature.getAll()]) {
        agentFeature.remove(existing);
      }

      const agentMetas = await discoverWorkspaceAgents(root);
      ai.setDiscoveredAgents(agentMetas);
      if (agentMetas.length === 0) {
        root.inject?.('capabilityIngress')?.invalidate();
        return 0;
      }

      const allRegisteredTools = toolService.getAll();
      const toolNameIndex = new Map<string, Tool>();
      for (const t of allRegisteredTools) {
        toolNameIndex.set(t.name, t);
      }
      let added = 0;
      for (const meta of agentMetas) {
        if (agentFeature.get(meta.name)) continue;
        const toolNames: string[] = [];
        for (const toolName of meta.toolNames || []) {
          const tool = toolService.get(toolName) || toolNameIndex.get(toolName);
          if (tool) toolNames.push(tool.name);
        }
        let systemPrompt: string | undefined;
        try {
          const agentDir = path.dirname(meta.filePath);
          const body = await loadAgentInstructionsBody(agentDir);
          if (body) systemPrompt = body;
        } catch { /* ignore */ }
        agentFeature.add({
          name: meta.name,
          description: meta.description,
          systemPrompt: systemPrompt || '',
          tools: toolNames.length > 0 ? toolNames : undefined,
          model: meta.model,
          filePath: meta.filePath,
          pluginName: meta.ownerPlugin || root.name,
        }, meta.ownerPlugin || root.name);
        added++;
      }
      root.inject?.('capabilityIngress')?.invalidate();
      return added;
    }

    (async () => {
      let skillCount = 0;
      let toolCount = 0;
      let agentCount = 0;
      let pluginTools = '';

      // Step 1: discover workspace skills
      try {
        const skillsResult = await syncWorkspaceSkills();
        skillCount = skillsResult.count;
        pluginTools = skillsResult.pluginTools;
      } catch (e: unknown) {
        logger.warn(formatCompact( { error: e instanceof Error ? e.message : String(e) }));
      }

      // Step 1b: discover *.tool.md file-based tools
      try {
        toolCount = await syncWorkspaceTools();
      } catch (e: unknown) {
        logger.warn(formatCompact( { error: e instanceof Error ? e.message : String(e) }));
      }

      // Step 1c: discover fractal agents/ presets
      try {
        agentCount = await syncWorkspaceAgents();
      } catch (e: unknown) {
        logger.debug(`Failed to discover workspace agents: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Step 1d: discover plugin agent/ authoring surfaces
      try {
        const orchestrator = root.inject?.('agent') as AgentOrchestrator | undefined;
        const configService = root.inject('config');
        const appConfig = configService?.getPrimary<{ connections?: Record<string, unknown> }>() ?? {};
        if (orchestrator) {
          const reg = await registerPluginAgentSurfaces(orchestrator, root, {
            connectionsConfig: appConfig.connections,
            toolService,
          });
          toolCount += reg.tools;
          skillCount += reg.skills;
          agentCount += reg.workspaceAgents;
          logger.debug(formatCompact({
            agentSurfaceTools: reg.tools,
            agentSurfaceSkills: reg.skills,
            agentSurfaceSchedules: reg.schedules,
            agentSurfaceConnections: reg.connections,
          }));
        }
      } catch (e: unknown) {
        logger.warn(formatCompact({ agentSurface: 'fail', error: e instanceof Error ? e.message : String(e) }));
      }

      // Step 2: load bootstrap files
      const loadedFiles: string[] = [];
      try {
        const workspaceDir = process.cwd();
        const configService = root.inject('config');
        const appConfig = (configService?.primaryFile
          ? configService.getRaw<{ assistant?: { profile?: import('../assistant/profile-types.js').AssistantProfileConfig } }>(configService.primaryFile)
          : configService?.getPrimary<{ assistant?: { profile?: import('../assistant/profile-types.js').AssistantProfileConfig } }>())
          ?? {};
        const assistantCfg = resolveAssistantConfig(appConfig.assistant as import('../assistant/config.js').AssistantConfig | undefined);
        const { files: bootstrapFiles, profile } = await loadBootstrapWithProfile(workspaceDir, assistantCfg.profile);
        const contextFiles = buildContextFiles(bootstrapFiles);

        logger.debug(`Bootstrap files loaded (cwd: ${workspaceDir}, profile: ${profile ? 'yes' : 'no'}): ${bootstrapFiles.map(f => f.name + (f.missing ? ' (missing)' : '')).join(', ')}`);

        const soulFile = contextFiles.find(f => f.path === 'SOUL.md');
        if (soulFile && refs.zhinAgent) loadedFiles.push('SOUL.md');

        const toolsFile = contextFiles.find(f => f.path === 'TOOLS.md');
        if (toolsFile) loadedFiles.push('TOOLS.md');

        const agentsFile = bootstrapFiles.find(f => f.name === 'AGENTS.md' && !f.missing);
        if (agentsFile) loadedFiles.push('AGENTS.md');

        if (refs.zhinAgent) {
          const stableSection = buildStableBootstrapSection(bootstrapFiles);
          if (stableSection) {
            refs.zhinAgent.configure({ bootstrapContext: stableSection });
          }
        }
      } catch (e: unknown) {
        logger.debug(`Bootstrap files not loaded: ${e instanceof Error ? e.message : String(e)}`);
      }

      logger.debug(formatCompact( {
        内置工具: builtinTools.length,
        定时任务工具: scheduleTools.length,
        技能数量: skillCount,
        工作区工具: toolCount,
        预设代理: agentCount,
        插件工具: pluginTools || undefined,
        引导文件: loadedFiles.length ? loadedFiles.join(',') : undefined,
      }));

      const orchestrator2 = root.inject?.('agent') as AgentOrchestrator | undefined;
      await orchestrator2?.hooks.trigger(createAIHookEvent('agent', 'bootstrap', undefined, {
        workspaceDir: process.cwd(),
        toolCount: builtinTools.length,
        skillCount: root.inject?.('skill')?.getAll().length ?? orchestrator2?.skills.size ?? 0,
        bootstrapFiles: loadedFiles,
      }));

      // Step 3: 延迟重关联 — 等适配器 tool 就绪后补齐 Skill 的 tools 列表
      setTimeout(() => relinkSkillTools(), 2000);

      // Hot-reload tool directories
      const workspaceToolDir = path.join(process.cwd(), 'tools');
      const onToolDirChange = () => {
        if (toolReloadDebounce) clearTimeout(toolReloadDebounce);
        toolReloadDebounce = setTimeout(async () => {
          toolReloadDebounce = null;
          try {
            const count = await syncWorkspaceTools();
            if (count >= 0) logger.debug(formatCompact( { reload: count }));
          } catch (e: unknown) {
            logger.warn(formatCompact( { reload: 'fail', error: e instanceof Error ? e.message : String(e) }));
          }
        }, 400);
      };
      if (fs.existsSync(workspaceToolDir)) {
        try {
          const w = fs.watch(workspaceToolDir, { recursive: true }, onToolDirChange);
          skillWatchers.push(w);
          logger.debug(`[Tool热重载] 监听目录: ${workspaceToolDir}`);
        } catch (e: unknown) {
          logger.debug(`[Tool热重载] 无法监听 ${workspaceToolDir}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Hot-reload skill directories
      const workspaceSkillDir = path.join(process.cwd(), 'skills');
      const localSkillDir = path.join(os.homedir(), '.zhin', 'skills');
      const onSkillDirChange = () => {
        if (skillReloadDebounce) clearTimeout(skillReloadDebounce);
        skillReloadDebounce = setTimeout(async () => {
          skillReloadDebounce = null;
          try {
            const skills = await syncWorkspaceSkills();
            const orch = root.inject?.('agent') as AgentOrchestrator | undefined;
            await orch?.hooks.trigger(createAIHookEvent('agent', 'skills-reloaded', undefined, { skillCount: skills.count }));
            if (skills.count >= 0) logger.debug(formatCompact( { skills: skills.count }));
          } catch (e: unknown) {
            logger.warn(formatCompact( { reload: 'fail', error: e instanceof Error ? e.message : String(e) }));
          }
        }, 400);
      };
      for (const dir of [workspaceSkillDir, localSkillDir]) {
        if (fs.existsSync(dir)) {
          try {
            const w = fs.watch(dir, { recursive: true }, onSkillDirChange);
            skillWatchers.push(w);
            logger.debug(`[技能热重载] 监听目录: ${dir}`);
          } catch (e: unknown) {
            logger.debug(`[技能热重载] 无法监听 ${dir}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    })().finally(() => markAgentBootstrapReady());

    return () => {
      disposers.forEach(d => d());
      toolFileDisposers.forEach(d => d());
      toolFileDisposers = [];
      skillWatchers.forEach(w => w.close());
      skillWatchers = [];
      if (skillReloadDebounce) clearTimeout(skillReloadDebounce);
      if (toolReloadDebounce) clearTimeout(toolReloadDebounce);
    };
  });
}
