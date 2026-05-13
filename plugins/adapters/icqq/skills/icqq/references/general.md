# General

## Account

> Use **`icqq service status`** for service/daemon state, or **`icqq profile`** / **`icqq friend list`** to verify the daemon answers over IPC.

```
icqq login                     # Login QQ and start daemon (interactive wizard)
icqq login -r                  # Quick reconnect using saved token
icqq login -q <uid> -r         # Quick reconnect specific account
icqq logout                    # Logout and stop daemon (token invalidated)
icqq logout -k                 # Disconnect only, keep token (login -r still works)
icqq logout <uin>              # Logout specific account
icqq switch                    # Switch current account (interactive)
icqq switch <uin>              # Switch to specific account
icqq profile                   # View current account profile
icqq requests                  # View pending friend/group requests
```

## System Service (auto-restart on crash, start on boot)

```
icqq service install           # Register daemon as system service (launchd/systemd)
icqq service install -a        # Install service for all configured accounts
icqq service uninstall         # Remove system service
icqq service uninstall -a      # Uninstall all
icqq service start             # Start installed service
icqq service start -a          # Start all
icqq service stop              # Stop service (keeps service file, no restart until start)
icqq service stop -a           # Stop all
icqq service status            # Show service install/running state
icqq service status -a         # Show status for all accounts
```

Note: `icqq logout` does NOT prevent service auto-restart. To permanently stop, uninstall the service first.

## Config

```
icqq config get                # View all config
icqq config get <key>          # View specific config key (currentUin, webhookUrl, notifyEnabled)
icqq config set <key> <value>  # Set config value
```

## Multi-Instance

Use `-u <uin>` global flag or `ICQQ_CURRENT_UIN` env to target a specific account.
Default falls back to `config.currentUin`.

```
icqq -u 12345 profile          # View profile for account 12345
ICQQ_CURRENT_UIN=12345 icqq friend list
```

## Blacklist

```
icqq blacklist                 # View blacklist
```

## OCR

```
icqq ocr <image>               # OCR image text recognition (local file path)
```

## Webhook

```
icqq webhook                   # View current webhook config
icqq webhook set <url>         # Set webhook URL (daemon pushes events via POST)
icqq webhook off               # Disable webhook
```

## Notification

```
icqq notify                    # View notification status
icqq notify on                 # Enable system notifications
icqq notify off                # Disable system notifications
```

## Conversion

```
icqq convert uid <qq>          # QQ number to UID
icqq convert uin <uid>         # UID to QQ number
```

## Keys & URLs

```
icqq get client-key            # Get ClientKey
icqq get pskey                 # Get PSKey
icqq get video-url <vid>       # Get video download URL
```

## Stranger

```
icqq stranger view <uid>           # View stranger profile
icqq stranger status <uid>         # Check online status
icqq stranger add-setting <uid>    # Check add-friend settings
```

## Roaming Emoji (Stamps)

```
icqq stamp list                # List roaming emojis
icqq stamp delete              # Delete roaming emoji
```

## Cache & Reload

```
icqq cache clean               # Clear cache
icqq reload friends            # Refresh friend list
icqq reload groups             # Refresh group list
icqq reload blacklist          # Reload blacklist
icqq reload guilds             # Reload guild list
icqq reload strangers          # Reload stranger list
```

## Guild (Server & Channel)

```
icqq guild list                                                # List guilds
icqq guild info <guild_id>                                     # View guild info
icqq guild members <guild_id>                                  # List guild members
icqq guild channel list <guild_id>                             # List subchannels
icqq guild channel send <guild_id> <channel_id> <message>      # Send channel message
icqq guild channel chat <guild_id> <channel_id>                # Interactive channel chat
icqq guild channel recall <guild_id> <channel_id> <seq>        # Recall channel message
icqq guild channel share <guild_id> <channel_id> <url> <title> # Share post link
icqq guild channel forum-url <guild_id> <channel_id> <forum_id> # Get forum URL
```

## Shell Completion

```
icqq completion [shell]        # Generate shell completion script (bash/zsh/fish)
```

## RPC (TCP Remote Connection)

The daemon supports optional TCP remote access for cross-machine QQ account control.

### Configuration

In `~/.icqq/config.json`:

```json
{
  "rpc": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 0
  }
}
```

Or via CLI:

```
icqq config set rpc.enabled true    # Enable RPC TCP listener
icqq config set rpc.host 0.0.0.0   # Listen on all interfaces (for remote access)
icqq config set rpc.port 9100      # Set listen port (0 = auto-assign)
```

| Field | Description | Default |
|-------|-------------|---------|
| `enabled` | Enable RPC TCP listener | `false` |
| `host` | Listen address, `"0.0.0.0"` for remote | `"127.0.0.1"` |
| `port` | Listen port, `0` = auto-assign | `0` |

### Security

- **HMAC-SHA256 challenge-response auth** — token never transmitted over network
- **IP rate limiting** — 5 failures in 5 minutes → auto-block
- **Default localhost only** — must explicitly set `host: "0.0.0.0"` for remote access
- **4KB unauthenticated buffer limit** — prevents memory exhaustion

### Programmatic Access

```typescript
import { IpcClient } from "@icqqjs/cli/lib/ipc-client";

// Option 1: Specify host/port/token directly
const client = await IpcClient.connectRpc({
  host: "192.168.1.100",
  port: 9100,
  token: "your-token-here",
});

// Option 2: Auto-read from daemon.rpc file (local only)
const client = await IpcClient.connectRpcByUin(12345);

const resp = await client.request("list_friends");
client.close();
```

### Auth Flow

1. Client connects to TCP port
2. Server sends `{ "challenge": "<random-hex>" }`
3. Client computes `HMAC-SHA256(token, challenge)` → digest
4. Client sends `{ "action": "auth", "params": { "digest": "<hex>" } }`
5. Server verifies → authenticated

## Examples

```bash
icqq service status
icqq profile
icqq requests
icqq login -r
icqq config get
icqq config set currentUin 12345
icqq switch 12345
icqq -u 12345 profile
icqq ocr ./screenshot.png
icqq webhook set https://example.com/hook
icqq notify on
icqq convert uid 12345
icqq stranger view 12345
icqq stamp list
icqq cache clean
icqq reload friends
icqq guild list
```
