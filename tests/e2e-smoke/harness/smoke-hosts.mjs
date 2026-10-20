// Host resources a production start would install, built from the same classes the CLI uses.
import { join } from 'node:path';
import {
  PluginDatabaseHost,
  PluginOutboundHost,
  PluginScheduleHost,
  databaseHostToken,
  databaseRootHostToken,
  outboundHostToken,
  outboundRootHostToken,
  rootPluginId,
  scheduleHostToken,
  scheduleRootHostToken,
} from '../../../packages/im/plugin-runtime/src/index.ts';
import { createDatabaseHost } from '../../../basic/cli/src/plugin-runtime/database-host-installer.ts';

/**
 * Proactive sends (reminders, RSS pushes) enter the kit's real unified send chain, so they are captured
 * in `kit.deliveries` exactly like replies. The target's adapter name is the synthetic endpoint name.
 * @param {() => import('../../../packages/toolkit/testing/src/index.ts').PluginTestKit} currentKit
 */
function createKitOutboundHost(currentKit) {
  return {
    async sendTarget(target, content, requester) {
      const { endpoint, ...conversation } = target;
      const receipt = await currentKit().send({ endpoint: endpoint.adapter, conversation, content, requester });
      if (receipt.status !== 'sent') throw new Error(`smoke outbound send was ${receipt.status}`);
      return receipt.message?.id ?? null;
    },
    async send() {
      throw new Error('The smoke outbound host only supports exact DeliveryTarget sends');
    },
  };
}

/**
 * SQLite-backed Database Host in the project directory, a fake-clock Schedule Host and an Outbound Host
 * that sends through the kit.
 * @param {{
 *   projectRoot: string,
 *   schedules: import('../../../packages/toolkit/testing/src/index.ts').FakeScheduleRootHost,
 *   currentKit: () => import('../../../packages/toolkit/testing/src/index.ts').PluginTestKit,
 * }} options
 */
export function createSmokeHosts(options) {
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(options.projectRoot, 'state.sqlite') });
  const installResources = ({ resources, admission, handoff }) => {
    resources.provide(databaseRootHostToken, database);
    resources.provide(databaseHostToken, new PluginDatabaseHost(rootPluginId(), database, admission));
    handoff.add({ activateNext: () => database.start() });
    resources.provide(scheduleRootHostToken, options.schedules);
    resources.provide(scheduleHostToken, new PluginScheduleHost(rootPluginId(), options.schedules, admission));
    const outbound = createKitOutboundHost(options.currentKit);
    resources.provide(outboundRootHostToken, outbound);
    resources.provide(outboundHostToken, new PluginOutboundHost(rootPluginId(), outbound, admission));
  };
  const stop = async () => {
    await database.stop();
  };
  return { installResources, stop };
}
