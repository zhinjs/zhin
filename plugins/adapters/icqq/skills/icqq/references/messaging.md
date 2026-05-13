# Messaging

## Send Message (non-interactive)

```
icqq friend send <uid> <message>    # Send private message
icqq group send <gid> <message>     # Send group message
```

**IMPORTANT**: Always use `icqq friend send` / `icqq group send` for agent operations (non-interactive). The `icqq friend chat` / `icqq group chat` commands enter interactive mode that the agent cannot operate.

## CQ Code Syntax

Messages support inline CQ codes for rich content:

```
[face:178]              # QQ face emoji (id 0~348)
[image:/path/to/pic.jpg]  # Image (local path or URL)
[at:12345]              # @ a user
[at:all]                # @ everyone
[dice]                  # Dice
[rps]                   # Rock-paper-scissors
```

Mixed example: `icqq send group 67890 "你好[face:178]看看[image:/tmp/pic.jpg]"`

## Recall

```
icqq recall <message_id>
```

## Message Operations

```
icqq msg get <message_id>              # View message details
icqq msg mark-read <message_id>        # Mark message as read
icqq forward get <message_id>          # View forwarded message content
```

## Chat History

```
icqq friend chat history <uid> [-c count]   # Private chat history (default 20)
icqq group chat history <gid> [-c count]    # Group chat history (default 20)
```

## Interactive Chat (human only)

```
icqq friend chat <uid>     # Enter private chat mode
icqq group chat <gid>      # Enter group chat mode
```

## Examples

```bash
icqq friend send 12345 "你好"
icqq group send 67890 "大家好[face:21]"
icqq friend send 12345 "[image:https://example.com/pic.jpg]看这个"
icqq friend chat history 12345 -c 50
icqq group chat history 67890
icqq recall abc123
```
