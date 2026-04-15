# Friend & Group Requests

## View Pending Requests

```
icqq requests                  # Show all pending friend/group requests with flags
```

## Handle Requests

```
icqq request accept <flag>            # Accept friend request
icqq request accept <flag> -g         # Accept group request
icqq request reject <flag>            # Reject friend request
icqq request reject <flag> -g         # Reject group request
icqq request reject <flag> -g -r "理由"  # Reject with reason
```

The `<flag>` value is shown in `icqq requests` output.

## Examples

```bash
icqq requests
icqq request accept abc123
icqq request reject def456 -g -r "群已满"
```
