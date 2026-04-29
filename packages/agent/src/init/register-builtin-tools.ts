/**
 * Register built-in system tools (file/shell/web/schedule/memory/skill)
 * and workspace skills with hot-reload support.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPlugin } from '@zhin.js/core';
import type { Tool } from '../orchestrator/types.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import { createBuiltinTools } from '../builtin-tools.js';
import { collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { discoverWorkspaceSkills, loadAlwaysSkillsContent, buildSkillsSummaryXML } from '../discovery/skills.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';
import { discoverWorkspaceTools, buildToolFromMeta } from '../discovery/tools.js';
import { resolveSkillInstructionMaxChars, DEFAULT_CONFIG } from '../zhin-agent/config.js';
import { loadBootstrapFiles, buildContextFiles, buildBootstrapContextSection } from '../bootstrap.js';
import { triggerAIHook, createAIHookEvent } from '../hooks.js';
import { createCronTools } from '../cron-engine.js';
import type { AIServiceRefs } from './shared-refs.js';

export function registerBuiltinTools(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', 'tool', (ai, toolService) => {
    if (!ai || !toolService) return;
    if (!ai.isReady()) return;

    const provider = ai.getProvider();
    const agentCfg = ai.getAgentConfig();
    const fullCfg = { ...DEFAULT_CONFIG, ...agentCfg } as Required<import('../zhin-agent/config.js').ZhinAgentConfig>;
    const modelName = provider.models[0] || '';
    const builtinTools = createBuiltinTools({
      plugin,
      skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullCfg, modelName),
      pluginSkillRootsResolver: () => collectPluginSkillSearchRoots(root),
      skillFileLookup: (name: string) => {
        const orchestrator = root.inject?.('agent') as AgentOrchestrator | undefined;
        return orchestrator?.skills.getByName(name)?.filePath;
      },
    });
    const disposers: (() => void)[] = [];
    for (const tool of builtinTools) disposers.push(toolService.addTool(tool, root.name));
    const cronTools = createCronTools();
    for (const tool of cronTools) disposers.push(toolService.addTool(tool, root.name));
    logger.info(`Registered ${builtinTools.length} built-in + ${cronTools.length} cron tools`);

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

    /** 重新关联所有已注册 Skill 的 tools（适配器 tool 后注册时调用） */
    function relinkSkillTools(): void {
      const orchestrator = root.inject?.('agent') as AgentOrchestrator | undefined;
      if (!orchestrator) return;
      for (const skill of orchestrator.skills.getAll()) {
        const declaredNames = skillToolNames.get(skill.name);
        if (!declaredNames || declaredNames.length === 0) continue;
        const newTools = resolveSkillTools(declaredNames);
        if (newTools.length > skill.tools.length) {
          skill.tools = newTools;
        }
      }
    }
    async function syncWorkspaceSkills(): Promise<number> {
      const orchestrator = root.inject?.('agent') as AgentOrchestrator | undefined;
      if (!orchestrator) return 0;
      // Remove previously discovered skills
      for (const existing of orchestrator.skills.getAll()) {
        orchestrator.skills.remove(existing.name);
      }
      skillToolNames.clear();
      const skills = await discoverWorkspaceSkills(root);
      if (skills.length > 0) {
        for (const s of skills) {
          const ownerName = s.ownerPlugin || root.name;
          const toolNames = s.toolNames || [];
          skillToolNames.set(s.name, toolNames);
          const associatedTools = resolveSkillTools(toolNames);
          orchestrator.addSkill({
            name: s.name,
            description: s.description,
            tools: associatedTools,
            keywords: s.keywords || [],
            tags: s.tags || [],
            platforms: s.platforms,
            pluginName: ownerName,
            filePath: s.filePath,
            always: s.always,
          }, undefined, ownerName);
          if(associatedTools.length){
            logger.info(`[注册] ${associatedTools.length} 工具${s.platforms?.length ? ', 平台: ' + s.platforms.join(',') : ', 通用'}`);
          }
        }
      }
      // Inject always-on skills content + XML summary into agent
      if (refs.zhinAgent) {
        const alwaysContent = await loadAlwaysSkillsContent(skills);
        const skillsXml = buildSkillsSummaryXML(skills);
        refs.zhinAgent.setActiveSkillsContext(alwaysContent);
        refs.zhinAgent.setSkillsSummaryXML(skillsXml);
      }
      return skills.length;
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
     * Discover *.agent.md files and register agent presets into AgentPresetFeature.
     */
    async function syncWorkspaceAgents(): Promise<number> {
      const orchestrator = root.inject?.('agent') as AgentOrchestrator | undefined;
      if (!orchestrator) return 0;

      // Remove previously discovered presets
      for (const existing of orchestrator.subagents.getAllPresets()) {
        orchestrator.subagents.removePreset(existing.name);
      }

      const agentMetas = await discoverWorkspaceAgents(root);
      if (agentMetas.length === 0) return 0;

      const allRegisteredTools = toolService.getAll();
      const toolNameIndex = new Map<string, Tool>();
      for (const t of allRegisteredTools) {
        toolNameIndex.set(t.name, t);
      }
      let added = 0;
      for (const meta of agentMetas) {
        if (orchestrator.subagents.getPreset(meta.name)) continue;
        const toolNames: string[] = [];
        for (const toolName of meta.toolNames || []) {
          const tool = toolService.get(toolName) || toolNameIndex.get(toolName);
          if (tool) toolNames.push(tool.name);
        }
        let systemPrompt: string | undefined;
        try {
          const content = await fs.promises.readFile(meta.filePath, 'utf-8');
          const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').trim();
          if (body) systemPrompt = body;
        } catch { /* ignore */ }
        orchestrator.addAgentPreset({
          name: meta.name,
          description: meta.description,
          systemPrompt: systemPrompt || '',
          tools: toolNames.length > 0 ? toolNames : undefined,
          model: meta.model,
          filePath: meta.filePath,
          pluginName: meta.ownerPlugin || root.name,
        }, undefined, meta.ownerPlugin || root.name);
        added++;
      }
      return added;
    }

    (async () => {
      // Step 1: discover workspace skills
      try {
        const count = await syncWorkspaceSkills();
        if (count > 0) {
          logger.info(`Registered ${count} workspace skills`);
        }
      } catch (e: any) {
        logger.warn(`Failed to discover workspace skills: ${e.message}`);
      }

      // Step 1b: discover *.tool.md file-based tools
      try {
        const toolCount = await syncWorkspaceTools();
        if (toolCount > 0) {
          logger.info(`Registered ${toolCount} workspace file-based tools`);
        }
      } catch (e: any) {
        logger.warn(`Failed to discover workspace tools: ${e.message}`);
      }

      // Step 1c: discover *.agent.md agent presets
      try {
        const agentCount = await syncWorkspaceAgents();
        if (agentCount > 0) {
          logger.info(`Registered ${agentCount} workspace agent presets`);
        }
      } catch (e: any) {
        logger.debug(`Failed to discover workspace agents: ${e.message}`);
      }

      // Step 2: load bootstrap files
      const loadedFiles: string[] = [];
      try {
        const workspaceDir = process.cwd();
        const bootstrapFiles = await loadBootstrapFiles(workspaceDir);
        const contextFiles = buildContextFiles(bootstrapFiles);

        logger.debug(`Bootstrap files loaded (cwd: ${workspaceDir}): ${bootstrapFiles.map(f => f.name + (f.missing ? ' (missing)' : '')).join(', ')}`);

        const soulFile = contextFiles.find(f => f.path === 'SOUL.md');
        if (soulFile && refs.zhinAgent) loadedFiles.push('SOUL.md');

        const toolsFile = contextFiles.find(f => f.path === 'TOOLS.md');
        if (toolsFile) loadedFiles.push('TOOLS.md');

        const agentsFile = contextFiles.find(f => f.path === 'AGENTS.md');
        if (agentsFile) loadedFiles.push('AGENTS.md');

        if (loadedFiles.length > 0) {
          logger.info(`Loaded bootstrap: ${loadedFiles.join(', ')} → agent prompt`);
        }

        if (refs.zhinAgent && contextFiles.length > 0) {
          const contextSection = buildBootstrapContextSection(contextFiles);
          refs.zhinAgent.setBootstrapContext(contextSection);
        }
      } catch (e: any) {
        logger.debug(`Bootstrap files not loaded: ${e.message}`);
      }

      // Trigger agent:bootstrap hook
      const orchestrator2 = root.inject?.('agent') as AgentOrchestrator | undefined;
      await triggerAIHook(createAIHookEvent('agent', 'bootstrap', undefined, {
        workspaceDir: process.cwd(),
        toolCount: builtinTools.length,
        skillCount: orchestrator2?.skills.size ?? 0,
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
            if (count >= 0) logger.info(`[Tool热重载] 已更新，工作区文件化Tool: ${count}`);
          } catch (e: any) {
            logger.warn(`[Tool热重载] 失败: ${e.message}`);
          }
        }, 400);
      };
      if (fs.existsSync(workspaceToolDir)) {
        try {
          const w = fs.watch(workspaceToolDir, { recursive: true }, onToolDirChange);
          skillWatchers.push(w);
          logger.debug(`[Tool热重载] 监听目录: ${workspaceToolDir}`);
        } catch (e: any) {
          logger.debug(`[Tool热重载] 无法监听 ${workspaceToolDir}: ${e.message}`);
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
            const count = await syncWorkspaceSkills();
            await triggerAIHook(createAIHookEvent('agent', 'skills-reloaded', undefined, { skillCount: count }));
            if (count >= 0) logger.info(`[技能热重载] 已更新，工作区技能: ${count}`);
          } catch (e: any) {
            logger.warn(`[技能热重载] 失败: ${e.message}`);
          }
        }, 400);
      };
      for (const dir of [workspaceSkillDir, localSkillDir]) {
        if (fs.existsSync(dir)) {
          try {
            const w = fs.watch(dir, { recursive: true }, onSkillDirChange);
            skillWatchers.push(w);
            logger.debug(`[技能热重载] 监听目录: ${dir}`);
          } catch (e: any) {
            logger.debug(`[技能热重载] 无法监听 ${dir}: ${e.message}`);
          }
        }
      }
    })();

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
