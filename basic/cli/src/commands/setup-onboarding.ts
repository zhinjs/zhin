/**
 * `zhin setup` / `zhin console init` side of ADR 0053 §5: both record onboarding steps and install
 * dependencies through the same `OnboardingService` the Console uses.
 */
import { OnboardingService, type InstallEvent, type InstallReport, type OnboardingStepStatus } from '@zhin.js/gateway/onboarding';

export interface SetupOnboardingIo {
  log(message: string): void;
  error(message: string): void;
  /** Raw package-manager output. */
  write(chunk: string): void;
}

export interface SetupOnboardingDeps {
  /** `hasOwner` is only used for auto-detection; callers without IAM pass `() => false`. */
  createService(projectRoot: string, hasOwner?: () => boolean | Promise<boolean>): OnboardingService;
  readonly io: SetupOnboardingIo;
}

/** Mutable so tests can substitute the installer / output. */
export const setupOnboardingDeps: SetupOnboardingDeps = {
  createService: (projectRoot, hasOwner = () => false) => new OnboardingService({ projectRoot, hasOwner }),
  io: {
    log: message => console.log(message),
    error: message => console.error(message),
    write: chunk => { process.stdout.write(chunk); },
  },
};

export type SetupStepOutcomes = Partial<Record<'database' | 'ai' | 'adapters', Exclude<OnboardingStepStatus, 'pending'>>>;

/** Records step outcomes; failures are reported but never fail the command that already wrote config. */
export async function recordOnboardingSteps(service: OnboardingService, outcomes: SetupStepOutcomes, io: SetupOnboardingIo): Promise<void> {
  try {
    for (const [step, value] of Object.entries(outcomes)) {
      if (value) await service.markStep(step, value);
    }
    if (!Object.keys(outcomes).length) await service.status();
  } catch (error) {
    io.error(`引导状态未更新：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Installs wizard dependencies that are on the onboarding allowlist (others stay in package.json
 * for the next `pnpm install`). Returns undefined when nothing was eligible.
 */
export async function installSetupDependencies(
  service: OnboardingService,
  dependencies: Readonly<Record<string, string>>,
  io: SetupOnboardingIo,
): Promise<InstallReport | undefined> {
  const allowlist = await service.allowlist();
  const specs: string[] = [];
  const skipped: string[] = [];
  for (const [name, version] of Object.entries(dependencies)) {
    if (!allowlist.get(name)) { skipped.push(name); continue; }
    specs.push(!version || version === 'latest' ? name : `${name}@${version}`);
  }
  if (skipped.length) io.log(`以下依赖不在在线安装目录中，请运行 pnpm install：${skipped.join(', ')}`);
  if (!specs.length) return undefined;
  const report = await service.installPackages(specs, 'local', (event: InstallEvent) => {
    switch (event.type) {
      case 'package-start': io.log(`安装 ${event.spec} …`); break;
      case 'output': io.write(event.chunk); break;
      case 'package-done': io.log(`✓ ${event.name}`); break;
      case 'package-failed': io.error(`✗ ${event.name}：${event.error}`); break;
      case 'rollback': if (event.ok) io.log(`已回滚 ${event.name}`); else io.error(`回滚 ${event.name} 失败：${event.error ?? ''}`); break;
      default: break;
    }
  });
  if (!report.ok) {
    if (report.rollbackFailed.length) io.error(`请手动移除：${report.rollbackFailed.map(item => item.name).join(', ')}`);
  } else if (report.restartRequired) {
    io.log('依赖已安装：如 Host 正在运行，请重启它。');
  }
  return report;
}
