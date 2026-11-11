/**
 * `zhin setup` / `zhin console init` side of ADR 0053 §5: both record onboarding steps and install
 * dependencies through the same `OnboardingService` the Console uses. With a gateway running, the
 * install is a gateway dependency transaction (`gateway.packages.install` over the local socket:
 * stop instance, install, start, roll back on failure) instead of touching `node_modules` under it.
 */
import type { GatewayPackageTransactionResult } from '@zhin.js/console-protocol';
import { OnboardingService, type InstallEvent, type InstallReport, type OnboardingStepStatus } from '@zhin.js/gateway/onboarding';
import { describeGatewayError, probeGateway, runPackageOperationViaGateway, type GatewayTarget } from '../utils/gateway.js';

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
 * for the next `pnpm install`). Returns undefined when nothing was eligible. With `gateway` set and
 * a gateway running for that project, the install goes through the gateway (progress streamed);
 * otherwise it runs here as before.
 */
export async function installSetupDependencies(
  service: OnboardingService,
  dependencies: Readonly<Record<string, string>>,
  io: SetupOnboardingIo,
  gateway?: GatewayTarget,
): Promise<InstallReport | GatewayPackageTransactionResult | Readonly<{ ok: false }> | undefined> {
  const allowlist = await service.allowlist();
  const specs: string[] = [];
  const skipped: string[] = [];
  for (const [name, version] of Object.entries(dependencies)) {
    if (!allowlist.get(name)) { skipped.push(name); continue; }
    specs.push(!version || version === 'latest' ? name : `${name}@${version}`);
  }
  if (skipped.length) io.log(`以下依赖不在在线安装目录中，请运行 pnpm install：${skipped.join(', ')}`);
  if (!specs.length) return undefined;
  if (gateway) {
    let running: boolean;
    try {
      running = (await probeGateway(gateway)) !== undefined;
    } catch (error) {
      // A gateway exists but cannot be used: installing behind its back would race its instance.
      io.error(describeGatewayError(error));
      return Object.freeze({ ok: false as const });
    }
    if (running) {
      io.log('检测到网关正在运行：依赖经由网关安装（会停止并重新启动实例，失败时回滚）。');
      try {
        // The wizard already wrote `plugins`; the gateway must not enable anything again.
        return await runPackageOperationViaGateway(gateway, { operation: 'install', packages: specs, enable: false }, {
          out: chunk => io.write(chunk),
          err: chunk => io.write(chunk),
        });
      } catch (error) {
        io.error(describeGatewayError(error));
        return Object.freeze({ ok: false as const });
      }
    }
  }
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
