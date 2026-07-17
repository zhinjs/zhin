import { createToken } from '@zhin.js/next-kernel';

export type RuntimeMode = 'development' | 'test' | 'production';

export interface RuntimeEnvironment {
  readonly name: string;
  readonly mode: RuntimeMode;
  readonly platform: string;
}

export const runtimeEnvironmentToken = createToken<RuntimeEnvironment>(
  'zhin.runtime-environment',
  'Explicit Root runtime environment',
);

export function defineRuntimeEnvironment(
  environment: RuntimeEnvironment,
): Readonly<RuntimeEnvironment> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(environment.name)) {
    throw new TypeError(`Invalid environment name: ${environment.name}`);
  }
  if (!['development', 'test', 'production'].includes(environment.mode)) {
    throw new TypeError(`Invalid runtime mode: ${environment.mode}`);
  }
  if (!environment.platform) throw new TypeError('Runtime platform is required');
  return Object.freeze({ ...environment });
}
