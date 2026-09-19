import type { AIService, WorkroomDefinition } from '@zhin.js/agent';
import {
  WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
  WorkroomDataGovernanceAuthorityWriter,
  assertAcceptanceProjectionDataGovernanceAuthority,
  createCapabilityPackManifest,
  createWorkroomDataGovernanceBootstrapCandidate,
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomGenerationAuthoritySnapshotFromRuntime,
  createWorkroomProfileOverlay,
  digestWorkroomCatalogProjectBinding,
  digestWorkroomProfileCatalogProject,
  type AgentHostWorkroomProfileControlPort,
  type WorkroomPlanningBootstrapCommand,
  type WorkroomPlanningSetupStatus,
} from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  assessWorkroomDisclosureSetup,
  isWorkroomPlanningPolicyReady,
  resolveWorkroomDisclosureAuthorityPublication,
  resolveWorkroomDisclosureBootstrap,
  resolveWorkroomPlanningPolicyPublication,
  type AgentHostAIConfig,
} from '../agent-host-config.js';
import {
  createWorkroomBootstrapAcceptancePolicy,
  createWorkroomPlanningBootstrapArtifacts,
} from './planning-bootstrap.js';
import type { AgentRuntimeFoundation } from '../agent-runtime-foundation.js';
import type { WorkroomDataGovernanceCoordinator } from './data-governance-coordinator.js';
import type { WorkroomProfileCoordinator } from './profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

type GenerationBindings = ReturnType<AgentRuntimeFoundation['listBindings']>;

export interface WorkroomPlanningCoordinatorOptions {
  readonly config: AgentHostAIConfig;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly snapshots: SnapshotReader;
  readonly service: AIService;
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly workroomTrustedPackPublishers?: readonly string[];
  readonly listBindings: () => GenerationBindings;
}

/** Owns Planning readiness, bootstrap publication, disclosure authority, and Console control. */
export class WorkroomPlanningCoordinator {
  readonly consoleControl: AgentHostWorkroomProfileControlPort;

