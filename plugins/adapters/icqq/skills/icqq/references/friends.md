# Friends

## List & View

```
icqq friend list              # List all friends
icqq friend view <uid>        # View friend profile
icqq friend avatar-url <uid>  # Get avatar URL
```

## Actions

```
icqq friend send <uid> <message>        # Send private message
icqq friend poke <uid>                 # Poke a friend
icqq friend like <uid> [-t times]      # Like (1-20 times, default 1)
icqq friend delete <uid> [-b]          # Delete friend (-b: also block)
icqq friend remark <uid> <remark>      # Set friend remark/alias
icqq friend add <uid>                  # Add friend (optionally via group)
```

## Files

```
icqq friend send-file <uid> <file>      # Send file to friend
icqq friend file-info <uid> <fid>      # Get file info
icqq friend file-url <uid> <fid>       # Get file download URL
icqq friend recall-file <uid> <fid>    # Recall a sent file
```

## Friend Classes (Groups)

```
icqq friend class list                 # List friend groups
icqq friend class add <name>           # Create friend group
icqq friend class delete <id>          # Delete friend group
icqq friend class rename <id> <name>   # Rename friend group
icqq friend class set <uid> <id>       # Move friend to group
```

## Examples

```bash
icqq friend list
icqq friend view 12345
icqq friend send 12345 "你好"
icqq friend poke 12345
icqq friend like 12345 -t 10
icqq friend remark 12345 "小王"
icqq friend delete 12345 -b
icqq friend send-file 12345 ./doc.pdf
icqq friend class list
icqq friend class add "大学同学"
```
