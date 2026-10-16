/**
 * Turn network authority shared by tool offering, policy denial and prompt
 * guidance. A Turn without `policy.network.enabled` can never reach the
 * network, so its network tools are withheld instead of offered and denied,
 * and the model is told the one real way to enable it rather than guessing.
 */

/** Native tools whose only purpose is network access. */
export const NETWORK_TOOL_NAMES: ReadonlySet<string> = new Set(['web_fetch', 'web_search']);

/** Denial reason for network access on a Turn without network authority. */
export const NETWORK_DISABLED_REASON =
  'Turn has no network authority：本回合未开启出网。主人可在 zhin.config.yml 中设置 '
  + '`ai.agent.network.enabled: true`（可用 `ai.agent.network.allowedDomains` 限定域名），重启后生效；聊天里无法开启。';

/** Prompt note added when network tools were withheld from a Turn. */
export const NETWORK_DISABLED_PROMPT_NOTE = [
  '## Network',
  '本回合未开启出网，web_fetch / web_search 等联网工具不可用，不要声称可以联网查询。',
  '如果用户问怎么开启：主人在 zhin.config.yml 中设置 `ai.agent.network.enabled: true`'
    + '（可选 `ai.agent.network.allowedDomains` 限定域名），重启后生效；聊天里无法开启。不要编造其他开关、平台或配置位置。',
].join('\n');

type NetworkPolicyView = Readonly<{ network?: Readonly<{ enabled?: boolean }> }>;

export function turnPolicyAllowsNetwork(policy: NetworkPolicyView | undefined): boolean {
  return policy?.network?.enabled === true;
}

/** Drops network tools from a tool or catalog list when the Turn policy cannot reach the network. */
export function withoutForbiddenNetwork<T extends { readonly name: string }>(
  policy: NetworkPolicyView | undefined,
  tools: readonly T[],
): T[] {
  return turnPolicyAllowsNetwork(policy)
    ? [...tools]
    : tools.filter(tool => !NETWORK_TOOL_NAMES.has(tool.name));
}
