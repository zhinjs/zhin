/**
 * Register built-in system tools (file/shell/web/schedule/memory/skill)
 * and workspace skills with hot-reload support.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPlugin, type Tool, type SkillFeature } from '@zhin.js/core';
import { createBuiltinTools, discoverWorkspaceSkills, loadAlwaysSkillsContent, buildSkillsSummaryXML } from '../builtin-tools.js';
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

    const provider = ai.getProvider();
    const agentCfg = ai.getAgentConfig();
    const fullCfg = { ...DEFAULT_CONFIG, ...agentCfg } as Required<import('../zhin-agent/config.js').ZhinAgentConfig>;
    const modelName = provider.models[0] || '';
    const builtinTools = createBuiltinTools({ skillInstructionMaxChars: resolveSkillInstructionMaxChars(fullCfg, modelName) });
    const disposers: (() => void)[] = [];
    for (const tool of builtinTools) disposers.push(toolService.addTool(tool, root.name));
    const cronTools = createCronTools();
    for (const tool of cronTools) disposers.push(toolService.addTool(tool, root.name));
    logger.info(`Registered ${builtinTools.length} built-in + ${cronTools.length} cron tools`);

    let skillWatchers: fs.FSWatcher[] = [];
    let skillReloadDebounce: ReturnType<typeof setTimeout> | null = null;

    async function syncWorkspaceSkills(): Promise<number> {
      const skillFeature = root.inject?.('skill') as SkillFeature | undefined;
      if (!skillFeature) return 0;
      const existing = skillFeature.getByPlugin(root.name);
      for (const s of existing) skillFeature.remove(s);
      const skills = await discoverWorkspaceSkills();
      if (skills.length === 0) return 0;
      const allRegisteredTools = toolService.getAll();
      const toolNameIndex = new Map<string, Tool>();
      for (const t of allRegisteredTools) {
        toolNameIndex.set(t.name, t);
        const parts = t.name.split('_');
        if (parts.length === 2) toolNameIndex.set(`${parts[1]}_${parts[0]}`, t);
      }
      for (const s of skills) {
        const associatedTools: Tool[] = [];
        const toolNames = s.toolNames || [];
        for (const toolName of toolNames) {
          let tool = toolService.get(toolName) || toolNameIndex.get(toolName);
          if (tool) associatedTools.push(tool);
        }
        skillFeature.add({
          name: s.name,
          description: s.description,
          tools: associatedTools,
          keywords: s.keywords || [],
          tags: s.tags || [],
          pluginName: root.name,
        }, root.name);
      }
      return skills.length;
    }

    (async () => {
      // Step 1: discover workspace skills
      try {
        const count = await syncWorkspaceSkills();
        const skillFeature = root.inject?.('skill') as SkillFeature | undefined;
        if (count > 0 && skillFeature) {
          logger.info(`Registered ${count} workspace skills`);
        }
      } catch (e: any) {
        logger.warn(`Failed to discover workspace skills: ${e.message}`);
      }

      // Step 2: load bootstrap files
      const loadedFiles: string[] = [];
      try {
        const workspaceDir = process.cwd();
        const bootstrapFiles = await loadBootstrapFiles(workspaceDir);
        const contextFiles = buildContextFiles(bootstrapFiles);

        logger.debug(`Bootstrap files loaded (cwd: ${workspaceDir}): ${bootstrapFiles.map(f => f.name + (f.missing ? ' (missing)' : '')).join(', ')}`);

        const soulFile = contextFiles.find(f => f.path === 'SOUL.md');
        if (soulFile && refs.zhinAgent) {
          logger.info('Loaded SOUL.md persona → agent prompt');
          loadedFiles.push('SOUL.md');
        }

        const toolsFile = contextFiles.find(f => f.path === 'TOOLS.md');
        if (toolsFile) {
          logger.info('Loaded TOOLS.md tool guidance → agent prompt');
          loadedFiles.push('TOOLS.md');
        }

        const agentsFile = contextFiles.find(f => f.path === 'AGENTS.md');
        if (agentsFile) {
          logger.info('Loaded AGENTS.md memory → agent prompt');
          loadedFiles.push('AGENTS.md');
        }

        if (refs.zhinAgent && contextFiles.length > 0) {
          const contextSection = buildBootstrapContextSection(contextFiles);
          refs.zhinAgent.setBootstrapContext(contextSection);
        }
      } catch (e: any) {
        logger.debug(`Bootstrap files not loaded: ${e.message}`);
      }

      // Step 3: inject always-on skills content + XML summary
      try {
        const skillsForContext = await discoverWorkspaceSkills();
        const alwaysContent = await loadAlwaysSkillsContent(skillsForContext);
        const skillsXml = buildSkillsSummaryXML(skillsForContext);
        if (refs.zhinAgent) {
          refs.zhinAgent.setActiveSkillsContext(alwaysContent);
          refs.zhinAgent.setSkillsSummaryXML(skillsXml);
        }
      } catch (e: unknown) {
        logger.debug(`Skills context not set: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Trigger agent:bootstrap hook
      const skillFeature2 = root.inject('skill') as SkillFeature | undefined;
      await triggerAIHook(createAIHookEvent('agent', 'bootstrap', undefined, {
        workspaceDir: process.cwd(),
        toolCount: builtinTools.length,
        skillCount: skillFeature2?.size ?? 0,
        bootstrapFiles: loadedFiles,
      }));

      // Hot-reload skill directories
      const workspaceSkillDir = path.join(process.cwd(), 'skills');
      const localSkillDir = path.join(os.homedir(), '.zhin', 'skills');
      const onSkillDirChange = () => {
        if (skillReloadDebounce) clearTimeout(skillReloadDebounce);
        skillReloadDebounce = setTimeout(async () => {
          skillReloadDebounce = null;
          try {
            const count = await syncWorkspaceSkills();
            const skillsForContext = await discoverWorkspaceSkills();
            const alwaysContent = await loadAlwaysSkillsContent(skillsForContext);
            const skillsXml = buildSkillsSummaryXML(skillsForContext);
            if (refs.zhinAgent) {
              refs.zhinAgent.setActiveSkillsContext(alwaysContent);
              refs.zhinAgent.setSkillsSummaryXML(skillsXml);
            }
            await triggerAIHook(createAIHookEvent('agent', 'skills-reloaded', undefined, { skillCount: count }));
            if (count >= 0) logger.info(`[技能热重载] 已更新，当前工作区技能数: ${count}`);
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
      skillWatchers.forEach(w => w.close());
      skillWatchers = [];
      if (skillReloadDebounce) clearTimeout(skillReloadDebounce);
    };
  });
}
