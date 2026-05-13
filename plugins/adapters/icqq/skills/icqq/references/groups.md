# Groups

## List & View

```
icqq group list                        # List all groups
icqq group view <gid>                  # View group info
icqq group member list <gid>           # List group members
icqq group member view <gid> <uid>     # View member info
icqq group avatar-url <gid>            # Get group avatar URL
icqq group share <gid>                 # Get group share link
icqq group anon-info <gid>             # View anonymous info
icqq group at-all-remain <gid>         # Check @all remaining count
icqq group muted-list <gid>            # View muted members list
```

## Mute

```
icqq group mute <gid> <uid> [-d seconds]   # Mute member (default 600s, -d 0 to unmute)
icqq group mute-all <gid>                  # Mute all
icqq group mute-all <gid> --off            # Unmute all
icqq group mute-anon <gid> <flag>          # Mute anonymous member
```

## Kick & Quit

```
icqq group kick <gid> <uid> [-b]      # Kick member (-b: block rejoin)
icqq group quit <gid>                 # Quit group
icqq group screen-member <gid> <uid>  # Block/unblock member messages
```

## Social

```
icqq group send <gid> <message>         # Send group message
icqq group poke <gid> <uid>           # Poke group member
icqq group invite <gid> <uid>         # Invite friend to group
icqq group sign <gid>                 # Group check-in
```

## Reactions

```
icqq group reaction add <msgid> <emoji>     # React to message
icqq group reaction remove <msgid> <emoji>  # Remove reaction
```

## Announcement & Essence

```
icqq group announce <gid> <content>        # Post announcement
icqq group essence add <message_id>        # Set essence message
icqq group essence remove <message_id>     # Remove essence message
```

## Examples

```bash
icqq group list
icqq group view 67890
icqq group send 67890 "大家好"
icqq group member list 67890
icqq group member view 67890 12345
icqq group mute 67890 12345 -d 3600
icqq group kick 67890 12345 -b
icqq group announce 67890 "今晚8点开会"
icqq group sign 67890
icqq group reaction add abc123 👍
```