  constructor(options: WorkroomPlanningCoordinatorOptions) {
    const aiConfig = options.config;
    const { generation, signal, service } = options;
    const workroomCatalog = options.runtime.catalog;
    const consoleProjectionAuthority = options.runtime.consoleProjectionAuthority;
    const profileComposition = options.profiles.composition;
    const projectProfiles = options.profiles.profiles;
    const dataGovernanceRuntime = options.governance.runtime;
    const localDataGovernance = options.governance.localAuthority;
    const listGenerationBindings = options.listBindings;
    const trustedPackPublishers = new Set(options.workroomTrustedPackPublishers ?? []);
    const resolveDisclosureBootstrap = (definition: WorkroomDefinition | undefined) =>
      resolveWorkroomDisclosureBootstrap(
        definition,
        agentId => service.getBindingRegistry().getBinding(agentId)?.providerAlias,
        aiConfig,
      );
    const ensureDisclosureAuthority = async (input: Readonly<{
      projectId: string;
      catalogRevision: string;
      definition: WorkroomDefinition;
      principalId: string;
    }>): Promise<void> => {
      const repository = dataGovernanceRuntime.options.repository;
      const current = await repository.readProject(input.projectId);
      const currentAuthorization = await consoleProjectionAuthority.authorize({
        destination: 'console',
        projectId: input.projectId,
        recipientPrincipalId: input.principalId,
        requestedMode: 'metadata_only',
      });
      let acceptanceProjectionAuthorityCurrent = current !== undefined;
      if (current) {
        try {
          assertAcceptanceProjectionDataGovernanceAuthority(current);
        } catch {
          acceptanceProjectionAuthorityCurrent = false;
        }
      }
      const publication = resolveWorkroomDisclosureAuthorityPublication(
        current,
        currentAuthorization !== null && acceptanceProjectionAuthorityCurrent,
      );
      if (!publication) return;
      if (!localDataGovernance) {
        throw new Error('Workroom 披露初始化缺少 Root-private Data Governance 签发能力');
      }
      const { modelProviderAlias, contract } = resolveDisclosureBootstrap(input.definition);
      if (!modelProviderAlias) {
        throw new Error('Workroom orchestrator 没有可用的 ai.agents model binding');
      }
      if (!contract) {
        throw new Error(`请先配置 ai.workroom.disclosure.modelProviders.${modelProviderAlias}`);
      }
      const candidate = createWorkroomDataGovernanceBootstrapCandidate({
        projectId: input.projectId,
        tenantId: aiConfig.workroom?.disclosure?.tenantId ?? `workroom:${input.projectId}`,
        definition: input.definition,
        revision: publication.revision,
        ...(publication.previousDigest ? { previousDigest: publication.previousDigest } : {}),
        model: {
          providerId: modelProviderAlias,
          endpoint: contract.endpoint,
          ...(contract.owner ? { owner: contract.owner } : {}),
          ...(contract.trustDomain ? { trustDomain: contract.trustDomain } : {}),
          processingRegions: contract.processingRegions,
          maxConfidentiality: contract.maxConfidentiality,
          external: contract.external,
          noTraining: contract.noTraining,
          loggingMode: contract.loggingMode,
          maximumRetentionSeconds: contract.maximumRetentionSeconds,
          allowsRedisclosure: contract.allowsRedisclosure,
          supportsDeletion: contract.supportsDeletion,
        },
      });
      const writer = new WorkroomDataGovernanceAuthorityWriter({
        catalog: workroomCatalog,
        repository,
        decisions: Object.freeze({
          authorize: async (
            decisionInput: Parameters<ConstructorParameters<
              typeof WorkroomDataGovernanceAuthorityWriter
            >[0]['decisions']['authorize']>[0],
            operationSignal: AbortSignal,
          ) =>
            await localDataGovernance.issuePublicationDecision({
              ...decisionInput,
              principalId: input.principalId,
              authorizedBy: 'sponsor',
            }, operationSignal),
        }),
      });
      await writer.publish({
        catalogRevision: input.catalogRevision,
        catalogBindingDigest: digestWorkroomCatalogProjectBinding(input.definition),
        candidate,
      }, signal);
    };
    const readPlanningSetupStatus = async (
      projectId: string,
      authenticatedPrincipal?: Readonly<{ principalId: string }>,
    ): Promise<WorkroomPlanningSetupStatus> => {
      const [catalog, profiles] = await Promise.all([
        workroomCatalog.read(),
        projectProfiles.read(projectId),
      ]);
      const definition = catalog.definitions[projectId];
      const principalId = authenticatedPrincipal?.principalId;
      const lease = options.snapshots!.acquire();
      try {
        if (lease.value.generation !== generation) {
          throw new Error('Workroom Planning setup targets another Root generation');
        }
        const supply = createWorkroomGenerationAuthoritySnapshotFromRuntime(
          lease.value,
          listGenerationBindings(),
        );
        const availableAgents = supply.agents.map(agent => agent.id).sort();
        const availableTools = supply.tools.map(tool => tool.name).sort();
        const availableSkills = supply.skills.map(skill => skill.name).sort();
        const diagnostics: string[] = [];
        const trustedPackPublisher = principalId !== undefined && trustedPackPublishers.has(principalId);
        const projectSponsor = principalId !== undefined && definition?.sponsors?.includes(principalId) === true;
        if (!principalId) diagnostics.push('当前 Console token 未绑定 principalId');
        else {
          if (!trustedPackPublisher) diagnostics.push(`principal ${principalId} 不在 ai.workroom.trustedPackPublishers`);
          if (!projectSponsor) diagnostics.push(`principal ${principalId} 不在 Project sponsors`);
        }
        let catalogReady = definition !== undefined && definition.enabled !== false
          && definition.conversation !== undefined;
        if (!definition) diagnostics.push(`Workroom Project ${projectId} 不存在`);
        else {
          if (definition.enabled === false) diagnostics.push(`Workroom Project ${projectId} 已停用`);
          if (!definition.conversation) diagnostics.push('Project 尚未绑定 Workroom conversation');
          const rolesByAgent = new Map<string, Set<string>>();
          for (const member of definition.members) {
            const roles = rolesByAgent.get(member.agent) ?? new Set<string>();
            roles.add(member.role);
            rolesByAgent.set(member.agent, roles);
            if (!availableAgents.includes(member.agent)) {
              diagnostics.push(`成员 ${member.agent} 没有对应的 ai.agents binding`);
              catalogReady = false;
            }
          }
          for (const [agent, roles] of rolesByAgent) {
            if (roles.size > 1) {
              diagnostics.push(`成员 ${agent} 同时承担 ${[...roles].sort().join('/')}；每个 Workroom 角色需要独立 Agent binding`);
              catalogReady = false;
            }
          }
          const orchestrator = definition.members.find(member => member.role === 'orchestrator'
            && member.agent === definition.conversation?.agent);
          if (!orchestrator) {
            diagnostics.push('conversation.agent 必须对应唯一 orchestrator 成员');
            catalogReady = false;
          }
        }
        const active = profiles.active;
        const activeRevision = active ? profiles.revisions[active.revisionId] : undefined;
        if (!active || !activeRevision) diagnostics.push('尚未发布并激活 Project Profile');
        let planningPolicyReady = false;
        let acceptancePolicyReady = false;
        if (definition && active && activeRevision) {
          const profile = activeRevision.compiledProfile;
          const acceptance = profile.acceptancePolicies ?? [];
          acceptancePolicyReady = acceptance.length === 1
            && profile.workflows.every(workflow => workflow.tasks.every(task =>
              acceptance[0]!.tasks.some(policyTask => policyTask.taskKey === task.key)));
          if (!acceptancePolicyReady) {
            diagnostics.push('active Profile 尚未绑定覆盖 Workflow Task 的 Acceptance Policy');
          }
          const authority = await profileComposition.planningPolicy.resolve({
            version: 1,
            generation: createWorkroomDynamicPlanningGenerationSnapshot(generation),
            projectId,
            catalogRevision: catalog.revision,
            projectDigest: digestWorkroomProfileCatalogProject(definition),
            profile: {
              revisionId: active.revisionId,
              digest: active.compiledDigest,
              strategies: profile.workflows.map(workflow => ({
                id: workflow.id,
                version: active.revisionId,
                digest: workflow.digest,
              })),
              roles: [...new Set(profile.agents.map(agent => agent.role))].sort(),
              capabilities: {
                tools: profile.tools.map(tool => tool.id).sort(),
                skills: profile.skills.map(skill => skill.id).sort(),
                integrations: [],
                authorities: [],
              },
            },
          });
          planningPolicyReady = isWorkroomPlanningPolicyReady(authority);
          if (!authority) diagnostics.push('active Profile 尚未绑定 Planning Policy');
          else if (!planningPolicyReady) {
            diagnostics.push('active Planning Policy 的 Scheduler 序列锚点已过期');
          }
        }
        const { modelProviderAlias, contract } = resolveDisclosureBootstrap(definition);
        const disclosureAuthority = await dataGovernanceRuntime.options.repository.readProject(projectId);
        const disclosureAuthorization = principalId
          ? await consoleProjectionAuthority.authorize({
              destination: 'console',
              projectId,
              recipientPrincipalId: principalId,
              requestedMode: 'metadata_only',
            })
          : null;
        const disclosure = assessWorkroomDisclosureSetup({
          resolution: { modelProviderAlias, contract },
          authorityPublished: disclosureAuthority !== undefined,
          authorityCurrent: disclosureAuthorization !== null,
          localIssuerAvailable: localDataGovernance !== undefined,
        });
        diagnostics.push(...disclosure.diagnostics);
        const { disclosureReady, disclosureConfigReady } = disclosure;
        const ready = catalogReady && activeRevision !== undefined && planningPolicyReady
          && acceptancePolicyReady && disclosureReady;
        return Object.freeze({
          projectId,
          ready,
          ...(principalId ? { principalId } : {}),
          trustedPackPublisher,
          projectSponsor,
          catalogReady,
          registryRevision: profiles.registryRevision,
          ...(active ? { activeProfile: Object.freeze({
            revisionId: active.revisionId,
            digest: active.compiledDigest,
          }) } : {}),
          planningPolicyReady,
          disclosureReady,
          disclosureConfigReady,
          ...(modelProviderAlias ? { modelProviderAlias } : {}),
          availableAgents: Object.freeze(availableAgents),
          availableTools: Object.freeze(availableTools),
          availableSkills: Object.freeze(availableSkills),
          diagnostics: Object.freeze(diagnostics),
        });
      } finally {
        lease.release();
      }
    };
    const bootstrapPlanning = async (
      command: WorkroomPlanningBootstrapCommand,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<WorkroomPlanningSetupStatus> => {
      if (authenticatedPrincipal.principalId === WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL) {
        throw new Error('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
      }
      const before = await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
      if (before.ready) return before;
      if (!before.catalogReady || !before.trustedPackPublisher || !before.projectSponsor) {
        throw new Error(before.diagnostics.join('; ') || 'Workroom Planning bootstrap prerequisites are unavailable');
      }
      if (before.registryRevision !== command.expectedRegistryRevision) {
        throw new Error(
          `Project Profile Registry revision conflict: expected ${command.expectedRegistryRevision}, actual ${before.registryRevision}`,
        );
      }
      const [catalog, profiles] = await Promise.all([
        workroomCatalog.read(),
        projectProfiles.read(command.projectId),
      ]);
      const definition = catalog.definitions[command.projectId]!;
      const activeRevision = before.activeProfile
        ? profiles.revisions[before.activeProfile.revisionId]
        : undefined;
      const activeAcceptancePolicies = activeRevision?.compiledProfile.acceptancePolicies ?? [];
      const activeAcceptanceReady = Boolean(activeRevision && activeAcceptancePolicies.length === 1
        && activeRevision.compiledProfile.workflows.every(workflow => workflow.tasks.every(task =>
          activeAcceptancePolicies[0]!.tasks.some(policyTask => policyTask.taskKey === task.key))));
      if (before.planningPolicyReady && activeAcceptanceReady) {
        await ensureDisclosureAuthority({
          projectId: command.projectId,
          catalogRevision: catalog.revision,
          definition,
          principalId: authenticatedPrincipal.principalId,
        });
        return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
      }
      const lease = options.snapshots!.acquire();
      try {
        if (lease.value.generation !== generation) {
          throw new Error('Workroom Planning bootstrap targets another Root generation');
        }
        const supply = createWorkroomGenerationAuthoritySnapshotFromRuntime(
          lease.value,
          listGenerationBindings(),
        );
        const artifacts = createWorkroomPlanningBootstrapArtifacts({
          projectId: command.projectId,
          definition,
          supply,
          principalId: authenticatedPrincipal.principalId,
          ...(command.includeTools ? { includeTools: command.includeTools } : {}),
          ...(command.includeSkills ? { includeSkills: command.includeSkills } : {}),
        });
        if (before.activeProfile) {
          const active = profiles.revisions[before.activeProfile.revisionId];
          if (!active) throw new Error('Active Project Profile revision is unavailable');
          if (!activeAcceptanceReady) {
            if ((active.compiledProfile.acceptancePolicies ?? []).length > 0) {
              throw new Error('active Profile 的 Acceptance Policy 未完整覆盖 Workflow Task，请发布修订后的 Profile');
            }
            const acceptancePolicy = createWorkroomBootstrapAcceptancePolicy({
              projectId: command.projectId,
              definition,
              principalId: authenticatedPrincipal.principalId,
              tasks: active.compiledProfile.workflows.flatMap(workflow => workflow.tasks),
            });
            const acceptancePack = createCapabilityPackManifest({
              id: `workroom:${command.projectId}:acceptance-bootstrap`,
              version: '1.0.0',
              kind: 'policy',
              acceptancePolicies: [acceptancePolicy],
            });
            const { digest: _acceptancePackDigest, ...acceptancePackInput } = acceptancePack;
            const publication = await profileComposition.control.publishPack({
              version: 1,
              operationId: `${command.operationId}:acceptance-pack`,
              authenticatedPrincipalId: authenticatedPrincipal.principalId,
              pack: acceptancePackInput,
            }, signal);
            const upgradedOverlay = createWorkroomProfileOverlay({
              version: 1,
              projectId: command.projectId,
              revisionId: `${active.revisionId}:acceptance:1`,
              charterRevisionId: active.charterRevisionId,
              parentRevisionId: active.revisionId,
              packs: [...active.packRefs, publication.pack],
              enabledTools: active.compiledProfile.tools.map(tool => tool.id),
              enabledSkills: active.compiledProfile.skills.map(skill => skill.id),
              enabledAgents: active.compiledProfile.agents.map(agent => agent.id),
              enabledWorkflows: active.compiledProfile.workflows.map(workflow => workflow.id),
              enabledMemories: active.compiledProfile.memories.map(memory => memory.id),
              enabledGlossaries: active.compiledProfile.glossaries.map(glossary => glossary.id),
              enabledAcceptancePolicies: [acceptancePolicy.id],
            });
            const upgraded = await profileComposition.control.publishProfile({
              version: 1,
              operationId: `${command.operationId}:acceptance-profile`,
              authenticatedPrincipalId: authenticatedPrincipal.principalId,
              projectId: command.projectId,
              expectedRegistryRevision: profiles.registryRevision,
              overlay: upgradedOverlay,
              source: {
                kind: 'sponsor_decision',
                sourceId: `console-bootstrap:${command.operationId}:acceptance`,
              },
              activate: true,
            }, signal);
            const upgradedActive = upgraded.active!;
            const currentPlanningPolicy = await profileComposition.control.readPlanningPolicy(
              command.projectId,
              upgradedActive.revisionId,
            );
            const planningPublication = resolveWorkroomPlanningPolicyPublication(currentPlanningPolicy);
            await profileComposition.control.publishPlanningPolicy({
              version: 1,
              operationId: `${command.operationId}:policy`,
              authenticatedPrincipalId: authenticatedPrincipal.principalId,
              projectId: command.projectId,
              catalogRevision: catalog.revision,
              projectDigest: digestWorkroomProfileCatalogProject(definition),
              profileRevisionId: upgradedActive.revisionId,
              profileDigest: upgradedActive.compiledDigest,
              ...planningPublication,
              policy: artifacts.policy,
            }, signal);
            await ensureDisclosureAuthority({
              projectId: command.projectId,
              catalogRevision: catalog.revision,
              definition,
              principalId: authenticatedPrincipal.principalId,
            });
            return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
          }
          const currentPlanningPolicy = await profileComposition.control.readPlanningPolicy(
            command.projectId,
            active.revisionId,
          );
          const planningPublication = resolveWorkroomPlanningPolicyPublication(currentPlanningPolicy);
          await profileComposition.control.publishPlanningPolicy({
            version: 1,
            operationId: `${command.operationId}:policy`,
            authenticatedPrincipalId: authenticatedPrincipal.principalId,
            projectId: command.projectId,
            catalogRevision: catalog.revision,
            projectDigest: digestWorkroomProfileCatalogProject(definition),
            profileRevisionId: active.revisionId,
            profileDigest: active.compiledDigest,
            ...planningPublication,
            policy: artifacts.policy,
          }, signal);
          await ensureDisclosureAuthority({
            projectId: command.projectId,
            catalogRevision: catalog.revision,
            definition,
            principalId: authenticatedPrincipal.principalId,
          });
          return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
        }
        const publication = await profileComposition.control.publishPack({
          version: 1,
          operationId: `${command.operationId}:pack`,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          pack: artifacts.packInput,
        }, signal);
        const overlay = createWorkroomProfileOverlay({
          version: 1,
          projectId: command.projectId,
          revisionId: artifacts.overlay.revisionId,
          charterRevisionId: artifacts.overlay.charterRevisionId,
          packs: [publication.pack],
          enabledTools: artifacts.overlay.enabledTools,
          enabledSkills: artifacts.overlay.enabledSkills,
          enabledAgents: artifacts.overlay.enabledAgents,
          enabledWorkflows: artifacts.overlay.enabledWorkflows,
          enabledAcceptancePolicies: artifacts.overlay.enabledAcceptancePolicies,
        });
        const profile = await profileComposition.control.publishProfile({
          version: 1,
          operationId: `${command.operationId}:profile`,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          projectId: command.projectId,
          expectedRegistryRevision: profiles.registryRevision,
          overlay,
          source: {
            kind: 'sponsor_decision',
            sourceId: `console-bootstrap:${command.operationId}`,
          },
          activate: true,
        }, signal);
        const active = profile.active!;
        const currentPlanningPolicy = await profileComposition.control.readPlanningPolicy(
          command.projectId,
          active.revisionId,
        );
        const planningPublication = resolveWorkroomPlanningPolicyPublication(currentPlanningPolicy);
        await profileComposition.control.publishPlanningPolicy({
          version: 1,
          operationId: `${command.operationId}:policy`,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          projectId: command.projectId,
          catalogRevision: catalog.revision,
          projectDigest: digestWorkroomProfileCatalogProject(definition),
          profileRevisionId: active.revisionId,
          profileDigest: active.compiledDigest,
          ...planningPublication,
          policy: artifacts.policy,
        }, signal);
        await ensureDisclosureAuthority({
          projectId: command.projectId,
          catalogRevision: catalog.revision,
          definition,
          principalId: authenticatedPrincipal.principalId,
        });
      } finally {
        lease.release();
      }
      return await readPlanningSetupStatus(command.projectId, authenticatedPrincipal);
    };
    this.consoleControl = Object.freeze({
      getPlanningStatus: readPlanningSetupStatus,
      bootstrapPlanning,
      publishPack: async (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishPack']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishPack']>[1],
      ) => {
        if (authenticatedPrincipal.principalId === WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL) {
          throw new Error('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
        }
        return await profileComposition.control.publishPack({
          ...structuredClone(command),
          version: 1,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
        }, signal);
      },
      publishProfile: (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishProfile']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishProfile']>[1],
      ) =>
        profileComposition.control.publishProfile({
          ...structuredClone(command),
          version: 1,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          source: Object.freeze({
            kind: 'sponsor_decision' as const,
            sourceId: `console:${command.operationId}`,
          }),
        }, signal),
      publishRollback: (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishRollback']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishRollback']>[1],
      ) =>
        profileComposition.control.publishRollback({
          ...structuredClone(command),
          version: 1,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          source: Object.freeze({
            kind: 'sponsor_decision' as const,
            sourceId: `console:${command.operationId}`,
          }),
        }, signal),
      publishPlanningPolicy: async (
        command: Parameters<AgentHostWorkroomProfileControlPort['publishPlanningPolicy']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomProfileControlPort['publishPlanningPolicy']>[1],
      ) => {
        const [catalog, profiles] = await Promise.all([
          workroomCatalog.read(),
          projectProfiles.read(command.projectId),
        ]);
        const definition = catalog.definitions[command.projectId];
        const profile = profiles.revisions[command.profileRevisionId];
        if (!definition || definition.enabled === false || !profile) {
          throw new Error('Console Planning Policy targets an unavailable Project/Profile');
        }
        return await profileComposition.control.publishPlanningPolicy({
          ...structuredClone(command),
          version: 1,
          authenticatedPrincipalId: authenticatedPrincipal.principalId,
          catalogRevision: catalog.revision,
          projectDigest: digestWorkroomProfileCatalogProject(definition),
          profileDigest: profile.compiledDigest,
        }, signal);
      },
    });
  }
}
