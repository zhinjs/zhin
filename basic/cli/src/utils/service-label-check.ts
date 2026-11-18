/**
 * `zhin doctor` check of #1250 `account-add-service-label-generic`: before this release
 * `zhin ai account add --service <driver>` stored its plan alias `service` as the new service's label,
 * so logs showed `judge: language:service/<model>`. Runtime displays already fall back to the driver
 * name; this check names the services once per run and tells how to rename them.
 *
 * No `--fix`: a service label is also how `zhin ai account add --service <label>` finds an existing
 * service, so renaming it silently could break a script that still passes `--service service`; and a
 * rename is a model-graph mutation (review + apply on the running instance), not a file edit doctor owns.
 * The CLI never imports an IM layer (ADR 0054): the view is read over the local gateway socket.
 */
import { hostGet, type HostHttpConfig } from './host-http.js';

export interface ServiceLabelCheckResult {
  name: string;
  status: 'ok' | 'info' | 'warn' | 'error';
  message: string;
  fix?: string;
}

interface ServiceView {
  readonly id?: string;
  readonly label?: string;
  readonly ownerId?: string;
  readonly driver?: Readonly<{ id?: string }>;
}

export interface ServiceLabelView {
  readonly services?: Readonly<Record<string, ServiceView>>;
  readonly drivers?: readonly Readonly<{ id?: string; label?: string }>[];
}

/** A label that names nothing: the literal plan alias of an older `zhin ai account add`. */
export function isGenericServiceLabel(value: string | undefined): boolean {
  return typeof value === 'string' && /^(service|account)$/iu.test(value.trim());
}

/** Services whose label is generic, with the Driver display name to rename them to. */
export function genericServiceLabels(view: ServiceLabelView): Array<Readonly<{ id: string; label: string; suggestion: string }>> {
  return Object.entries(view.services ?? {})
    .filter(([, service]) => isGenericServiceLabel(service.label))
    .map(([key, service]) => {
      const driverId = service.driver?.id ?? '';
      const driverLabel = view.drivers?.find(driver => driver.id === driverId)?.label?.trim();
      return { id: service.id ?? key, label: service.label!.trim(), suggestion: driverLabel || driverId || '驱动名' };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

const NAME = '模型服务名称';

/** One hint for every service named by the literal `service`; nothing when the instance is not reachable. */
export async function checkGenericServiceLabels(input: Readonly<{ client: HostHttpConfig | undefined; view?: ServiceLabelView }>): Promise<ServiceLabelCheckResult[]> {
  let view = input.view;
  if (!view && input.client) {
    // The view is the management root itself (`GET {base}/agent/inference`).
    const root = { ...input.client, baseUrl: input.client.baseUrl.replace(/\/agent\/inference$/u, '') };
    const viewed = await hostGet<ServiceLabelView>(root, '/agent/inference').catch(() => undefined);
    view = viewed?.ok && viewed.data ? viewed.data : undefined;
  }
  if (!view) return [];
  const generic = genericServiceLabels(view);
  if (!generic.length) return [];
  const lines = generic.map(service => `${service.id}（名称「${service.label}」，建议改为「${service.suggestion}」）`);
  return [{
    name: NAME,
    status: 'warn',
    message: `${generic.length} 个模型服务的名称是泛化的「${generic[0]!.label}」，日志和 Console 里认不出是哪家服务：${lines.join('；')}。`
      + '运行时显示已改用驱动名。',
    fix: '在 Console「模型」页编辑这些服务，把名称改为驱动名（如 Anthropic）；之后用 zhin ai account add --service <新名称> 引用它们',
  }];
}
