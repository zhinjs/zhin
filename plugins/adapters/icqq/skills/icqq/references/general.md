# General

## Account

```
icqq login                     # Login QQ and start daemon (interactive wizard)
icqq login -r                  # Quick reconnect using saved token
icqq login -q <uid> -r         # Quick reconnect specific account
icqq status                    # Check all daemon/account statuses
icqq stop                      # Stop the daemon
icqq stop <uin>                # Stop specific daemon
icqq switch                    # Switch current account (interactive)
icqq switch <uin>              # Switch to specific account
icqq profile                   # View current account profile
icqq requests                  # View pending friend/group requests
```

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
icqq stranger view <uid>          # View stranger profile
icqq stranger status <uid>        # Check online status
icqq stranger add-setting <uid>   # Check add-friend settings
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

## Examples

```bash
icqq status
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
