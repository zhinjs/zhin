---
title: "Smart Home (Home Assistant)"
description: "Let the Agent query and control devices at home through Home Assistant: prerequisites, minimal configuration, device aliases, security policy, available tools, and state notifications"
---

# Smart home (Home Assistant)

Once this is set up, you can tell the Bot in chat to "turn off the living room light" or "set the air conditioner to 26 degrees". The Agent carries it out through [Home Assistant](https://www.home-assistant.io/) (HA) and notifies you when a device's state changes.

- Only **Home Assistant** is supported: connect each brand's devices to HA first, and Zhin controls them uniformly through HA's REST and WebSocket APIs.
- The Agent only knows the **device aliases** you define (such as "living room light"); it neither sees nor operates any device outside the aliases.
- By default only the Bot's owner (Endpoint Owner) can control devices, and sensitive operations such as door locks need a second confirmation.

## Prerequisites

1. Home Assistant is running and reachable from the machine Zhin runs on (same network).
2. In HA, open **Profile → Long-lived access tokens → Create token** and copy it.
3. The project has `@zhin.js/agent` installed: `pnpm add @zhin.js/agent`.

## Minimal configuration

Put the address and token in `.env` first:

```bash
HA_REST_URL=http://homeassistant.local:8123
HA_REST_TOKEN=eyJhbGciOiJIUz...
```

Then add `assistant.home` to `zhin.config.yml`:

```yaml
assistant:
  enabled: true
  defaults:
    notify:
      channel: im
      target:
        channel: im
        scene:
          platform: sandbox
          endpointId: assistant
          sceneId: owner
          kind: private
  home:
    enabled: true
    restUrl: "${HA_REST_URL}"     # e.g. http://homeassistant.local:8123
    restToken: "${HA_REST_TOKEN}" # HA long-lived access token
    aliases:
      living room light: light.living_room
      bedroom light: light.bedroom
      air conditioner: climate.living_room
      living room curtain: cover.living_room
```

The left side of `aliases` is the name you say in chat; the right side is the `entity_id` in HA. After a restart, tell the Bot "list my devices" to verify — the Agent calls `home_list_aliases`.

::: tip Aliases can also live in the assistant profile
Aliases declared under `devices` in `assistant.profile.yml` are merged with `assistant.home.aliases`; the profile wins on a name clash:

```yaml
version: 1
devices:
  living room light: light.living_room
  front door lock: lock.front_door
```
:::

## Security policy

| Setting | Default | Effect |
|------|--------|------|
| `policy.requireMaster` | `true` | Only the Endpoint Owner (master) can call `home_*` tools |
| `policy.confirmServices` | `['lock', 'alarm_control_panel']` | Write operations on these HA domains need a second confirmation from the Owner |

For example, to require a second confirmation for curtains as well:

```yaml
assistant:
  home:
    policy:
      requireMaster: true
      confirmServices:
        - lock
        - alarm_control_panel
        - cover
```

## Notify me when a device changes state

List the device aliases to watch under `watch`. Zhin subscribes to their changes over the HA WebSocket and pushes them to you:

```yaml
assistant:
  home:
    watch:
      - living room light
      - front door lock
    debounceMs: 5000    # debounce interval per device (default 5 seconds)
```

Notifications go through the IM channel set in `assistant.defaults.notify`. If that is not a deliverable IM channel, Zhin only registers the tools and does not open the WebSocket subscription.

## Available tools

The Agent picks from these tools based on what you say:

| Tool | Kind | Description |
|------|------|------|
| `home_list_aliases` | read | List the configured device aliases |
| `home_get_state` | read | Query a device's current state |
| `home_turn_on` | write | Turn a device on |
| `home_turn_off` | write | Turn a device off |
| `home_set_brightness` | write | Set light brightness (0–255) |
| `home_set_temperature` | write | Set the climate target temperature |
| `home_activate_scene` | write | Trigger an HA scene or script |
| `home_set_cover_position` | write | Set the curtain position (0–100) |
| `home_call_service` | write | Generic HA service call (restricted by an allowlist) |

`home_call_service` allows only the `light` / `climate` / `scene` / `cover` / `script` domains and likewise accepts aliases only.

## FAQ

**Does it work without Home Assistant?**
Not at the moment; connect your devices to HA first.

**The tools do not appear after configuration?**
Check that `home.enabled: true` is set and that both `restUrl` and `restToken` are filled in. The startup log should show that home was activated.

::: details Internal structure
```
Agent home_* tools
      │
      ▼
 HomeFacade (aliases + permissions + intent)
      │
      ▼
 HaHomeBackend (REST)
      │
 HomeStateWatch ← HaWsTransport (optional watch)
      │
 NotificationRouter → Owner IM
```
:::

## Next steps

- [Agent deep dive](/en/ai/agent): how tools are selected, approved, and executed
- [AI overview](/en/ai/): configure the chat model and the assistant
