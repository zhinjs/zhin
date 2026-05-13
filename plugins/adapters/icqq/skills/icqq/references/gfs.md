# Group File System (GFS)

## List Files

```
icqq group fs list <gid>                # List root directory
icqq group fs list <gid> -p <pid>      # List subdirectory by parent ID
```

## Info & Stats

```
icqq group fs info <gid>               # View GFS usage stats (space, file count)
icqq group fs stat <gid> <fid>         # View file/directory details
```

## Manage

```
icqq group fs mkdir <gid> <name>              # Create directory
icqq group fs delete <gid> <fid>              # Delete file/directory by ID
icqq group fs rename <gid> <fid> <name>       # Rename file/directory
icqq group fs move <gid> <fid> <pid>          # Move file to directory
```

## Upload & Download

```
icqq group fs upload <gid> <file>              # Upload file to group
icqq group fs download <gid> <fid>            # Get download URL
icqq group fs forward <gid> <fid> <target_gid> # Forward file to another group
icqq group fs forward-offline <gid> <fid>      # Convert to offline file
```

The `<fid>` (file ID) is shown in `icqq group fs list` output.

## Examples

```bash
icqq group fs list 67890
icqq group fs info 67890
icqq group fs stat 67890 abc123
icqq group fs mkdir 67890 "会议资料"
icqq group fs upload 67890 ./report.pdf
icqq group fs download 67890 abc123
icqq group fs rename 67890 abc123 "新文件名"
icqq group fs move 67890 abc123 def456
icqq group fs delete 67890 abc123
```
