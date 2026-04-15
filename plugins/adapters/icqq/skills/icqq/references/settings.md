# Settings

## Personal Settings

```
icqq set nickname <name>            # Set nickname
icqq set gender <0|1|2>             # 0=unknown, 1=male, 2=female
icqq set birthday <YYYYMMDD>        # Set birthday
icqq set signature <text>           # Set signature
icqq set description <text>         # Set description
icqq set avatar <file>              # Set avatar (image file path)
icqq set online-status <code>       # 11=online, 31=away, 41=invisible, 50=busy, 60=Q-me, 70=DND
```

## Group Settings

```
icqq group set name <gid> <name>              # Set group name
icqq group set avatar <gid> <file>            # Set group avatar
icqq group set card <gid> <uid> <card>        # Set member card/nickname
icqq group set title <gid> <uid> <title>      # Set member special title
icqq group set admin <gid> <uid>              # Set admin
icqq group set admin <gid> <uid> -r           # Remove admin
icqq group set remark <gid> <remark>          # Set group remark
icqq group set anonymous <gid>                # Toggle anonymous
icqq group set join-type <gid> <type>         # Set join method
icqq group set rate-limit <gid> <limit>       # Set message rate limit
```

## Examples

```bash
icqq set nickname "新昵称"
icqq set signature "今天天气不错"
icqq set online-status 50
icqq group set name 67890 "新群名"
icqq group set card 67890 12345 "管理员小王"
```
