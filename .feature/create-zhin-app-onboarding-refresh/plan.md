# create-zhin-app Onboarding Refresh

## Goal

Make `pnpm create zhin-app` produce a complete, internally consistent Zhin workspace that new users can build, run, inspect, and extend without discovering missing templates or stale documentation.

## Capability Matrix

| Area | Current gap | Planned behavior |
| --- | --- | --- |
| Skills | CLI and workspace generator reference skills that are not present in `template/skills`. | Every generated and advertised skill has a source template, and missing templates fail tests. |
| Default project | Generated project is usable, but onboarding omits newer Host defaults and does not explain Remote Console or inbox. | Default Host/Node project keeps Sandbox + HTTP + Console + SQLite and includes Remote Console CORS plus database-backed inbox. |
| AI Agent | Wizard only writes provider + trigger. | AI-enabled projects include sessions, context, and agent recommended defaults while keeping MCP/toolSearch opt-in. |
| Docs | Getting Started still mentions TS/JS config choices, username/password auth, and Git init. | Docs match the actual YAML/JSON/TOML + Token flow and show build/dev verification. |
| Tests | Existing create-zhin tests do not validate generated workspace structure or advertised skills. | Tests cover config formats, AI config, generated workspace files, and skill template existence. |

## Implementation Notes

- Keep advanced Edge/Queue flows documented as later opt-in, not default wizard branches.
- Keep `-y` mode non-interactive and predictable: YAML, Node, SQLite, Sandbox, no AI, development skills installed.
- Avoid committing generated end-to-end projects; use temporary directories in tests and local validation.
